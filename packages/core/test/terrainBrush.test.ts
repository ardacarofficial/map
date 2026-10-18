import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cellPaletteIndex,
  createDocument,
  deriveTerrainTiles,
  legacyTerrainToSet,
  makeCell,
  MapStore,
  normalizeTileset,
  serializeLevel,
  tagBlockWithTemplate,
  terrainCellInfo,
  terrainErase,
  terrainFill,
  terrainPaint,
  type MapDocument,
  type TerrainCorners,
  type TerrainSet,
  type TerrainTemplate,
  type Tileset,
} from "../src";
import { BLOB_TEMPLATES, TERRAIN_TILESET, makeTerrainStore } from "./helpers";

const G = 1;
const D = 2;
const W = 3;

/** 16×8 tileset "ground". Row 0: grass/dirt (bit set = grass, tile = mask). Row 1: dirt/water (bit = water), mask 1..15. */
const GROUND: Tileset = {
  id: "ground",
  name: "Ground",
  imagePath: "tilesets/ground.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 16,
  rows: 8,
  margin: 0,
  spacing: 0,
};

/** corner16 mask (NE 1, SE 2, SW 4, NW 8) → [nw, ne, se, sw]. */
const corners = (mask: number, on: number, off: number): TerrainCorners => [mask & 8 ? on : off, mask & 1 ? on : off, mask & 2 ? on : off, mask & 4 ? on : off];

function groundSet(extra: { tileId: number; corners: TerrainCorners }[] = []): TerrainSet {
  const tiles: { tileId: number; corners: TerrainCorners }[] = [];
  for (let m = 0; m < 16; m++) tiles.push({ tileId: m, corners: corners(m, G, D) });
  for (let m = 1; m < 16; m++) tiles.push({ tileId: 16 + m, corners: corners(m, W, D) });
  return {
    id: "ground",
    name: "Ground",
    kind: "corner",
    terrains: [
      { id: G, name: "Grass", color: "#00ff00" },
      { id: D, name: "Dirt", color: "#885500" },
      { id: W, name: "Water", color: "#0000ff" },
    ],
    tiles: [...tiles, ...extra],
  };
}

/** A store with GROUND + its corner set and a tile layer "l", optionally filled with full grass. */
function groundStore(width = 20, height = 20, fillGrass = true, set: TerrainSet = groundSet(), seed = 0) {
  const store = new MapStore(createDocument({ width, height, seed }));
  store.dispatch({ type: "addTileset", tileset: GROUND });
  store.dispatch({ type: "setTerrainSet", tilesetId: "ground", set });
  store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
  if (fillGrass) {
    const cell = makeCell(store.getOrAddPaletteIndex("ground", 15));
    const cells = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push({ x, y, cell });
    store.dispatch({ type: "paintCells", layerId: "l", cells });
  }
  store.clearHistory();
  return store;
}

const brush = (terrainId: number) => ({ tilesetId: "ground", setId: "ground", terrainId });

function tileId(doc: MapDocument, x: number, y: number, layerId = "l"): number | null {
  const cell = doc.getLayer(layerId)!.getCell(x, y);
  return cell === 0 ? null : doc.palette.get(cellPaletteIndex(cell))!.tileId;
}

function cornersAt(doc: MapDocument, x: number, y: number): TerrainCorners | "empty" | "fixed" {
  const info = terrainCellInfo(doc, "l", x, y, "ground", "ground")!;
  return info.kind === "corner" ? info.corners : info.kind === "empty" ? "empty" : (info.kind as "fixed");
}

/** Shared corners of tagged neighbours that disagree ("x,y" pairs). */
function cornerConflicts(doc: MapDocument): string[] {
  const out: string[] = [];
  const { width, height } = doc.map;
  const get = (x: number, y: number) => {
    const c = cornersAt(doc, x, y);
    return c === "empty" ? ([0, 0, 0, 0] as const) : c === "fixed" ? null : c;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = get(x, y);
      if (!c) continue;
      const e = x + 1 < width ? get(x + 1, y) : null;
      if (e && (c[1] !== e[0] || c[2] !== e[3])) out.push(`${x},${y}|${x + 1},${y}`);
      const s = y + 1 < height ? get(x, y + 1) : null;
      if (s && (c[3] !== s[0] || c[2] !== s[1])) out.push(`${x},${y}|${x},${y + 1}`);
    }
  }
  return out;
}

