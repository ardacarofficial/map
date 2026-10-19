import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDocument, exportGameJson, makeCell, MapStore, type Tileset } from "../src";
import { exportGodot, preflightGodot, encodeGodotCells } from "../src/export/godot";
import { godotFixture, fixturePng } from "./fixtures/godot/input";

/** Independent reader: no encoder constants, DataView or production decoding helpers. */
function decode(text: string): number[][] {
  const payload = /tile_map_data = PackedByteArray\(([^)]*)\)/.exec(text)![1]!;
  const bytes = payload.trim() ? payload.split(",").map(Number) : [];
  if (!bytes.length) return [];
  expect(bytes.slice(0, 2)).toEqual([0, 0]);
  expect((bytes.length - 2) % 12).toBe(0);
  const signed = (offset: number) => { const n = bytes[offset]! + bytes[offset + 1]! * 256; return n >= 32768 ? n - 65536 : n; };
  const rows: number[][] = [];
  for (let i = 2; i < bytes.length; i += 12) rows.push(Array.from({ length: 6 }, (_, field) => signed(i + field * 2)));
  return rows;
}
function texts() {
  const { store, bytes } = godotFixture();
  const result = exportGodot([{ doc: store.document, name: 'Map "one"' }], bytes);
  return { store, bytes, result, scene: result.files.find(f => f.path.endsWith(".tscn"))!.text!, tileset: result.files.find(f => f.path.endsWith(".tres"))!.text! };
}

