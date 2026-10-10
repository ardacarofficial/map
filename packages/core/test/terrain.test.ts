import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BLOB47_MASKS,
  DEFAULT_TERRAIN_TEMPLATE,
  TERRAIN_TEMPLATES,
  blob47Slot,
  isTerrainTemplate,
  terrainSlotForMask,
  terrainTemplateInfo,
  type TerrainTemplate,
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
import { BLOB_ID, BLOB_TEMPLATES, CORNER_ID, TERRAIN_TILESET, blobMaskTile, blobTile, cornerTile, makeTerrainStore } from "./helpers";

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

const corner = (slots: Record<string, number>) => Object.fromEntries(Object.entries(slots).map(([k, s]) => [k, cornerTile(s)]));
const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
};

describe("templates", () => {
  it("descriptor list: unique ids, tables fill the block, default is the Godot layout", () => {
    const ids = TERRAIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["blob47", "blob47-cr31", "blob47-godot", "corner16"]);
    for (const t of TERRAIN_TEMPLATES) {
      expect(t.masks.length).toBe(t.columns * t.rows);
      expect(t.slots).toBe(t.masks.filter((m) => m !== null).length);
      expect(terrainTemplateInfo(t.id)).toBe(t);
      expect(isTerrainTemplate(t.id)).toBe(true);
      expect(Object.isFrozen(t) && Object.isFrozen(t.masks)).toBe(true);
    }
    expect(DEFAULT_TERRAIN_TEMPLATE).toBe("blob47-godot");
    expect(TERRAIN_TEMPLATES[0]!.id).toBe(DEFAULT_TERRAIN_TEMPLATE);
    expect(TERRAIN_TEMPLATES.filter((t) => t.legacy).map((t) => t.id)).toEqual(["blob47"]);
    expect(isTerrainTemplate("blob47-rpgmaker")).toBe(false);
    expect(isTerrainTemplate(undefined)).toBe(false);
    expect(() => terrainTemplateInfo("nope" as TerrainTemplate)).toThrow(/unknown terrain template/);
  });

  it("corner16: 16 masks map to 16 distinct slots in a 4×4 block, slot = NE + 2SE + 4SW + 8NW", () => {
    const slots = Array.from({ length: 16 }, (_, m) => corner16Slot(m));
    expect(new Set(slots).size).toBe(16);
    expect(slots).toEqual(Array.from({ length: 16 }, (_, i) => i));
    const info = terrainTemplateInfo("corner16");
    expect([info.family, info.columns, info.rows, info.slots]).toEqual(["corner16", 4, 4, 16]);
    for (let m = 0; m < 16; m++) expect(terrainSlotForMask("corner16", m)).toBe(m);
  });

  it("blob47: reduce is idempotent and all 256 raw masks land in the 47-mask set", () => {
    expect(BLOB47_MASKS.length).toBe(47);
    const set = new Set(BLOB47_MASKS);
    for (let m = 0; m < 256; m++) {
      const r = reduceBlobMask(m);
      expect(reduceBlobMask(r)).toBe(r);
      expect(set.has(r)).toBe(true);
    }
    expect([...BLOB47_MASKS]).toEqual([...BLOB47_MASKS].sort((a, b) => a - b));
  });

  it.each(BLOB_TEMPLATES)("%s: the used cells are a bijection onto the 47 reduced masks", (id) => {
    const info = terrainTemplateInfo(id);
    expect(info.family).toBe("blob47");
    const used = info.masks.filter((m): m is number => m !== null);
    expect(used.length).toBe(47);
    expect(info.slots).toBe(47);
    expect([...used].sort((a, b) => a - b)).toEqual([...BLOB47_MASKS]);
    // every raw mask → the cell that shows its reduced mask
    for (let m = 0; m < 256; m++) expect(info.masks[terrainSlotForMask(id, m)]).toBe(reduceBlobMask(m));
  });

  it("legacy blob47: 8×6, slot = rank of the reduced mask (smap-sorted)", () => {
    const info = terrainTemplateInfo("blob47");
    expect([info.columns, info.rows, info.legacy]).toEqual([8, 6, true]);
    expect(BLOB47_MASKS.map((m) => blob47Slot(m))).toEqual(Array.from({ length: 47 }, (_, i) => i));
    expect(info.masks[47]).toBe(null);
  });

  it("legacy blob47 table matches samples/tilesets/blob47-32.md", () => {
    // spot checks from the sample table: index → mask
    const sample: [number, number][] = [[0, 0], [1, 1], [4, 7], [10, 28], [12, 31], [26, 112], [34, 193], [42, 241], [46, 255]];
    for (const [index, mask] of sample) expect(BLOB47_MASKS[index]).toBe(mask);
  });

  // Hand-checked against the source images (col, row → mask; null = unused cell).
  const spot: Record<string, [number, number, number | null][]> = {
    // godot-docs 3.x tutorials/2d/img/autotile_template_3x3_minimal.png
    "blob47-godot": [
      [0, 0, 16], // centre + S: top of a vertical strip
      [0, 3, 0], // isolated
      [1, 3, 4], [2, 3, 68], [3, 3, 64], // horizontal strip: E, E+W, W
      [9, 2, 255], // fully surrounded
      [4, 0, 213], // N E S W NW (missing NE, SE, SW)
      [8, 3, 7], // N NE E
      [11, 3, 193], // N W NW
      [10, 1, null], // blank cell
    ],
    // cr31 blob page, art/atlas/blob/wangbl.png (tiles are labelled)
    "blob47-cr31": [
      [0, 0, 0], [1, 0, 4], [5, 0, 80], [0, 1, 16], [2, 2, 85], [3, 3, 28], [4, 4, 255], [0, 5, 5], [6, 6, 65],
      [6, 0, null], [0, 6, null],
    ],
  };
  it.each(Object.keys(spot))("%s: spot checks against the source sheet", (id) => {
    const info = terrainTemplateInfo(id as TerrainTemplate);
    expect(spot[id]!.length).toBeGreaterThanOrEqual(6);
    for (const [col, row, mask] of spot[id]!) expect([col, row, info.masks[row * info.columns + col]]).toEqual([col, row, mask]);
    expect([info.columns, info.rows]).toEqual(id === "blob47-godot" ? [12, 4] : [7, 7]);
  });

  it("slot → tile id follows the block layout", () => {
    const blobTerrain = { id: 1, name: "", tilesetId: "terrain", template: "blob47" as const, origin: { col: 0, row: 0 } };
    const cornerTerrain = { id: 2, name: "", tilesetId: "terrain", template: "corner16" as const, origin: { col: 8, row: 0 } };
    const godot = { ...blobTerrain, template: "blob47-godot" as const };
    for (let s = 0; s < 47; s++) expect(terrainSlotTileId(TERRAIN_TILESET, blobTerrain, s)).toBe(blobTile(s));
    for (let s = 0; s < 16; s++) expect(terrainSlotTileId(TERRAIN_TILESET, cornerTerrain, s)).toBe(cornerTile(s));
    for (let s = 0; s < 48; s++) expect(terrainSlotTileId(TERRAIN_TILESET, godot, s)).toBe(s);
    expect(cornerTile(15)).toBe(8 + 3 + 36);
  });
});