function paint(store: MapStore, cells: [number, number][], terrainId: number, extra: { erase?: boolean; fill?: boolean } = {}) {
  return store.dispatch({ type: "paintTerrainBrush", layerId: "l", cells: cells.map(([x, y]) => ({ x, y })), tilesetId: "ground", setId: "ground", terrainId, ...extra });
}

describe("tagBlockWithTemplate (tagging macros)", () => {
  const base: Tileset = { ...TERRAIN_TILESET, terrainSets: [] };
  const withSet = (kind: "corner" | "blob"): Tileset =>
    normalizeTileset({ ...base, terrainSets: [{ id: "s", name: "S", kind, terrains: [{ id: 1, name: "A", color: "#ffffff" }, { id: 2, name: "B", color: "#000000" }], tiles: [] }] });

  it("corner16: corner bits → corners, empty slot skipped, background fills the rest", () => {
    const t = tagBlockWithTemplate(withSet("corner"), "s", 1, "corner16", { col: 8, row: 0 });
    const set = t.terrainSets![0]!;
    expect(set.tiles.length).toBe(15);
    expect(set.tiles.find((x) => x.tileId === 8)).toBeUndefined(); // slot 0 = no terrain
    expect(set.tiles.find((x) => x.tileId === 9)!.corners).toEqual([0, 1, 0, 0]); // slot 1 = NE
    expect(set.tiles.find((x) => x.tileId === 8 + 3 + 36)!.corners).toEqual([1, 1, 1, 1]); // slot 15

    const bg = tagBlockWithTemplate(withSet("corner"), "s", 1, "corner16", { col: 8, row: 0 }, 2);
    expect(bg.terrainSets![0]!.tiles.length).toBe(16);
    expect(bg.terrainSets![0]!.tiles[0]!.corners).toEqual([2, 2, 2, 2]);
    expect(bg.terrainSets![0]!.background).toBe(2);
  });

  it("blob47 layouts: every used slot tagged with its reduced mask", () => {
    for (const template of BLOB_TEMPLATES) {
      const t = tagBlockWithTemplate(withSet("blob"), "s", 2, template, { col: 0, row: 0 });
      const set = t.terrainSets![0]!;
      expect(set.tiles.length).toBe(47);
      expect(new Set(set.tiles.map((x) => x.mask)).size).toBe(47);
      expect(set.tiles.every((x) => x.terrainId === 2)).toBe(true);
    }
  });

  it("rejects mismatched kinds, unknown terrains and blocks that do not fit", () => {
    expect(() => tagBlockWithTemplate(withSet("blob"), "s", 1, "corner16", { col: 0, row: 0 })).toThrow(/needs a corner set/);
    expect(() => tagBlockWithTemplate(withSet("corner"), "s", 9, "corner16", { col: 0, row: 0 })).toThrow(/no terrain 9/);
    expect(() => tagBlockWithTemplate(withSet("blob"), "s", 1, "blob47-godot", { col: 1, row: 0 })).toThrow(/does not fit/);
    expect(() => tagBlockWithTemplate(withSet("blob"), "x", 1, "blob47-godot", { col: 0, row: 0 })).toThrow(/unknown terrain set/);
  });
});