describe("Godot 4 export", () => {
  it("writes sparse row-major records, multiple atlas sources and all eight D4 flags", () => {
    const { scene, tileset } = texts();
    const first = scene.split('[node ')[2]!;
    expect(decode(first)).toEqual(Array.from({ length: 8 }, (_, i) => [i * 2, 0, 0, 1, 1, i * 4096]));
    expect(decode(scene.split('[node ')[3]!)).toEqual([[3, 2, 1, 0, 1, 0]]);
    expect(tileset).toContain("margins = Vector2i(1, 1)");
    expect(tileset).toContain("separation = Vector2i(2, 2)");
    expect(tileset).toContain("texture_region_size = Vector2i(16, 16)");
    expect(tileset).toContain("1:1/0 = 0");
    expect(tileset).not.toContain("0:0/0 = 0\n1:0/0 = 0");
  });

  it("independently proves transpose then H/V against the eight corner permutations", () => {
    // Original corners are [top-left, top-right, bottom-left, bottom-right].
    const expected = [[0,1,2,3], [1,0,3,2], [2,3,0,1], [3,2,1,0], [0,2,1,3], [2,0,3,1], [1,3,0,2], [3,1,2,0]];
    const rows = decode(texts().scene.split('[node ')[2]!);
    for (let i = 0; i < rows.length; i++) {
      const flags = rows[i]![5]!;
      const corners = [0, 0, 0, 0];
      for (let pixel = 0; pixel < 4; pixel++) {
        let x = pixel % 2, y = Math.floor(pixel / 2);
        if (flags & 16384) [x, y] = [y, x];
        if (flags & 4096) x = 1 - x;
        if (flags & 8192) y = 1 - y;
        corners[y * 2 + x] = pixel;
      }
      expect(corners).toEqual(expected[i]);
    }
  });

  it("encodes signed boundaries without wrapping and rejects invalid ids, coordinates and flags", () => {
    const cell = { x: -32768, y: 32767, sourceId: 32767, atlasX: 32767, atlasY: 0, alternative: 28672 };
    const encoded = encodeGodotCells([cell]);
    expect(decode(`tile_map_data = PackedByteArray(${[...encoded].join(", ")})`)).toEqual([[-32768,32767,32767,32767,0,28672]]);
    for (const [field, value] of [["x", -32769], ["y", 32768], ["sourceId", 32768], ["atlasX", -1], ["atlasY", 32768], ["alternative", 32768], ["alternative", 1], ["x", 1.5]] as const) {
      expect(() => encodeGodotCells([{ ...cell, [field]: value }])).toThrow(RangeError);
    }
    expect(encodeGodotCells([])).toEqual(new Uint8Array());
    fc.assert(fc.property(fc.integer({ min: -32768, max: 32767 }), fc.integer({ min: -32768, max: 32767 }), (x, y) => {
      const b = encodeGodotCells([{ ...cell, x, y }]);
      expect(decode(`tile_map_data = PackedByteArray(${[...b].join(",")})`)[0]!.slice(0,2)).toEqual([x,y]);
    }));
  });

  it("preserves hidden and opacity layers; collision resolves explicit passes even on empty visual cells", () => {
    const { scene, tileset } = texts();
    expect(scene).toContain("visible = false\nmodulate = Color(1, 1, 1, 0.25)");
    expect(scene.match(/texture_filter = 1/g)).toHaveLength(4);
    const collision = scene.split('[node ')[5]!;
    expect(decode(collision)).toEqual([[2, 3, 2, 0, 0, 0]]);
    expect(tileset).toContain("physics_layer_0/collision_layer = 1");
    expect(tileset).toContain("0:0/0/physics_layer_0/polygon_0/points = PackedVector2Array(-8, -8, 8, -8, 8, 8, -8, 8)");
    expect(scene).toContain("collision_enabled = false");
    expect(tileset).toContain("colors = PackedColorArray(0, 0, 0, 0, 0, 0, 0, 0)");
  });

  it("escapes resource names, preserves original node names in metadata and resolves sanitized-name collisions", () => {
    const { scene, tileset } = texts();
    expect(tileset).toContain('resource_name = "Atlas \\"road\\"\\n\\\\"');
    expect(scene).toContain('metadata/smap_layer_name = "Ground \\"road\\"\\n\\\\"');
    const nodeNames = [...scene.matchAll(/^\[node name=("(?:[^"\\]|\\.)*")/gm)].map(m => JSON.parse(m[1]!) as string);
    expect(new Set(nodeNames).size).toBe(nodeNames.length);
    expect(nodeNames.every(name => !/[.:@/\\"%\n]/.test(name))).toBe(true);
  });

  it("preserves valid punctuation and Unicode names, and disambiguates encoded names", () => {
    const { store, bytes } = godotFixture();
    store.dispatch({ type: "setLayerProps", layerId: "ground", props: { name: "a.b" } });
    store.dispatch({ type: "setLayerProps", layerId: "deco", props: { name: "a_u2e_b" } });
    store.dispatch({ type: "setLayerProps", layerId: "empty", props: { name: "Trees (front) + café 🌲" } });
    const scene = exportGodot([{ doc: store.document, name: "Names" }], bytes).files.find(f => f.path.endsWith(".tscn"))!.text!;
    expect(scene).toContain('[node name="a_u2e_b"');
    expect(scene).toContain('[node name="a_u2e_b 2"');
    expect(scene).toContain('[node name="Trees (front) + café 🌲"');
    expect(scene).toContain('metadata/smap_layer_name = "a.b"');
  });

  it("plans byte-identical output repeatedly, retains exact game JSON and includes generated PNGs", () => {
    const { store, bytes, result } = texts();
    expect(exportGodot([{ doc: store.document, name: 'Map "one"' }], bytes)).toEqual(result);
    expect(result.files.find(f => f.path.endsWith(".json"))!.text).toContain('"smapExport": 1');
    expect(result.files.filter(f => f.bytes).map(f => f.path)).toEqual(["smap/road.png", "smap/items.png"]);
    expect(result.files[0]!.bytes).toEqual(fixturePng(36, 36));
    const selection = exportGodot([{ doc: store.document, name: "only", layers: [] }], bytes, { collision: false, resourceRoot: "levels/one" });
    expect(selection.files.map(f => f.path)).toEqual(["levels/one/tileset.tres", "levels/one/only.json", "levels/one/only.tscn"]);
    expect(selection.files[2]!.text).not.toContain("TileMapLayer");
  });

  it("shares one TileSet across maps, unions used tiles, and keeps stable source ids", () => {
    const { store, bytes } = godotFixture();
    const result = exportGodot([{ doc: store.document, name: "b" }, { doc: store.document, name: "a", layers: ["deco"] }], bytes);
    expect(result.files.filter(f => f.path.endsWith(".tres"))).toHaveLength(1);
    expect(result.files.filter(f => f.path.endsWith(".tscn")).map(f => f.path)).toEqual(["smap/a.tscn", "smap/b.tscn"]);
    const a = result.files.find(f => f.path === "smap/a.tscn")!.text!;
    expect(decode(a.split('[node ')[2]!)[0]![2]).toBe(1);
    expect(a).toContain('path="res://smap/tileset.tres"');
  });

  it("preflights missing/invalid images, mismatched native sizes, resource traversal and invalid tiles before planning", () => {
    const { store, bytes } = godotFixture();
    const maps = [{ doc: store.document, name: "a" }];
    expect(preflightGodot(maps, () => undefined).map(p => p.key)).toContain("godotExport.missingImage");
    expect(() => exportGodot(maps, () => undefined)).toThrow("godotExport.missingImage");
    expect(preflightGodot(maps, () => new Uint8Array([1])).map(p => p.key)).toContain("godotExport.invalidImage");
    expect(preflightGodot(maps, () => fixturePng(1,1)).map(p => p.key)).toContain("godotExport.imageTooSmall");
    for (const resourceRoot of ["../bad", "/bad", "res://bad", "bad\\path", "bad//path", "CON", "a/..", "bad."]) {
      expect(preflightGodot(maps, bytes, { resourceRoot }).map(p => p.key)).toContain("godotExport.invalidRoot");
    }
    const tileset: Tileset = { id: "small", name: "Small", imagePath: "small.png", tileWidth: 8, tileHeight: 8, columns: 1, rows: 1, margin: 0, spacing: 0 };
    const small = new MapStore(createDocument({ width: 1, height: 1, tilesets: [tileset] }));
    small.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
    small.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 0, y: 0, cell: makeCell(small.getOrAddPaletteIndex("small", 0)) }] });
    expect(preflightGodot([{ doc: small.document, name: "a" }], () => fixturePng(8,8)).map(p => p.key)).toContain("godotExport.nativeSizeMismatch");
    small.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 0, y: 0, cell: makeCell(small.document.palette._getOrAdd("small", 1)) }] });
    expect(preflightGodot([{ doc: small.document, name: "a" }], bytes).map(p => p.key)).toContain("godotExport.invalidTiles");
  });
});

