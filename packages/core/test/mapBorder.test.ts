import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDocument, MapStore, serializeLevel } from "../src";
import { mapBorder } from "../src/mapBorder";

const size = fc.integer({ min: 1, max: 40 });
const options = fc.record({ thickness: size, inset: fc.integer({ min: 0, max: 30 }), sides: fc.record({ top: fc.boolean(), bottom: fc.boolean(), left: fc.boolean(), right: fc.boolean() }) });
const keys = (cells: readonly { x: number; y: number }[]) => cells.map(p => `${p.x},${p.y}`).sort();
describe("map border", () => {
  it("is deterministic, unique, within bounds, and symmetric under both map flips", () => {
    fc.assert(fc.property(size, size, options, (width, height, o) => {
      const a = mapBorder({ width, height }, o);
      expect(mapBorder({ width, height }, o)).toEqual(a);
      expect(new Set(keys(a.cells)).size).toBe(a.cells.length);
      expect(a.cells.every(p => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height)).toBe(true);
      expect(keys(mapBorder({ width, height }, { ...o, sides: { ...o.sides, left: o.sides.right, right: o.sides.left } }).cells)).toEqual(keys(a.cells.map(p => ({ x: width - 1 - p.x, y: p.y }))));
      expect(keys(mapBorder({ width, height }, { ...o, sides: { ...o.sides, top: o.sides.bottom, bottom: o.sides.top } }).cells)).toEqual(keys(a.cells.map(p => ({ x: p.x, y: height - 1 - p.y }))));
    }));
  });
  it("excludes gaps through the complete band, including overlapping corner strips", () => {
    fc.assert(fc.property(size, size, size, (width, height, thickness) => {
      const result = mapBorder({ width, height }, { thickness, inset: 0, gaps: [{ side: "top", start: 0, length: width }] });
      expect(result.cells.every(p => p.y >= result.thickness)).toBe(true);
    }));
  });
  it("clamps inset and thickness on narrow maps", () => {
    const result = mapBorder({ width: 3, height: 9 }, { thickness: 8, inset: 7 });
    expect(result.inset).toBe(1);
    expect(result.thickness).toBe(1);
    expect(result.clamped).toBe(true);
    expect(result.cells).toHaveLength(7);
  });
  it("flips and quarter turns gaps together with the map", () => {
    fc.assert(fc.property(size, size, size, fc.integer({ min: 0, max: 40 }), size, (width, height, thickness, start, length) => {
      start %= width; length = Math.min(length, width - start);
      const a = mapBorder({ width, height }, { thickness, inset: 0, gaps: [{ side: "top", start, length }] });
      const h = mapBorder({ width, height }, { thickness, inset: 0, gaps: [{ side: "top", start: width - start - length, length }] });
      expect(keys(h.cells)).toEqual(keys(a.cells.map(p => ({ x: width - 1 - p.x, y: p.y }))));
      const v = mapBorder({ width, height }, { thickness, inset: 0, gaps: [{ side: "bottom", start, length }] });
      expect(keys(v.cells)).toEqual(keys(a.cells.map(p => ({ x: p.x, y: height - 1 - p.y }))));
      const rotated = mapBorder({ width: height, height: width }, { thickness, inset: 0, gaps: [{ side: "right", start, length }] });
      expect(keys(rotated.cells)).toEqual(keys(a.cells.map(p => ({ x: height - 1 - p.y, y: p.x }))));
    }));
  });
  it("the border paint operation round-trips through undo/redo without changing the document", () => {
    fc.assert(fc.property(size, size, options, (width, height, o) => {
      const store = new MapStore(createDocument({ width, height, tilesets: [{ id: "t", name: "T", imagePath: "t.png", columns: 1, rows: 1, tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 }] }));
      store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
      const index = store.getOrAddPaletteIndex("t", 0);
      store.dispatch({ type: "paintCells", layerId: "l", cells: [{ x: 0, y: 0, cell: index }] });
      store.clearHistory();
      const before = serializeLevel(store.document);
      store.beginTransaction();
      store.dispatch({ type: "paintCells", layerId: "l", cells: mapBorder({ width, height }, o).cells.map(p => ({ ...p, cell: index })) });
      store.commit();
      const after = serializeLevel(store.document);
      if (store.canUndo) { store.undo(); expect(serializeLevel(store.document)).toBe(before); store.redo(); expect(serializeLevel(store.document)).toBe(after); }
    }), { numRuns: 50 });
  });

});