describe("terrainPaint — single terrain over empty equals the v0.3 derivation", () => {
  /** Paints `cells` with the old grid model and with the brush (legacy set migrated); compares the tiles. */
  function compare(template: TerrainTemplate, cells: [number, number][], legacyId: number) {
    const legacy = makeTerrainStore(14, 12, 5, template === "corner16" ? "blob47" : template);
    legacy.dispatch({ type: "paintTerrain", layerId: "terrain", cells: cells.map(([x, y]) => ({ x, y, value: legacyId })) });
    const derived = deriveTerrainTiles(legacy.document, "terrain");

    const doc = createDocument({ width: 14, height: 12, seed: 5 });
    const terrain = legacy.document.getTerrain(legacyId)!;
    const set = legacyTerrainToSet(legacy.document.getTileset("terrain")!, terrain);
    const store = new MapStore(doc);
    store.dispatch({ type: "addTileset", tileset: { ...TERRAIN_TILESET, terrainSets: [set] } });
    store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
    store.dispatch({ type: "paintTerrainBrush", layerId: "l", cells: cells.map(([x, y]) => ({ x, y })), tilesetId: "terrain", setId: set.id, terrainId: 1 });
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 14; x++) expect(tileId(store.document, x, y)).toBe(derived[y * 14 + x]?.tileId ?? null);
    }
  }

  const shape = fc.array(fc.tuple(fc.nat({ max: 13 }), fc.nat({ max: 11 })), { minLength: 1, maxLength: 40 });

  for (const template of BLOB_TEMPLATES) {
    it(`blob shapes (${template}) match`, () => {
      fc.assert(fc.property(shape, (cells) => compare(template, cells, 1)), { numRuns: 30 });
    });
  }

  it("corner16 shapes match", () => {
    fc.assert(fc.property(shape, (cells) => compare("corner16", cells, 2)), { numRuns: 30 });
  });

  it("painting stroke by stroke gives the same result as one stroke (blob)", () => {
    fc.assert(
      fc.property(shape, (cells) => {
        const legacy = makeTerrainStore(14, 12, 0, "blob47-godot");
        const set = legacyTerrainToSet(legacy.document.getTileset("terrain")!, legacy.document.getTerrain(1)!);
        const make = () => {
          const s = new MapStore(createDocument({ width: 14, height: 12 }));
          s.dispatch({ type: "addTileset", tileset: { ...TERRAIN_TILESET, terrainSets: [set] } });
          s.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
          return s;
        };
        const one = make();
        one.dispatch({ type: "paintTerrainBrush", layerId: "l", cells: cells.map(([x, y]) => ({ x, y })), tilesetId: "terrain", setId: set.id, terrainId: 1 });
        const many = make();
        for (const [x, y] of cells) many.dispatch({ type: "paintTerrainBrush", layerId: "l", cells: [{ x, y }], tilesetId: "terrain", setId: set.id, terrainId: 1 });
        for (let y = 0; y < 12; y++) for (let x = 0; x < 14; x++) expect(tileId(many.document, x, y)).toBe(tileId(one.document, x, y));
      }),
      { numRuns: 20 },
    );
  });
});