/** Small independent Godot text parser for the syntax this target emits. */
function parseResource(text: string) {
  const sections: { kind: string; attributes: Record<string, string>; properties: string[] }[] = [];
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    if (line.startsWith("[")) {
      const match = /^\[(\w+)((?:\s+\w+=(?:"(?:[^"\\]|\\.)*"|\d+))*)\]$/.exec(line);
      expect(match, `Invalid section: ${line}`).not.toBeNull();
      const attributes: Record<string, string> = {};
      for (const attr of match![2]!.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\d+)/g)) attributes[attr[1]!] = attr[2]!.startsWith('"') ? JSON.parse(attr[2]!) as string : attr[2]!;
      sections.push({ kind: match![1]!, attributes, properties: [] });
    } else {
      expect(sections.length).toBeGreaterThan(0);
      expect(line).toMatch(/^[\w/:-]+ = .+$/);
      sections[sections.length - 1]!.properties.push(line);
    }
  }
  return sections;
}

describe("Godot resource structure and preflight limits", () => {
  it("parses section headers, ids, dependencies, load_steps, properties and references", () => {
    const { result } = texts();
    for (const file of result.files.filter(f => /\.(tres|tscn)$/.test(f.path))) {
      const sections = parseResource(file.text!);
      const header = sections[0]!;
      expect(header.attributes["format"]).toBe("3");
      const ext = sections.filter(s => s.kind === "ext_resource"), sub = sections.filter(s => s.kind === "sub_resource");
      expect(Number(header.attributes["load_steps"])).toBe(ext.length + sub.length + 1);
      for (const group of [ext, sub]) expect(new Set(group.map(s => s.attributes["id"])).size).toBe(group.length);
      const knownExt = new Set(ext.map(s => s.attributes["id"])), knownSub = new Set(sub.map(s => s.attributes["id"]));
      for (const section of sections) for (const prop of section.properties) {
        for (const ref of prop.matchAll(/(ExtResource|SubResource)\("([^"\n]+)"\)/g)) expect((ref[1] === "ExtResource" ? knownExt : knownSub).has(ref[2])).toBe(true);
      }
      for (const external of ext) expect(result.files.some(f => `res://${f.path}` === external.attributes["path"])).toBe(true);
      if (header.kind === "gd_resource") expect(sections.at(-1)!.kind).toBe("resource");
      else {
        const nodes = sections.filter(s => s.kind === "node");
        expect(nodes[0]!.attributes["type"]).toBe("Node2D");
        for (const child of nodes.slice(1)) expect(child.attributes).toMatchObject({ type: "TileMapLayer", parent: "." });
      }
    }
  });

  it("is independent of palette allocation, chunk insertion and map input ordering", () => {
    const { store, bytes } = godotFixture();
    const a = exportGodot([{ doc: store.document, name: "b" }, { doc: store.document, name: "a" }], bytes);
    const b = exportGodot([{ doc: store.document, name: "a" }, { doc: store.document, name: "b" }], bytes);
    expect(a).toEqual(b);
    const replacement = new MapStore(createDocument({ ...store.document.map, tilesets: [...store.document.tilesets].reverse() }));
    for (const layer of store.document.layers) {
      if (layer.type !== "tile") continue;
      replacement.dispatch({ type: "addLayer", layer: { ...layer.props(), id: layer.id } });
    }
    // Allocate the palette in reverse tile order; paint spatially in reverse order.
    const item = replacement.getOrAddPaletteIndex("b-items", 2), road = replacement.getOrAddPaletteIndex("a-road", 3);
    replacement.dispatch({ type: "paintCells", layerId: "deco", cells: [{ x: 3, y: 2, cell: makeCell(item) }] });
    replacement.dispatch({ type: "paintCells", layerId: "ground", cells: Array.from({ length: 8 }, (_, n) => { const i = 7 - n; return { x: i * 2, y: 0, cell: makeCell(road, store.document.getLayer("ground")!.getCell(i * 2,0) & 0xe0000000) }; }) });
    const scene = exportGodot([{ doc: replacement.document, name: 'Map "one"' }], bytes, { collision: false });
    const original = exportGodot([{ doc: store.document, name: 'Map "one"' }], bytes, { collision: false });
    expect(scene.files.find(f => f.path.endsWith(".tscn"))).toEqual(original.files.find(f => f.path.endsWith(".tscn")));
    expect(scene.files.find(f => f.path.endsWith(".tres"))).toEqual(original.files.find(f => f.path.endsWith(".tres")));
  });

  it("rejects atlas int16 overflow, filename conflicts, inconsistent sources and shared cell sizes", () => {
    const t: Tileset = { id: "wide", name: "Wide", imagePath: "wide.png", tileWidth: 1, tileHeight: 1, columns: 32769, rows: 1, margin: 0, spacing: 0 };
    const store = new MapStore(createDocument({ width: 1, height: 1, tileWidth: 1, tileHeight: 1, tilesets: [t] }));
    store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
    store.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 0, y: 0, cell: makeCell(store.getOrAddPaletteIndex(t.id, 32768)) }] });
    const input = { doc: store.document, name: "a" }, bytes = () => fixturePng(32769, 1);
    expect(preflightGodot([input], bytes).map(p => p.key)).toContain("godotExport.overflow");
    expect(preflightGodot([input, { ...input, name: "A" }], bytes).map(p => p.key)).toContain("godotExport.fileConflict");
    expect(preflightGodot([], bytes)).toEqual([{ key: "godotExport.noMaps", params: {} }]);
    const other = createDocument({ width: 1, height: 1, tileWidth: 16, tileHeight: 16 });
    expect(preflightGodot([input, { doc: other, name: "other" }], bytes).map(p => p.key)).toContain("godotExport.differentCellSizes");
    const { store: original } = godotFixture();
    const { store: changed } = godotFixture();
    changed.document._replaceTileset({ ...changed.document.tilesets[0]!, margin: 0 });
    expect(preflightGodot([{ doc: original.document, name: "a" }, { doc: changed.document, name: "b" }], () => fixturePng(36,36)).map(p => p.key)).toContain("godotExport.inconsistentTileset");
  });
});

