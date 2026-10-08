import { describe, expect, it } from "vitest";
import {
  createDocument,
  FLIP_H,
  makeCell,
  MapStore,
  paletteWarnings,
  parseLevel,
  serializeLevel,
  serializeProject,
  type StoreChangeEvent,
  type Tileset,
} from "../src";
import { BLOB_ID, CORNER_ID, derivedMismatches, makeTerrainStore } from "./helpers";

/** 4×4 tiles of 32 px (128×128 image). */
const TS: Tileset = {
  id: "ts",
  name: "TS",
  imagePath: "tilesets/ts.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 4,
  rows: 4,
  margin: 0,
  spacing: 0,
};

function snap(store: MapStore): string {
  return serializeLevel(store.document) + serializeProject({ name: "p", levels: [], tilesets: store.document.tilesets });
}

/** Store with TS, palette entries for tiles `ids` (index i + 1 → ids[i]), each painted once at (i, 0) on "a". */
function setup(ids: readonly number[], tileset: Tileset = TS) {
  const store = new MapStore(createDocument({ width: 16, height: 4 }));
  store.dispatch({ type: "addTileset", tileset });
  store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
  store.dispatch({ type: "addLayer", layer: { id: "b", name: "B", locked: true } });
  const cells = ids.map((id, i) => ({ x: i, y: 0, cell: makeCell(store.getOrAddPaletteIndex(tileset.id, id), i === 0 ? FLIP_H : 0) }));
  store.dispatch({ type: "paintCells", layerId: "a", cells });
  store.clearHistory();
  return store;
}

const entries = (store: MapStore) => store.document.palette.entries().map((e) => e.tileId);