describe("terrainPaint — corner sets with several terrains", () => {
  it("dirt over grass: direct transitions, consistent corners", () => {
    const store = groundStore();
    paint(store, [[5, 5]], D);
    expect(tileId(store.document, 5, 5)).toBe(0); // all dirt
    expect(cornersAt(store.document, 6, 5)).toEqual([D, G, G, D]);
    expect(cornersAt(store.document, 6, 6)).toEqual([D, G, G, G]);
    expect(cornersAt(store.document, 4, 4)).toEqual([G, G, D, G]);
    expect(tileId(store.document, 8, 8)).toBe(15); // untouched
    expect(cornerConflicts(store.document)).toEqual([]);
  });

  it("water over grass: no grass–water tile, so a dirt ring is put in between", () => {
    const store = groundStore();
    paint(store, [[10, 10]], W);
    const doc = store.document;
    expect(cornersAt(doc, 10, 10)).toEqual([W, W, W, W]);
    expect(cornerConflicts(doc)).toEqual([]);
    // No tile mixes grass and water; every tagged cell is a real tile of the set.
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const c = cornersAt(doc, x, y) as TerrainCorners;
        expect(c.includes(G) && c.includes(W)).toBe(false);
      }
    }
    // Dirt appears around the water, grass beyond.
    expect(cornersAt(doc, 11, 10)).toEqual([W, D, D, W]);
    expect(cornersAt(doc, 12, 10)).toEqual([D, G, G, D]);
    expect(tileId(doc, 14, 14)).toBe(15);
  });

  it("water next to an existing dirt area uses the direct dirt–water tiles", () => {
    const store = groundStore();
    const square: [number, number][] = [];
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) square.push([x, y]);
    paint(store, square, D);
    paint(store, [[7, 7]], W);
    const doc = store.document;
    expect(cornersAt(doc, 8, 7)).toEqual([W, D, D, W]);
    expect(cornersAt(doc, 9, 7)).toEqual([D, D, D, D]);
    expect(cornerConflicts(doc)).toEqual([]);
  });

  it("finds a path through several intermediate terrains (A–B–C–E chain)", () => {
    const pair = (base: number, a: number, b: number) =>
      Array.from({ length: 16 }, (_, m) => ({ tileId: base + m, corners: corners(m, b, a) })).filter((_t, m) => base === 0 || m !== 0);
    const set: TerrainSet = {
      id: "ground",
      name: "Chain",
      kind: "corner",
      terrains: [1, 2, 3, 4].map((id) => ({ id, name: `t${id}`, color: "#123456" })),
      tiles: [...pair(0, 1, 2), ...pair(16, 2, 3), ...pair(32, 3, 4)], // A/B, B/C, C/E
    };
    const store = groundStore(21, 21, false, set);
    const full = makeCell(store.getOrAddPaletteIndex("ground", 0)); // all A
    const cells = [];
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) cells.push({ x, y, cell: full });
    store.dispatch({ type: "paintCells", layerId: "l", cells });
    paint(store, [[10, 10]], 4);
    const doc = store.document;
    expect(cornerConflicts(doc)).toEqual([]);
    expect(cornersAt(doc, 10, 10)).toEqual([4, 4, 4, 4]);
    expect(cornersAt(doc, 11, 10)).toEqual([4, 3, 3, 4]);
    expect(cornersAt(doc, 12, 10)).toEqual([3, 2, 2, 3]);
    expect(cornersAt(doc, 13, 10)).toEqual([2, 1, 1, 2]);
    expect(cornersAt(doc, 14, 10)).toEqual([1, 1, 1, 1]);
  });

  it("a terrain without transitions stays where it is painted (best partial match)", () => {
    const grassDirtOnly = groundSet().tiles.filter((t) => t.tileId < 16);
    const store = groundStore(10, 10, true, { ...groundSet(), tiles: [...grassDirtOnly, { tileId: 50, corners: [W, W, W, W] }] });
    paint(store, [[5, 5]], W);
    expect(tileId(store.document, 5, 5)).toBe(50);
    for (const [x, y] of [[4, 4], [5, 4], [6, 5], [6, 6], [4, 6]] as const) expect(tileId(store.document, x, y)).toBe(15);
  });

  it("erasing in a set without empty transitions leaves a hole and keeps the neighbours", () => {
    const store = groundStore();
    paint(store, [[5, 5]], 0, { erase: true });
    expect(tileId(store.document, 5, 5)).toBeNull();
    expect(tileId(store.document, 6, 5)).toBe(15);
  });

  it("manual (untagged) neighbours are never overwritten; painting onto one replaces it", () => {
    const store = groundStore();
    const manual = makeCell(store.getOrAddPaletteIndex("ground", 100));
    store.dispatch({ type: "paintCells", layerId: "l", cells: [{ x: 6, y: 5, cell: manual }, { x: 2, y: 2, cell: manual }] });
    paint(store, [[5, 5]], W);
    expect(store.document.getLayer("l")!.getCell(6, 5)).toBe(manual);
    expect(cornersAt(store.document, 5, 5)).toEqual([W, W, W, W]);
    paint(store, [[2, 2]], D);
    expect(tileId(store.document, 2, 2)).toBe(0);
  });

  it("a flipped tile is read with its flips", () => {
    const store = groundStore();
    // tile 1 = NE grass only; flipped horizontally it shows NW grass.
    const cell = makeCell(store.getOrAddPaletteIndex("ground", 1), 0x8000_0000);
    store.dispatch({ type: "paintCells", layerId: "l", cells: [{ x: 3, y: 3, cell }] });
    expect(cornersAt(store.document, 3, 3)).toEqual([G, D, D, D]);
  });

  it("is deterministic and independent of the cell order; variants by hash(seed, x, y)", () => {
    const set = groundSet([{ tileId: 40, corners: [G, G, G, G] }]);
    const cells: [number, number][] = [];
    for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) cells.push([x, y]);
    const run = (order: [number, number][], seed: number) => {
      const store = groundStore(20, 20, false, set, seed);
      return terrainPaint(store.document, "l", order.map(([x, y]) => ({ x, y })), brush(G));
    };
    const a = run(cells, 7);
    expect(run([...cells].reverse(), 7)).toEqual(a);
    const ids = new Set(a.map((w) => w.tile?.tileId));
    expect(ids.has(15) && ids.has(40)).toBe(true);
    expect(run(cells, 8)).not.toEqual(a);
  });
});

