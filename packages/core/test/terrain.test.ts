import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BLOB47_MASKS,
  TERRAIN_TEMPLATES,
  blob47Slot,
  cellHash,
  cellPaletteIndex,
  corner16Slot,
  deriveTerrainTiles,
  parseLevel,
  parseProject,
  reduceBlobMask,
  serializeLevel,
  serializeProject,
  terrainSlotTileId,
  terrainTileAt,
  type MapStore,
  type StoreChangeEvent,
} from "../src";
import { BLOB_ID, CORNER_ID, TERRAIN_TILESET, blobTile, cornerTile, makeTerrainStore } from "./helpers";

/** Tile id in the derived layer at (x, y), or null. */
function tileAt(store: MapStore, x: number, y: number): number | null {
  const cell = store.document.getLayer("tiles")!.getCell(x, y);
  if (cell === 0) return null;
  return store.document.palette.get(cellPaletteIndex(cell))!.tileId;
}

function paint(store: MapStore, points: readonly [number, number][], value: number) {
  return store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: points.map(([x, y]) => ({ x, y, value })) });
}

/** Asserts the derived layer holds exactly `expected` (`"x,y" → tile id`), everything else empty. */
function expectTiles(store: MapStore, expected: Record<string, number>) {
  const { width, height } = store.document.map;
  const actual: Record<string, number> = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tileAt(store, x, y);
      if (t !== null) actual[`${x},${y}`] = t;
    }
  }
  expect(actual).toEqual(expected);
}

const blob = (slots: Record<string, number>) => Object.fromEntries(Object.entries(slots).map(([k, s]) => [k, blobTile(s)]));
const corner = (slots: Record<string, number>) => Object.fromEntries(Object.entries(slots).map(([k, s]) => [k, cornerTile(s)]));
const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
};

describe("templates", () => {
  it("corner16: 16 masks map to 16 distinct slots in a 4×4 block, slot = NE + 2SE + 4SW + 8NW", () => {
    const slots = Array.from({ length: 16 }, (_, m) => corner16Slot(m));
    expect(new Set(slots).size).toBe(16);
    expect(slots).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(TERRAIN_TEMPLATES.corner16).toEqual({ columns: 4, rows: 4, slots: 16 });
  });

  it("blob47: reduce is idempotent and all 256 raw masks land in the 47-mask set", () => {
    expect(BLOB47_MASKS.length).toBe(47);
    const set = new Set(BLOB47_MASKS);
    for (let m = 0; m < 256; m++) {
      const r = reduceBlobMask(m);
      expect(reduceBlobMask(r)).toBe(r);
      expect(set.has(r)).toBe(true);
    }
    // every one of the 47 masks has a unique slot, which is its rank
    const slots = BLOB47_MASKS.map((m) => blob47Slot(m));
    expect(slots).toEqual(Array.from({ length: 47 }, (_, i) => i));
    expect([...BLOB47_MASKS]).toEqual([...BLOB47_MASKS].sort((a, b) => a - b));
    expect(TERRAIN_TEMPLATES.blob47).toEqual({ columns: 8, rows: 6, slots: 47 });
  });

  it("blob47 table matches samples/tilesets/blob47-32.md", () => {
    // spot checks from the sample table: index → mask
    const sample: [number, number][] = [[0, 0], [1, 1], [4, 7], [10, 28], [12, 31], [26, 112], [34, 193], [42, 241], [46, 255]];
    for (const [index, mask] of sample) expect(BLOB47_MASKS[index]).toBe(mask);
  });

  it("slot → tile id follows the block layout", () => {
    const blobTerrain = { id: 1, name: "", tilesetId: "terrain", template: "blob47" as const, origin: { col: 0, row: 0 } };
    const cornerTerrain = { id: 2, name: "", tilesetId: "terrain", template: "corner16" as const, origin: { col: 8, row: 0 } };
    for (let s = 0; s < 47; s++) expect(terrainSlotTileId(TERRAIN_TILESET, blobTerrain, s)).toBe(blobTile(s));
    for (let s = 0; s < 16; s++) expect(terrainSlotTileId(TERRAIN_TILESET, cornerTerrain, s)).toBe(cornerTile(s));
    expect(cornerTile(15)).toBe(8 + 3 + 36);
  });
});