describe("Godot companion and supported extents", () => {
  it("retains entities, portal targets and spawn exactly as the game JSON exporter", () => {
    const { store, bytes } = godotFixture();
    store.dispatch({ type: "addLayer", layer: { id: "entities", name: "Entities", type: "entity" } });
    store.dispatch({ type: "addEntity", layerId: "entities", entity: { id: "start", typeId: "spawn", x: 0, y: 16 } });
    store.dispatch({ type: "addEntity", layerId: "entities", entity: { id: "door", typeId: "portal", x: 32, y: 16, fields: { targetLevel: "stable-level-id", targetPoint: { x: 4, y: 8 } } } });
    const result = exportGodot([{ doc: store.document, name: "entities", layers: ["ground"] }], bytes, { collision: false });
    const companion = result.files.find(f => f.path.endsWith(".json"))!.text!;
    expect(companion).toBe(exportGameJson(store.document, { layers: ["ground"], collision: false }));
    const parsed = JSON.parse(companion) as { spawn: { x: number; y: number }; entities: { items: { fields: { value: unknown }[] }[] }[] };
    expect(parsed.spawn).toMatchObject({ x: 0, y: 16 });
    expect(companion).toContain("stable-level-id");
    expect(parsed.entities[0]!.items).toHaveLength(2);
  });

  it("supports rectangular cells without transpose and rejects transpose or oversized cell textures", () => {
    const t: Tileset = { id: "rect", name: "Rect", imagePath: "rect.png", tileWidth: 16, tileHeight: 8, columns: 1, rows: 1, margin: 0, spacing: 0 };
    const store = new MapStore(createDocument({ width: 1, height: 1, tileWidth: 16, tileHeight: 8, tilesets: [t] }));
    store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
    const index = store.getOrAddPaletteIndex(t.id, 0), maps = [{ doc: store.document, name: "rect" }], bytes = () => fixturePng(16,8);
    store.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 0, y: 0, cell: makeCell(index) }] });
    expect(preflightGodot(maps, bytes)).toEqual([]);
    expect(exportGodot(maps, bytes, { resourceRoot: "" }).files.find(f => f.path.endsWith(".tres"))!.text).toContain("tile_size = Vector2i(16, 8)");
    store.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 0, y: 0, cell: makeCell(index, 0x20000000) }] });
    expect(preflightGodot(maps, bytes).map(p => p.key)).toContain("godotExport.rectangularTranspose");
    const huge = createDocument({ width: 1, height: 1, tileWidth: 16385 });
    expect(preflightGodot([{ doc: huge, name: "huge" }], bytes).map(p => p.key)).toContain("godotExport.cellSizeOutOfRange");
  });
});

describe("Godot native size policy", () => {
  it.each([8, 64])("rejects %i px source art in a 32 px map without changing PNG bytes", size => {
    const t: Tileset = { id: "native", name: "Native", imagePath: "native.png", tileWidth: size, tileHeight: size, columns: 1, rows: 1, margin: 0, spacing: 0 };
    const store = new MapStore(createDocument({ width: 1, height: 1, tilesets: [t] }));
    store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
    store.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 0, y: 0, cell: makeCell(store.getOrAddPaletteIndex(t.id, 0)) }] });
    const bytes = fixturePng(size,size), before = bytes.slice(), input = [{ doc: store.document, name: "native" }];
    expect(preflightGodot(input, () => bytes)).toEqual([{ key: "godotExport.nativeSizeMismatch", params: { tileset: "Native", nativeWidth: size, nativeHeight: size, cellWidth: 32, cellHeight: 32 } }]);
    expect(() => exportGodot(input, () => bytes)).toThrow("godotExport.nativeSizeMismatch");
    expect(bytes).toEqual(before);
  });
});