describe("terrainErase / terrainFill", () => {
  it("blob erase re-solves the neighbours (as in v0.3)", () => {
    const legacy = makeTerrainStore(12, 12, 0, "blob47-godot");
    const set = legacyTerrainToSet(legacy.document.getTileset("terrain")!, legacy.document.getTerrain(1)!);
    const store = new MapStore(createDocument({ width: 12, height: 12 }));
    store.dispatch({ type: "addTileset", tileset: { ...TERRAIN_TILESET, terrainSets: [set] } });
    store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
    const square = [];
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) square.push({ x, y });
    store.dispatch({ type: "paintTerrainBrush", layerId: "l", cells: square, tilesetId: "terrain", setId: set.id, terrainId: 1 });
    store.dispatch({ type: "paintTerrainBrush", layerId: "l", cells: [{ x: 6, y: 6 }], tilesetId: "terrain", setId: set.id, terrainId: 1, erase: true });
    legacy.dispatch({ type: "paintTerrain", layerId: "terrain", cells: square.map(({ x, y }) => ({ x, y, value: 1 })) });
    legacy.dispatch({ type: "paintTerrain", layerId: "terrain", cells: [{ x: 6, y: 6, value: 0 }] });
    const derived = deriveTerrainTiles(legacy.document, "terrain");
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) expect(tileId(store.document, x, y)).toBe(derived[y * 12 + x]?.tileId ?? null);
  });

  it("corner erase sets the corners to empty (or the set's background)", () => {
    const store = groundStore(10, 10, false, { ...groundSet(), id: "ground" });
    const square: [number, number][] = [];
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) square.push([x, y]);
    // Over empty there are no grass–empty tiles: use a background of dirt instead.
    store.dispatch({ type: "setTerrainSet", tilesetId: "ground", set: { ...groundSet(), background: D } });
    paint(store, square, D);
    paint(store, [[4, 4]], G);
    expect(cornersAt(store.document, 4, 4)).toEqual([G, G, G, G]);
    paint(store, [[4, 4]], 0, { erase: true });
    expect(cornersAt(store.document, 4, 4)).toEqual([D, D, D, D]);
    expect(cornersAt(store.document, 5, 4)).toEqual([D, D, D, D]);
    const writes = terrainErase(store.document, "l", [{ x: 4, y: 4 }], { tilesetId: "ground", setId: "ground" });
    expect(writes).toEqual([]); // already background
  });

  it("fill floods cells of the same terrain and paints them", () => {
    const store = groundStore();
    const square: [number, number][] = [];
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) square.push([x, y]);
    paint(store, square, D);
    paint(store, [[9, 9]], W, { fill: true });
    const doc = store.document;
    // The painted dirt cells (5..14, all pure dirt) became water; a dirt ring is put between water and grass.
    for (const [x, y] of square) expect(cornersAt(doc, x, y)).toEqual([W, W, W, W]);
    expect(cornersAt(doc, 4, 9)).toEqual([D, W, W, D]);
    expect(cornersAt(doc, 3, 9)).toEqual([G, D, D, G]);
    expect(cornerConflicts(doc)).toEqual([]);
    // Grass fill from outside covers the whole grass area (all pure grass cells).
    const writes = terrainFill(doc, "l", 0, 0, brush(G));
    expect(writes).toEqual([]); // already grass
  });
});