describe("blob47 derivation", () => {
  it("single cell → isolated tile, neighbours empty", () => {
    const store = makeTerrainStore();
    paint(store, [[5, 5]], BLOB_ID);
    expectTiles(store, blob({ "5,5": 0 }));
  });

  it("3×3 block", () => {
    const store = makeTerrainStore();
    paint(store, square(5, 5, 7, 7), BLOB_ID);
    expectTiles(store, blob({
      "5,5": 10, "6,5": 31, "7,5": 26,
      "5,6": 12, "6,6": 46, "7,6": 42,
      "5,7": 4, "6,7": 36, "7,7": 34,
    }));
  });

  it("ring with a hole", () => {
    const store = makeTerrainStore();
    paint(store, square(5, 5, 7, 7).filter(([x, y]) => !(x === 6 && y === 6)), BLOB_ID);
    expectTiles(store, blob({
      "5,5": 7, "6,5": 15, "7,5": 18,
      "5,6": 6, "7,6": 6,
      "5,7": 3, "6,7": 15, "7,7": 14,
    }));
  });

  it("L-shape: corners need both edges", () => {
    const store = makeTerrainStore();
    paint(store, [[5, 5], [5, 6], [5, 7], [6, 7], [7, 7]], BLOB_ID);
    expectTiles(store, blob({ "5,5": 5, "5,6": 6, "5,7": 3, "6,7": 15, "7,7": 13 }));
  });

  it("diagonal touch: corners alone do not connect", () => {
    const store = makeTerrainStore();
    paint(store, [[5, 5], [6, 6]], BLOB_ID);
    expectTiles(store, blob({ "5,5": 0, "6,6": 0 }));
  });

  it("outside the map counts as the same terrain (no border at the edge)", () => {
    const store = makeTerrainStore();
    paint(store, [[0, 0]], BLOB_ID); // N, W, NW set by the edge; NE/SW dropped
    expect(tileAt(store, 0, 0)).toBe(blobTile(BLOB47_MASKS.indexOf(1 + 64 + 128)));
    paint(store, square(0, 0, 15, 15), BLOB_ID);
    expect(tileAt(store, 0, 0)).toBe(blobTile(46));
    expect(tileAt(store, 15, 15)).toBe(blobTile(46));
  });

  it("erasing re-derives the neighbours", () => {
    const store = makeTerrainStore();
    paint(store, square(5, 5, 7, 7), BLOB_ID);
    paint(store, [[6, 6]], 0);
    expectTiles(store, blob({
      "5,5": 7, "6,5": 15, "7,5": 18,
      "5,6": 6, "7,6": 6,
      "5,7": 3, "6,7": 15, "7,7": 14,
    }));
  });
});

describe("corner16 derivation (terrain on cell corners)", () => {
  it("single cell → full tile plus transitions on its 8 neighbours", () => {
    const store = makeTerrainStore();
    paint(store, [[5, 5]], CORNER_ID);
    expectTiles(store, corner({
      "4,4": 2, "5,4": 6, "6,4": 4,
      "4,5": 3, "5,5": 15, "6,5": 12,
      "4,6": 1, "5,6": 9, "6,6": 8,
    }));
  });

  it("3×3 block", () => {
    const store = makeTerrainStore();
    paint(store, square(5, 5, 7, 7), CORNER_ID);
    const expected: Record<string, number> = {};
    for (const [x, y] of square(5, 5, 7, 7)) expected[`${x},${y}`] = 15;
    Object.assign(expected, {
      "4,4": 2, "5,4": 6, "6,4": 6, "7,4": 6, "8,4": 4,
      "4,5": 3, "4,6": 3, "4,7": 3, "8,5": 12, "8,6": 12, "8,7": 12,
      "4,8": 1, "5,8": 9, "6,8": 9, "7,8": 9, "8,8": 8,
    });
    expectTiles(store, corner(expected));
  });

  it("ring with a 1-cell hole: the hole's corners are all covered", () => {
    const store = makeTerrainStore();
    paint(store, square(5, 5, 7, 7).filter(([x, y]) => !(x === 6 && y === 6)), CORNER_ID);
    expect(tileAt(store, 6, 6)).toBe(cornerTile(15));
  });

  it("L-shape inner corner", () => {
    const store = makeTerrainStore();
    paint(store, [[5, 5], [5, 6], [5, 7], [6, 7], [7, 7]], CORNER_ID);
    expect(tileAt(store, 6, 6)).toBe(cornerTile(8 + 2 + 4)); // NW, SE, SW
    expect(tileAt(store, 6, 5)).toBe(cornerTile(8 + 4)); // NW, SW
    expect(tileAt(store, 7, 6)).toBe(cornerTile(4 + 2)); // SW, SE
  });

  it("diagonal touch", () => {
    const store = makeTerrainStore();
    paint(store, [[5, 5], [6, 6]], CORNER_ID);
    expect(tileAt(store, 6, 5)).toBe(cornerTile(8 + 4 + 2));
    expect(tileAt(store, 5, 6)).toBe(cornerTile(1 + 8 + 2));
  });

  it("map edge: outside cells do not contribute", () => {
    const store = makeTerrainStore();
    paint(store, [[0, 0]], CORNER_ID);
    expectTiles(store, corner({ "0,0": 15, "1,0": 12, "0,1": 9, "1,1": 8 }));
  });
});