describe("updateTilesetGrid", () => {
  it("32 → 16 px: every old tile maps (cells keep showing the same pixels); one undo step restores bytes", () => {
    const store = setup([0, 1, 4, 5, 15]);
    store.dispatch({ type: "setTileSolid", tilesetId: "ts", tileIds: [1, 15], solid: true });
    store.clearHistory();
    const before = snap(store);
    const events: StoreChangeEvent[] = [];
    store.subscribe((e) => events.push(e));

    const result = store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 });
    expect(result).toEqual({ remapped: 4, dropped: 0, outOfRange: 0, clearedCells: 0, droppedSolidTiles: 0, droppedTerrains: [] });
    const ts = store.document.getTileset("ts")!;
    expect(ts).toMatchObject({ tileWidth: 16, tileHeight: 16, columns: 8, rows: 8, solidTiles: [2, 54] });
    expect(entries(store)).toEqual([0, 2, 16, 18, 54]);
    // Cells untouched (same palette indices, flags kept).
    expect(store.document.getLayer("a")!.getCell(0, 0)).toBe(makeCell(1, FLIP_H));
    expect(store.undoDepth).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.structure).toEqual(["tilesets", "palette"]);
    expect(events[0]!.cells.map((d) => d.layerId)).toEqual(["a"]);
    // Level round-trips (no duplicate palette entries).
    const text = serializeLevel(store.document);
    expect(serializeLevel(parseLevel(text, store.document.tilesets))).toBe(text);

    expect(store.undo()).toBe(true);
    expect(snap(store)).toBe(before);
    expect(events[1]!.structure).toEqual(["tilesets", "palette"]);
    expect(events[1]!.cells.map((d) => d.layerId)).toEqual(["a"]);
    expect(store.redo()).toBe(true);
    expect(entries(store)).toEqual([0, 2, 16, 18, 54]);
  });

  it("16 → 32 px: misaligned tiles are dropped and their cells cleared (locked layers too)", () => {
    const store = setup([0, 1, 2, 9, 18], { ...TS, tileWidth: 16, tileHeight: 16, columns: 8, rows: 8 });
    store.dispatch({ type: "setLayerProps", layerId: "b", props: { locked: false } });
    store.dispatch({ type: "paintCells", layerId: "b", cells: [{ x: 5, y: 1, cell: makeCell(2) }, { x: 6, y: 1, cell: makeCell(3) }] });
    store.dispatch({ type: "setLayerProps", layerId: "b", props: { locked: true } });
    store.dispatch({ type: "setTileSolid", tilesetId: "ts", tileIds: [1, 2], solid: true });
    store.clearHistory();
    const before = snap(store);

    const result = store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 });
    // 0 → 0, 2 → 1, 18 → 5; 1 and 9 sit at odd 16 px positions.
    expect(result).toEqual({ remapped: 2, dropped: 2, outOfRange: 0, clearedCells: 3, droppedSolidTiles: 1, droppedTerrains: [] });
    expect(store.document.getTileset("ts")).toMatchObject({ columns: 4, rows: 4, solidTiles: [1] });
    const a = store.document.getLayer("a")!;
    expect([0, 1, 2, 3, 4].map((x) => a.getCell(x, 0))).toEqual([makeCell(1, FLIP_H), 0, makeCell(3), 0, makeCell(5)]);
    expect(store.document.getLayer("b")!.getCell(5, 1)).toBe(0);
    expect(store.document.getLayer("b")!.getCell(6, 1)).toBe(makeCell(3));
    // Entries stay unique; dropped ones are parked on free ids and unused.
    const ids = entries(store);
    expect(new Set(ids).size).toBe(ids.length);
    expect([ids[0], ids[2], ids[4]]).toEqual([0, 1, 5]);
    const text = serializeLevel(store.document);
    expect(serializeLevel(parseLevel(text, store.document.tilesets))).toBe(text);

    store.undo();
    expect(snap(store)).toBe(before);
  });

  it("margin / spacing change and explicit image size; no-op when nothing changes", () => {
    const store = setup([0, 1, 5]);
    expect(store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 })).toMatchObject({ remapped: 0, dropped: 0 });
    expect(store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0, imageWidth: 130, imageHeight: 140 })).toMatchObject({ remapped: 0 });
    expect(store.undoDepth).toBe(0);
    // Real image 132×132 with 1 px margin + 1 px spacing would hold 4×4 tiles at 1, 34, 67, 100: nothing old aligns except none.
    const r = store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 32, tileHeight: 32, margin: 1, spacing: 1, imageWidth: 132, imageHeight: 132 });
    expect(r).toMatchObject({ remapped: 0, dropped: 3, clearedCells: 3 });
    expect(store.document.getTileset("ts")).toMatchObject({ margin: 1, spacing: 1, columns: 3, rows: 3 });
    expect(store.undoDepth).toBe(1);
  });

  it("validates", () => {
    const store = setup([0]);
    expect(() => store.dispatch({ type: "updateTilesetGrid", tilesetId: "nope", tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 })).toThrow(/unknown tileset/);
    expect(() => store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 0, tileHeight: 16, margin: 0, spacing: 0 })).toThrow(RangeError);
    expect(() => store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 16, tileHeight: 16, margin: -1, spacing: 0 })).toThrow(RangeError);
    expect(() => store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 256, tileHeight: 16, margin: 0, spacing: 0 })).toThrow(/not even one/);
    expect(() => store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0, imageWidth: 1.5 })).toThrow(RangeError);
    expect(store.undoDepth).toBe(0);
  });

  it("terrains move with their block, or are dropped; variants remap; derived tiles stay consistent; undo is exact", () => {
    const store = makeTerrainStore(12, 12);
    store.dispatch({
      type: "defineTerrain",
      terrain: { id: CORNER_ID, name: "Sand", tilesetId: "terrain", template: "corner16", origin: { col: 8, row: 0 }, variants: [{ slot: 15, tileIds: [100, 119] }] },
    });
    store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: [{ x: 2, y: 2, value: BLOB_ID }, { x: 3, y: 2, value: BLOB_ID }, { x: 7, y: 7, value: CORNER_ID }] });
    store.clearHistory();
    const before = snap(store);

    // 1 px spacing → 32 + 1 = 33 px pitch: only tile (0, 0) stays aligned; both blocks break.
    const broken = store.dispatch({ type: "updateTilesetGrid", tilesetId: "terrain", tileWidth: 32, tileHeight: 32, margin: 0, spacing: 1, imageWidth: 384, imageHeight: 320 });
    expect(broken.droppedTerrains).toEqual([BLOB_ID, CORNER_ID]);
    expect(store.document.getTileset("terrain")!.terrains).toBeUndefined();
    expect(store.document.getLayer("tiles")!.chunkCount).toBe(0);
    expect(derivedMismatches(store.document)).toEqual([]);
    store.undo();
    expect(snap(store)).toBe(before);

    // 32 → 16: blocks map onto 2× spread positions — not the same shape, dropped too.
    const half = store.dispatch({ type: "updateTilesetGrid", tilesetId: "terrain", tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 });
    expect(half.droppedTerrains).toEqual([BLOB_ID, CORNER_ID]);
    store.undo();

    // Wider image (same tile size): blocks keep their pixels at new ids, variants follow.
    const wide = store.dispatch({ type: "replaceTilesetImage", tilesetId: "terrain", imageWidth: 16 * 32, imageHeight: 320 });
    expect(wide.droppedTerrains).toEqual([]);
    const ts = store.document.getTileset("terrain")!;
    expect(ts.columns).toBe(16);
    expect(ts.terrains!.find((t) => t.id === CORNER_ID)).toMatchObject({ origin: { col: 8, row: 0 }, variants: [{ slot: 15, tileIds: [8 * 16 + 4, 9 * 16 + 11] }] });
    expect(derivedMismatches(store.document)).toEqual([]);
    store.undo();
    expect(snap(store)).toBe(before);
  });
});

