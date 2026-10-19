import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { encode } from "fast-png";
import { createDocument, FLIP_D, FLIP_H, FLIP_V, makeCell, MapStore, parseLevel, serializeLevel, exportGameJson, deriveCollision, composeOrientation, type Tileset } from "../src/index";
import { defoldOrientation, defoldPreflight, exportDefold, type DefoldExportFile } from "../src/export/defold";

const atlas: Tileset = { id: "a", name: "Atlas", imagePath: "tilesets/a.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 4, margin: 1, spacing: 2 };
const pngBytes = encode({ width: 72, height: 72, data: new Uint8Array(72 * 72 * 4), depth: 8, channels: 4 });
const png = () => pngBytes;
function setup(width = 2, height = 2) {
  const store = new MapStore(createDocument({ width, height, tileWidth: 16, tileHeight: 16, tilesets: [atlas] }));
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
  return store;
}
function paint(store: MapStore, layerId: string, x: number, y: number, tileId: number, flags = 0, tilesetId = "a") {
  const index = store.getOrAddPaletteIndex(tilesetId, tileId);
  store.dispatch({ type: "paintCells", layerId, cells: [{ x, y, cell: makeCell(index, flags) }] });
}
function textOf(files: readonly DefoldExportFile[], suffix: string): string {
  const file = files.find((file) => file.path.endsWith(suffix));
  if (!file || !("text" in file)) throw new Error(`Missing text file ${suffix}`);
  return file.text;
}

describe("Defold export", () => {
  it("uses zero-based file tile ids, omits empty cells and flips Y exactly once (asymmetric 2×2)", () => {
    const store = setup();
    paint(store, "ground", 0, 0, 0);
    paint(store, "ground", 1, 0, 3);
    paint(store, "ground", 0, 1, 7);
    const files = exportDefold(store.document, "room", png);
    const map = textOf(files, ".tilemap");
    expect(map).toContain("x: 0\n    y: -1\n    tile: 0");
    expect(map).toContain("x: 1\n    y: -1\n    tile: 3");
    expect(map).toContain("x: 0\n    y: -2\n    tile: 7");
    expect(map.match(/\bcell \{/g)).toHaveLength(3);
    expect(textOf(files, ".tilesource")).toContain("tile_width: 16\ntile_height: 16\ntile_margin: 0\ntile_spacing: 2\n");
    expect(textOf(files, ".collection")).toContain('prototype: "/exported/room/map.go"');
  });

  it("splits a logical layer by source with stable increasing z and native hidden layers", () => {
    const store = setup();
    store.dispatch({ type: "addTileset", tileset: { ...atlas, id: "b" } });
    store.dispatch({ type: "addLayer", layer: { id: "top", name: "Top" } });
    paint(store, "ground", 0, 0, 1);
    paint(store, "ground", 1, 0, 2, 0, "b");
    paint(store, "top", 0, 0, 3);
    store.dispatch({ type: "setLayerProps", layerId: "top", props: { visible: false } });
    const files = exportDefold(store.document, "room", png);
    const maps = files.filter((f) => f.path.endsWith(".tilemap"));
    expect(maps).toHaveLength(3);
    const texts = maps.map((f) => "text" in f ? f.text : "");
    expect(texts[0]).toContain('id: "ground"');
    expect(texts[1]).toContain('id: "ground"');
    expect(texts[2]).toContain('id: "top"');
    const zs = texts.map((s) => Number(/\bz: ([^\n]+)/.exec(s)![1]));
    expect(zs[0]).toBeLessThan(zs[1]!);
    expect(zs[1]).toBeLessThan(zs[2]!);
    expect(zs.every((z) => z >= 0 && z < 1)).toBe(true);
    expect(texts[2]).toContain("is_visible: 0");
    expect(textOf(files, "map.go").match(/component:/g)).toHaveLength(3);
  });

  it("merges resolved manual collision even on empty visual cells; top hidden passable wins", () => {
    const store = setup(4, 3);
    store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintGrid", layerId: "col", cells: [
      { x: 0, y: 0, value: 1 }, { x: 1, y: 0, value: 1 },
      { x: 0, y: 1, value: 1 }, { x: 1, y: 1, value: 1 }, { x: 3, y: 2, value: 1 },
    ] });
    store.dispatch({ type: "addLayer", layer: { id: "override", name: "Override", type: "grid", role: "collision", visible: false } });
    store.dispatch({ type: "paintGrid", layerId: "override", cells: [{ x: 3, y: 2, value: 2 }] });
    const files = exportDefold(store.document, "room", png);
    const co = textOf(files, ".collisionobject");
    expect(co.match(/shape_type:/g)).toHaveLength(1);
    expect(co).toContain("position { x: 16 y: -16 z: 0 }");
    expect(co).toContain("data: 16\n  data: 16\n  data: 0.5");
    expect(co).toContain("rotation { x: 0 y: 0 z: 0 w: 1 }");
    expect(files.some((file) => file.path.endsWith(".tilemap"))).toBe(false);
    expect(exportDefold(store.document, "room", png, { collision: false }).some((f) => f.path.endsWith(".collisionobject"))).toBe(false);
  });

  it("chunks collision shapes without losing any rectangle or exceeding the component budget", () => {
    const store = setup(40, 40);
    store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
    const cells = Array.from({ length: 800 }, (_, i) => ({ x: (i % 20) * 2 + (Math.floor(i / 20) & 1), y: Math.floor(i / 20), value: 1 }));
    store.dispatch({ type: "paintGrid", layerId: "col", cells });
    const files = exportDefold(store.document, "room", png);
    const colliders = files.filter((f) => f.path.endsWith(".collisionobject"));
    const counts = colliders.map((f) => "text" in f ? (f.text.match(/shape_type:/g) ?? []).length : 0);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(800);
    expect(counts.every((count) => count > 0 && count <= 16)).toBe(true);
    // Each collision component gets its own GO, independent of GO component limits.
    expect(files.filter((f) => /collision-\d+\.go$/.test(f.path))).toHaveLength(colliders.length);
  });

  it("rejects size mismatches, opacity, missing textures, bad ids and OS absolute resource paths", () => {
    const store = setup();
    paint(store, "ground", 0, 0, 0);
    store.dispatch({ type: "setLayerProps", layerId: "ground", props: { opacity: 0.4 } });
    expect(defoldPreflight(store.document, png).map((p) => p.code)).toContain("layerOpacity");
    expect(() => exportDefold(store.document, "room", png)).toThrow();
    expect(defoldPreflight(store.document, () => undefined).map((p) => p.code)).toContain("missingTexture");
    expect(defoldPreflight(store.document, png, { projectSubfolder: "C:\\Games\\Project" }).map((p) => p.code)).toContain("projectSubfolder");
    expect(defoldPreflight(store.document, png, { projectSubfolder: "../outside" }).map((p) => p.code)).toContain("projectSubfolder");
    const wrong = new MapStore(createDocument({ width: 2, height: 2, tilesets: [atlas] }));
    wrong.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
    paint(wrong, "ground", 0, 0, 0);
    expect(defoldPreflight(wrong.document, png).map((p) => p.code)).toContain("tileSize");
  });

  it("normalizes Windows separators, escapes protobuf strings and keeps all paths inside the subfolder", () => {
    const store = setup();
    store.dispatch({ type: "addLayer", layer: { id: 'quote"\\\n', name: "Quoted" } });
    paint(store, 'quote"\\\n', 1, 0, 0);
    const files = exportDefold(store.document, 'A"\\B', png, { projectSubfolder: "exported\\world" });
    expect(files.every((f) => f.path.startsWith("exported/world/A__B/") && !f.path.includes("\\"))).toBe(true);
    expect(textOf(files, ".tilemap")).toContain('id: "quote\\"\\\\\\n"');
    expect(textOf(files, ".tilesource")).toContain('image: "/exported/world/A__B/');
  });

  it("is byte deterministic across palette/chunk insertion order and save/load", () => {
    const a = setup(40, 40), b = setup(40, 40);
    const cells = [[35, 0, 9], [0, 35, 0], [1, 1, 3]] as const;
    for (const [x, y, tile] of cells) paint(a, "ground", x, y, tile);
    for (const [x, y, tile] of [...cells].reverse()) paint(b, "ground", x, y, tile);
    const first = exportDefold(a.document, "room", png);
    expect(exportDefold(b.document, "room", png)).toEqual(first);
    expect(exportDefold(parseLevel(serializeLevel(a.document), [atlas]), "room", png)).toEqual(first);
  });

  it("preserves the established entity, portal, spawn and collision companion schema without modifying the document", () => {
    const store = setup();
    paint(store, "ground", 0, 0, 0);
    store.dispatch({ type: "addLayer", layer: { id: "entities", name: "Entities", type: "entity" } });
    store.dispatch({ type: "addEntity", layerId: "entities", entity: { id: "start", typeId: "spawn", x: 0, y: 16 } });
    store.dispatch({ type: "addEntity", layerId: "entities", entity: { id: "door", typeId: "portal", x: 16, y: 0, fields: { targetLevel: "elsewhere", targetPoint: { x: 32, y: 48 } } } });
    const before = serializeLevel(store.document);
    const game = JSON.parse(textOf(exportDefold(store.document, "room", png), "game.json"));
    const established = JSON.parse(exportGameJson(store.document));
    established.tilesets[0].image = "tileset-0000.png";
    established.tilesets[0].margin = 0;
    expect(game).toEqual(established);
    expect(game.spawn).toEqual({ x: 0, y: 16, cellX: 0, cellY: 1 });
    expect(game.entities[0].items[1].fields).toContainEqual({ name: "targetPoint", type: "point", value: { x: 32, y: 48 } });
    expect(serializeLevel(store.document)).toBe(before);
  });

  it("blocks overlapping oversized art, invalid palette refs and native tile index overflow", () => {
    const store = setup();
    store.dispatch({ type: "addTileset", tileset: { ...atlas, id: "big", tileWidth: 32 } });
    paint(store, "ground", 0, 0, 0, 0, "big");
    paint(store, "ground", 1, 0, 0, 0, "big");
    expect(defoldPreflight(store.document, png).map((p) => p.code)).toContain("overlappingArt");
    const invalid = setup();
    paint(invalid, "ground", 0, 0, 0);
    const saved = JSON.parse(serializeLevel(invalid.document));
    saved.palette[0].tileId = 999; // image shrink in an existing saved map
    expect(defoldPreflight(parseLevel(JSON.stringify(saved), [atlas]), png).map((p) => p.code)).toContain("invalidCells");
    const overflow = setup();
    overflow.dispatch({ type: "addTileset", tileset: { ...atlas, id: "huge", columns: 256, rows: 256 } });
    paint(overflow, "ground", 0, 0, 65535, 0, "huge");
    expect(defoldPreflight(overflow.document, png).map((p) => p.code)).toContain("tileIndex");
  });

  it("exports each of the eight orientations and preserves point mapping under Y conversion", () => {
    // Native destination BL,TL,TR,BR -> source corner. Pinned renderer's
    // tex_coord_order (first triangle vertices 0,1,2 and second vertex 4).
    const native = [[0,1,2,3], [3,2,1,0], [1,0,3,2], [2,3,0,1], [3,0,1,2], [0,3,2,1], [2,1,0,3], [1,2,3,0]];
    const corners = [[0,1], [0,0], [1,0], [1,1]] as const; // editor Y down
    fc.assert(fc.property(fc.integer({ min: 0, max: 7 }), (bits) => {
      const store = setup();
      const raw = (bits & 1 ? FLIP_H : 0) | (bits & 2 ? FLIP_V : 0) | (bits & 4 ? FLIP_D : 0);
      paint(store, "ground", 0, 0, 0, raw);
      const text = textOf(exportDefold(store.document, "room", png), ".tilemap");
      const value = (field: string) => Number(new RegExp(`${field}: (\\d+)`).exec(text)![1]);
      const mask = value("h_flip") | value("v_flip") << 1 | value("rotate90") << 2;
      for (const [source, [x, y]] of corners.entries()) {
        let dx: number = x, dy: number = y;
        if (bits & 4) [dx, dy] = [dy, dx];
        if (bits & 1) dx = 1 - dx;
        if (bits & 2) dy = 1 - dy;
        const destination = corners.findIndex(([cx, cy]) => cx === dx && cy === dy);
        expect(native[mask]![destination]).toBe(source);
      }
    }), { numRuns: 80 });
  });

  it("preserves D4 compositions for every pair of native corner permutations", () => {
    const native = [[0,1,2,3], [3,2,1,0], [1,0,3,2], [2,3,0,1], [3,0,1,2], [0,3,2,1], [2,1,0,3], [1,2,3,0]];
    const expectedMasks = [0,1,2,3,6,4,7,5];
    const raw = (bits: number) => ((bits & 1 ? FLIP_H : 0) | (bits & 2 ? FLIP_V : 0) | (bits & 4 ? FLIP_D : 0)) >>> 0;
    const small = (bits: number) => (bits & FLIP_H ? 1 : 0) | (bits & FLIP_V ? 2 : 0) | (bits & FLIP_D ? 4 : 0);
    const permutation = (bits: number) => {
      const f = defoldOrientation(bits);
      const mask = f.h_flip | f.v_flip << 1 | f.rotate90 << 2;
      expect(mask).toBe(expectedMasks[bits]);
      return native[mask]!;
    };
    for (let before = 0; before < 8; before++) for (let after = 0; after < 8; after++) {
      const combined = permutation(small(composeOrientation(raw(before), raw(after))));
      for (let source = 0; source < 4; source++) {
        expect(combined.indexOf(source)).toBe(permutation(after).indexOf(permutation(before).indexOf(source)));
      }
    }
  });

  it("reconstructs arbitrary resolved collision grids exactly from exported rectangles", () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 72, maxLength: 72 }), (values) => {
      const store = setup(6, 6);
      for (let layer = 0; layer < 2; layer++) {
        const id = `collision-${layer}`;
        store.dispatch({ type: "addLayer", layer: { id, name: id, type: "grid", role: "collision", visible: false } });
        store.dispatch({ type: "paintGrid", layerId: id, cells: values.slice(layer * 36, layer * 36 + 36).map((value, i) => ({ x: i % 6, y: Math.floor(i / 6), value })) });
      }
      const reconstructed = new Uint8Array(36);
      for (const file of exportDefold(store.document, "room", png)) {
        if (!file.path.endsWith(".collisionobject") || !("text" in file)) continue;
        const positions = [...file.text.matchAll(/position \{ x: ([\d.-]+) y: ([\d.-]+) z: 0 \}/g)];
        const data = [...file.text.matchAll(/\bdata: ([\d.]+)/g)].map((match) => Number(match[1]));
        for (const [i, position] of positions.entries()) {
          const w = data[i * 3]! / 8, h = data[i * 3 + 1]! / 8;
          const x0 = Number(position[1]) / 16 - w / 2, y0 = -Number(position[2]) / 16 - h / 2;
          for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
            const index = y * 6 + x;
            reconstructed[index] = reconstructed[index]! + 1;
          }
        }
      }
      // Counts also prove rectangles do not accidentally overlap.
      expect(reconstructed).toEqual(deriveCollision(store.document).data);
    }), { numRuns: 40 });
  });
});