describe("paintTerrain history and events", () => {
  it("grid and derived tiles change in one undo step; undo restores both byte-exactly", () => {
    const store = makeTerrainStore();
    const before = serializeLevel(store.document);
    paint(store, [[3, 3]], BLOB_ID); // first use adds the terrain's palette entries
    const warmed = serializeLevel(store.document);
    store.undo();
    paint(store, [[3, 3]], BLOB_ID);
    store.undo();
    // Palette entries survive undo (append-only), cells don't.
    expect(JSON.parse(serializeLevel(store.document)).layers).toEqual(JSON.parse(before).layers);
    store.redo();
    expect(serializeLevel(store.document)).toBe(warmed);

    const events: StoreChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    const depth = store.undoDepth;
    paint(store, square(4, 4, 6, 6), CORNER_ID);
    expect(store.undoDepth).toBe(depth + 1);
    const last = events.at(-1)!;
    expect(last.cells.map((c) => c.layerId).sort()).toEqual(["terrain", "tiles"]);
    expect(last.structure).toEqual(["palette"]); // corner16 tiles added on first use
    const s1 = serializeLevel(store.document);
    store.undo();
    expect(events.at(-1)!.cells.map((c) => c.layerId).sort()).toEqual(["terrain", "tiles"]);
    store.redo();
    expect(serializeLevel(store.document)).toBe(s1);
  });

  it("locked grid layer is skipped; values are validated", () => {
    const store = makeTerrainStore();
    store.dispatch({ type: "setLayerProps", layerId: "terrain", props: { locked: true } });
    expect(paint(store, [[1, 1]], BLOB_ID).cells).toEqual([]);
    expect(() => paint(store, [[1, 1]], 0x10000)).toThrow(RangeError);
    expect(() => paint(store, [[1, 1]], -1)).toThrow(RangeError);
    expect(() => store.dispatch({ type: "paintTerrain", layerId: "tiles", cells: [] })).toThrow(/not a grid layer/);
    expect(() => store.dispatch({ type: "paintCells", layerId: "terrain", cells: [] })).toThrow(/grid layer/);
  });

  it("redefining a terrain re-derives its tiles in the same step; undo restores", () => {
    const store = makeTerrainStore(12, 12);
    paint(store, square(2, 2, 4, 4), CORNER_ID);
    const before = serializeLevel(store.document);
    const project = serializeProject({ name: "p", levels: [], tilesets: store.document.tilesets });
    // Move the corner16 block one row down (4 rows from row 1 still fit in 10).
    store.dispatch({
      type: "defineTerrain",
      terrain: { id: CORNER_ID, name: "Sand", tilesetId: "terrain", template: "corner16", origin: { col: 8, row: 1 } },
    });
    expect(tileAt(store, 3, 3)).toBe(cornerTile(15) + 12);
    store.dispatch({ type: "removeTerrain", terrainId: CORNER_ID });
    expect(tileAt(store, 3, 3)).toBe(null);
    store.undo();
    store.undo();
    expect(serializeProject({ name: "p", levels: [], tilesets: store.document.tilesets })).toBe(project);
    // palette may have grown; the layers are byte-identical
    expect(JSON.parse(serializeLevel(store.document)).layers).toEqual(JSON.parse(before).layers);
  });

  it("validates terrain definitions", () => {
    const store = makeTerrainStore();
    const t = { id: 3, name: "x", tilesetId: "terrain", template: "blob47" as const, origin: { col: 5, row: 0 } };
    expect(() => store.dispatch({ type: "defineTerrain", terrain: t })).toThrow(/does not fit/);
    expect(() => store.dispatch({ type: "defineTerrain", terrain: { ...t, origin: { col: 0, row: 0 }, id: 0 } })).toThrow(/terrain id/);
    expect(() => store.dispatch({ type: "defineTerrain", terrain: { ...t, tilesetId: "nope" } })).toThrow(/unknown tileset/);
    expect(() =>
      store.dispatch({ type: "defineTerrain", terrain: { ...t, origin: { col: 0, row: 0 }, variants: [{ slot: 47, tileIds: [1] }] } }),
    ).toThrow(/variant slot/);
    expect(() => store.dispatch({ type: "removeTerrain", terrainId: 99 })).toThrow(/unknown terrain/);
  });

  it("resize re-derives edges (outside counts as same) and undoes byte-exactly", () => {
    const store = makeTerrainStore(10, 10);
    paint(store, square(2, 2, 6, 6), BLOB_ID);
    const before = serializeLevel(store.document);
    store.dispatch({ type: "resizeMap", width: 6, height: 6 });
    expect(tileAt(store, 5, 5)).toBe(blobTile(46)); // now on the edge: no border
    expect(serializeLevel(store.document)).toBe(serializeLevel(parseLevel(serializeLevel(store.document), store.document.tilesets)));
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
  });
});