describe("paintTerrainBrush undo", () => {
  it("records all eleven blob strokes and restores each intermediate state", () => {
    const set = tagBlockWithTemplate(normalizeTileset({ ...TERRAIN_TILESET, terrainSets: [{ id: "b", name: "B", kind: "blob", terrains: [{ id: 1, name: "Grass", color: "#00ff00" }], tiles: [] }] }), "b", 1, "blob47-godot", { col: 0, row: 0 });
    const store = new MapStore(createDocument({ width: 40, height: 40, tilesets: [set] }));
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
    for (const tag of set.terrainSets![0]!.tiles) store.getOrAddPaletteIndex(set.id, tag.tileId);
    store.clearHistory();
    const states = [serializeLevel(store.document)];
    const stroke = (cells: { x: number; y: number }[], erase = false) => {
      store.beginTransaction();
      for (const cell of cells) store.dispatch({ type: "paintTerrainBrush", layerId, tilesetId: set.id, setId: "b", terrainId: 1, cells: [cell], erase });
      store.commit();
      states.push(serializeLevel(store.document));
      expect(store.undoDepth).toBe(states.length - 1);
    };
    for (let y = 10; y <= 16; y++) stroke(Array.from({ length: 10 }, (_, i) => ({ x: 9 + i, y })));
    stroke(Array.from({ length: 4 }, (_, i) => ({ x: 19 + i, y: 13 })));
    stroke([{ x: 23, y: 9 }]);
    stroke([{ x: 13, y: 13 }], true);
    stroke([{ x: 16, y: 15 }, { x: 17, y: 16 }], true);
    for (let i = states.length - 2; i >= 0; i--) { store.undo(); expect(serializeLevel(store.document)).toBe(states[i]); }
    for (let i = 1; i < states.length; i++) { store.redo(); expect(serializeLevel(store.document)).toBe(states[i]); }
  });

  it("random brush / erase / fill sequences undo to the initial bytes and redo to the final ones", () => {
    const op = fc.record({
      kind: fc.constantFrom("paint", "erase", "fill"),
      terrain: fc.constantFrom(G, D, W),
      cells: fc.array(fc.tuple(fc.nat({ max: 11 }), fc.nat({ max: 11 })), { minLength: 1, maxLength: 6 }),
    });
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 12 }), (ops) => {
        const store = groundStore(12, 12, true, groundSet(), 3);
        // Palette entries added on the way are not undoable (append-only); compare the cells.
        const cells = () => JSON.stringify(JSON.parse(serializeLevel(store.document)).layers);
        const initial = cells();
        for (const o of ops) paint(store, o.cells, o.terrain, o.kind === "paint" ? {} : { [o.kind]: true });
        const final = cells();
        expect(store.undoDepth).toBeLessThanOrEqual(ops.length);
        while (store.undo());
        expect(cells()).toBe(initial);
        while (store.redo());
        expect(cells()).toBe(final);
      }),
      { numRuns: 60 },
    );
  });

  it("one stroke is one undo step; a locked layer is skipped", () => {
    const store = groundStore();
    paint(store, [[3, 3], [4, 3], [5, 3]], W);
    expect(store.undoDepth).toBe(1);
    store.dispatch({ type: "setLayerProps", layerId: "l", props: { locked: true } });
    const patch = paint(store, [[10, 10]], W);
    expect(patch.cells.length).toBe(0);
  });
});

describe("oriented terrain writes and explicit blob boundaries", () => {
  it("preserves legacy solid boundaries and lets smart roads cap at empty map edges", () => {
    const store = groundStore(1, 1, false);
    const set = { id: "blob", name: "Blob", kind: "blob" as const, terrains: [{ id: 1, name: "Road", color: "#ffffff" }], tiles: [{ tileId: 0, terrainId: 1, mask: 0 }, { tileId: 1, terrainId: 1, mask: 255 }] };
    store.dispatch({ type: "setTerrainSet", tilesetId: "ground", set });
    const brush = { tilesetId: "ground", setId: "blob", terrainId: 1 };
    expect(terrainPaint(store.document, "l", [{ x: 0, y: 0 }], brush)[0]!.tile!.tileId).toBe(1);
    expect(terrainPaint(store.document, "l", [{ x: 0, y: 0 }], brush, { boundary: "empty" })[0]!.tile!.tileId).toBe(0);
  });

  it("passes composed orientation flags through store operations for corner and blob sets", () => {
    const store = groundStore(3, 3, false);
    store.dispatch({ type: "paintTerrainBrush", layerId: "l", cells: [{ x: 1, y: 1 }], tilesetId: "ground", setId: "ground", terrainId: 1, orientation: 0x80000000 });
    expect(store.document.getLayer("l")!.getCell(1, 1) >>> 31).toBe(1);
    expect(terrainCellInfo(store.document, "l", 1, 1, "ground", "ground")).toEqual({ kind: "corner", corners: [1, 1, 1, 1] });
  });
});
