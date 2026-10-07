/**
 * Memory bounds: maps are at most MAX_MAP_SIZE per side, and undo
 * bookkeeping grows with the touched area, not with the map size.
 */
import { describe, expect, it } from "vitest";
import { createDocument, makeCell, MapStore, MAX_MAP_SIZE, mapInfoProblem, parseClip, rectCells, serializeLevel } from "../src";
import { TILESET } from "./helpers";

describe("map size bound", () => {
  it("MAX_MAP_SIZE is 4096 cells per side", () => {
    expect(MAX_MAP_SIZE).toBe(4096);
    expect(mapInfoProblem({ width: 4096, height: 4096, tileWidth: 32, tileHeight: 32 })).toBeNull();
    expect(mapInfoProblem({ width: 4097, height: 1, tileWidth: 32, tileHeight: 32 })).toMatch(/4096/);
  });

  it("clips larger than a map are rejected when parsed", () => {
    const text = JSON.stringify({ format: "smap-clip", documentFormatVersion: 1, width: 5000, height: 1, palette: [], layers: [] });
    expect(() => parseClip(text)).toThrow(/invalid/);
  });
});

describe("large edits on a maximum-size map", () => {
  it("a big paint inside a transaction merges per cell and undoes exactly", () => {
    const store = new MapStore(createDocument({ width: MAX_MAP_SIZE, height: MAX_MAP_SIZE }));
    store.dispatch({ type: "addTileset", tileset: TILESET });
    const a = store.getOrAddPaletteIndex(TILESET.id, 0);
    const b = store.getOrAddPaletteIndex(TILESET.id, 1);
    store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
    store.clearHistory();
    const before = serializeLevel(store.document);
    // Two far-apart blocks, painted twice: the first `before` and the last `after` win.
    const cells = [...rectCells(0, 0, 299, 299), ...rectCells(4000, 4000, 4095, 4095)];
    store.beginTransaction();
    store.dispatch({ type: "paintCells", layerId: "l", cells: cells.map((p) => ({ ...p, cell: makeCell(a) })) });
    store.dispatch({ type: "paintCells", layerId: "l", cells: cells.map((p) => ({ ...p, cell: makeCell(b) })) });
    store.commit();
    expect(store.undoDepth).toBe(1);
    const after = serializeLevel(store.document);
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
    store.redo();
    expect(serializeLevel(store.document)).toBe(after);
    expect(store.document.getLayer("l")!.getCell(4095, 4095)).toBe(makeCell(b));
  });
});