describe("replaceTilesetImage", () => {
  it("taller image: ids preserved (appending rows keeps everything)", () => {
    const store = setup([0, 3, 15]);
    const r = store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 128, imageHeight: 192 });
    expect(r).toEqual({ remapped: 0, dropped: 0, outOfRange: 0, clearedCells: 0, droppedSolidTiles: 0, droppedTerrains: [] });
    expect(store.document.getTileset("ts")).toMatchObject({ columns: 4, rows: 6 });
    expect(entries(store)).toEqual([0, 3, 15]);
    expect(store.undoDepth).toBe(1);
  });

  it("shorter image: out-of-range entries and cells are kept (reported), solid flags dropped; growing back restores ids", () => {
    const store = setup([0, 3, 9, 15]);
    store.dispatch({ type: "setTileSolid", tilesetId: "ts", tileIds: [3, 15], solid: true });
    const r = store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 128, imageHeight: 64 });
    expect(r).toMatchObject({ remapped: 0, dropped: 0, outOfRange: 2, clearedCells: 0, droppedSolidTiles: 1 });
    expect(entries(store)).toEqual([0, 3, 9, 15]);
    expect(store.document.getLayer("a")!.getCell(3, 0)).toBe(makeCell(4));
    expect(paletteWarnings(store.document)).toEqual([
      'palette index 3: tile 9 is outside tileset "ts" (8 tiles)',
      'palette index 4: tile 15 is outside tileset "ts" (8 tiles)',
    ]);
    // The PNG is saved again at full size: same ids show the same pixels again.
    store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 128, imageHeight: 128 });
    expect(entries(store)).toEqual([0, 3, 9, 15]);
    expect(paletteWarnings(store.document)).toEqual([]);
  });

  it("wider image: ids follow the pixels (column count changed); narrower parks the rest out of range", () => {
    const store = setup([0, 3, 4, 15]);
    const before = snap(store);
    const wide = store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 192, imageHeight: 128 });
    expect(wide).toMatchObject({ remapped: 2, outOfRange: 0 });
    expect(entries(store)).toEqual([0, 3, 6, 21]);
    store.undo();
    expect(snap(store)).toBe(before);

    const narrow = store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 96, imageHeight: 128 });
    // 3 (col 3) and 15 (col 3) fall outside; 4 → 3 (row 1 col 0 in a 3-column grid).
    expect(narrow).toMatchObject({ remapped: 1, outOfRange: 2, clearedCells: 0 });
    const ids = entries(store);
    expect(ids[0]).toBe(0);
    expect(ids[2]).toBe(3);
    expect(ids[1]).toBeGreaterThanOrEqual(12);
    expect(ids[3]).toBeGreaterThanOrEqual(12);
    expect(new Set(ids).size).toBe(4);
    const text = serializeLevel(store.document);
    expect(serializeLevel(parseLevel(text, store.document.tilesets))).toBe(text);
    store.undo();
    expect(snap(store)).toBe(before);
  });

  it("no-op when the grid does not change; validates the size", () => {
    const store = setup([0]);
    store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 140, imageHeight: 130 });
    expect(store.undoDepth).toBe(0);
    expect(() => store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 0, imageHeight: 10 })).toThrow(RangeError);
    expect(() => store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 16, imageHeight: 16 })).toThrow(/not even one/);
    expect(() => store.dispatch({ type: "replaceTilesetImage", tilesetId: "x", imageWidth: 16, imageHeight: 16 })).toThrow(/unknown tileset/);
  });

  it("inside a transaction it is part of the one step", () => {
    const store = setup([0, 5]);
    store.beginTransaction();
    store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 192, imageHeight: 128 });
    store.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 9, y: 3, cell: makeCell(store.getOrAddPaletteIndex("ts", 17)) }] });
    store.dispatch({ type: "updateTilesetGrid", tilesetId: "ts", tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 });
    store.commit();
    expect(store.undoDepth).toBe(1);
    const after = snap(store);
    store.undo();
    // The palette entry added mid-transaction stays (append-only) but nothing uses it.
    expect(store.document.getLayer("a")!.getCell(9, 3)).toBe(0);
    expect(entries(store).slice(0, 2)).toEqual([0, 5]);
    store.redo();
    expect(snap(store)).toBe(after);
    store.undo();
    // Back to the start except the appended (unused) palette entry.
    expect(store.document.getTileset("ts")).toEqual(TS);
    expect(entries(store)).toEqual([0, 5, 17]);
    expect(store.document.getLayer("a")!.getCell(9, 3)).toBe(0);
  });

  it("entries appended after the edit never collide on undo / redo (moved aside and back, exactly)", () => {
    const store = setup([0, 5]);
    store.dispatch({ type: "replaceTilesetImage", tilesetId: "ts", imageWidth: 192, imageHeight: 128 }); // 5 → 7
    // Tile 5 of the wider grid is a new entry (index 3).
    store.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 8, y: 2, cell: makeCell(store.getOrAddPaletteIndex("ts", 5)) }] });
    store.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 9, y: 2, cell: makeCell(store.getOrAddPaletteIndex("ts", 12)) }] });
    const painted = snap(store);
    expect(entries(store)).toEqual([0, 7, 5, 12]);
    for (let round = 0; round < 3; round++) {
      store.undo();
      store.undo();
      store.undo();
      // Index 2 is tile 5 again; index 3 (unused now) moved to the key it freed.
      expect(entries(store)).toEqual([0, 5, 7, 12]);
      expect(store.document.getLayer("a")!.getCell(8, 2)).toBe(0);
      expect(store.document.getTileset("ts")).toEqual(TS);
      store.redo();
      expect(entries(store)).toEqual([0, 7, 5, 12]);
      store.redo();
      store.redo();
      expect(snap(store)).toBe(painted);
    }
  });
});