describe.each(BLOB_TEMPLATES)("blob47 derivation (%s)", (template) => {
  const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;
  const store = (w = 16, h = 16) => makeTerrainStore(w, h, 0, template);
  /** `"x,y" → mask` to `"x,y" → tile id`. */
  const blob = (masks: Record<string, number>) => Object.fromEntries(Object.entries(masks).map(([k, m]) => [k, blobMaskTile(template, m)]));

  it("single cell → isolated tile, neighbours empty", () => {
    const st = store();
    paint(st, [[5, 5]], BLOB_ID);
    expectTiles(st, blob({ "5,5": 0 }));
  });

  it("3×3 block", () => {
    const st = store();
    paint(st, square(5, 5, 7, 7), BLOB_ID);
    expectTiles(st, blob({
      "5,5": E | SE | S, "6,5": E | SE | S | SW | W, "7,5": S | SW | W,
      "5,6": N | NE | E | SE | S, "6,6": 255, "7,6": N | S | SW | W | NW,
      "5,7": N | NE | E, "6,7": N | NE | E | W | NW, "7,7": N | W | NW,
    }));
  });

  it("ring with a hole", () => {
    const st = store();
    paint(st, square(5, 5, 7, 7).filter(([x, y]) => !(x === 6 && y === 6)), BLOB_ID);
    expectTiles(st, blob({
      "5,5": E | S, "6,5": E | W, "7,5": S | W,
      "5,6": N | S, "7,6": N | S,
      "5,7": N | E, "6,7": E | W, "7,7": N | W,
    }));
  });

  it("L-shape: corners need both edges", () => {
    const st = store();
    paint(st, [[5, 5], [5, 6], [5, 7], [6, 7], [7, 7]], BLOB_ID);
    expectTiles(st, blob({ "5,5": S, "5,6": N | S, "5,7": N | E, "6,7": E | W, "7,7": W }));
  });

  it("diagonal touch: corners alone do not connect", () => {
    const st = store();
    paint(st, [[5, 5], [6, 6]], BLOB_ID);
    expectTiles(st, blob({ "5,5": 0, "6,6": 0 }));
  });

  it("outside the map counts as the same terrain (no border at the edge)", () => {
    const st = store();
    paint(st, [[0, 0]], BLOB_ID); // N, W, NW set by the edge; NE/SW dropped
    expect(tileAt(st, 0, 0)).toBe(blobMaskTile(template, N | W | NW));
    paint(st, square(0, 0, 15, 15), BLOB_ID);
    expect(tileAt(st, 0, 0)).toBe(blobMaskTile(template, 255));
    expect(tileAt(st, 15, 15)).toBe(blobMaskTile(template, 255));
  });

  it("erasing re-derives the neighbours", () => {
    const st = store();
    paint(st, square(5, 5, 7, 7), BLOB_ID);
    paint(st, [[6, 6]], 0);
    expectTiles(st, blob({
      "5,5": E | S, "6,5": E | W, "7,5": S | W,
      "5,6": N | S, "7,6": N | S,
      "5,7": N | E, "6,7": E | W, "7,7": N | W,
    }));
  });

  it("matches the from-scratch derivation and survives save/reopen", () => {
    const st = store(12, 12);
    paint(st, [...square(1, 1, 5, 4), [7, 7], [8, 7], [8, 8], [3, 9], [4, 10]], BLOB_ID);
    const project = parseProject(serializeProject({ name: "p", levels: [], tilesets: st.document.tilesets }));
    expect(project.tilesets[0]!.terrainSets!.find((t) => t.id === "terrain-1")!.kind).toBe("blob");
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) expect(deriveTerrainTiles(st.document, "terrain")[y * 12 + x]?.tileId ?? null).toBe(tileAt(st, x, y));
    // Reopening migrates the grid away; the tiles stay exactly as they were.
    const reopened = parseLevel(serializeLevel(st.document), project.tilesets);
    expect(reopened.getLayer("terrain")).toBeUndefined();
    const tiles = reopened.getLayer("tiles")!;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) expect(reopened.palette.get(tiles.getCell(x, y) >>> 0)?.tileId ?? null).toBe(tileAt(st, x, y));
    }
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
    const reopened = JSON.parse(serializeLevel(parseLevel(serializeLevel(store.document), store.document.tilesets)));
    expect(reopened.layers[0]).toEqual(JSON.parse(serializeLevel(store.document)).layers[0]);
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
    expect(JSON.parse(serializeLevel(reopened)).layers[0]).toEqual(JSON.parse(text).layers[0]);
    const derived = deriveTerrainTiles(store.document, "terrain");
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) expect(derived[y * 40 + x]?.tileId ?? null).toBe(tileAt(store, x, y));

    store.undo();
    store.redo();
    expect(serializeLevel(store.document)).toBe(text);
    expect(serializeLevel(withVariants(1234).document)).toBe(text);
    expect(serializeLevel(withVariants(99).document)).not.toBe(text);
    expect(terrainTileAt(store.document, "terrain", 7, 9)).toEqual({ tilesetId: "terrain", tileId: tileAt(store, 7, 9) });
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