describe("variants", () => {
  function withVariants(seed: number) {
    const store = makeTerrainStore(40, 40, seed);
    store.dispatch({
      type: "defineTerrain",
      terrain: {
        id: BLOB_ID, name: "Grass", tilesetId: "terrain", template: "blob47", origin: { col: 0, row: 0 },
        variants: [{ slot: 46, tileIds: [100, 101, 102] }],
      },
    });
    store.clearHistory();
    store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: square(0, 0, 39, 39).map(([x, y]) => ({ x, y, value: BLOB_ID })) });
    return store;
  }

  it("picks by hash(seed, x, y): deterministic, uses every candidate, survives undo and reopen", () => {
    const store = withVariants(1234);
    const seen = new Set<number | null>();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) seen.add(tileAt(store, x, y));
    expect(seen).toEqual(new Set([blobTile(46), 100, 101, 102]));

    const text = serializeLevel(store.document);
    expect(JSON.parse(text).seed).toBe(1234);
    const project = parseProject(serializeProject({ name: "p", levels: [], tilesets: store.document.tilesets }));
    const reopened = parseLevel(text, project.tilesets);
    expect(reopened.seed).toBe(1234);
    expect(serializeLevel(reopened)).toBe(text);
    const derived = deriveTerrainTiles(reopened, "terrain");
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) expect(derived[y * 40 + x]?.tileId ?? null).toBe(tileAt(store, x, y));

    store.undo();
    store.redo();
    expect(serializeLevel(store.document)).toBe(text);
    expect(serializeLevel(withVariants(1234).document)).toBe(text);
    expect(serializeLevel(withVariants(99).document)).not.toBe(text);
    expect(terrainTileAt(reopened, "terrain", 7, 9)).toEqual({ tilesetId: "terrain", tileId: tileAt(store, 7, 9) });
  });

  it("cellHash is a pure 32-bit function", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.integer(), fc.integer(), (seed, x, y) => {
        const h = cellHash(seed, x, y);
        expect(h).toBe(cellHash(seed, x, y));
        expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
      }),
    );
    expect(cellHash(0, 1, 2)).not.toBe(cellHash(0, 2, 1));
  });
});
