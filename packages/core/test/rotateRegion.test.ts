import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cellFlags, cellPaletteIndex, rotateRegion, rotatedRect, serializeLevel } from "../src";
import { makeStore } from "./helpers";

describe("rotateRegion", () => {
  it("turns a 3×2 block clockwise around its centre as one undo step", () => {
    const { store, cell } = makeStore(20, 20);
    // row 0: 1 2 3 / row 1: 4 5 6 at (5, 5)
    const cells = [1, 2, 3, 4, 5, 6].map((v, i) => ({ x: 5 + (i % 3), y: 5 + Math.floor(i / 3), cell: cell(v) }));
    store.dispatch({ type: "paintCells", layerId: "ground", cells });
    store.clearHistory();
    const before = serializeLevel(store.document);
    const rect = rotateRegion(store, ["ground"], { x: 5, y: 5, width: 3, height: 2 }, "cw");
    expect(rect).toEqual({ x: 5, y: 5, width: 2, height: 3 });
    const ground = store.document.getLayer("ground")!;
    const idx = (x: number, y: number) => cellPaletteIndex(ground.getCell(x, y));
    // cw: column 0 bottom→top becomes row 0: 4 1 / 5 2 / 6 3
    expect([idx(5, 5), idx(6, 5), idx(5, 6), idx(6, 6), idx(5, 7), idx(6, 7)]).toEqual([4, 1, 5, 2, 6, 3]);
    expect(idx(7, 5)).toBe(0);
    expect(cellFlags(ground.getCell(5, 5))).not.toBe(0);
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
    expect(store.canUndo).toBe(false);
  });

  it("clips to the map and returns the visible part", () => {
    const { store, cell } = makeStore(10, 10);
    store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 0, y: 0, cell: cell(1) }, { x: 3, y: 0, cell: cell(2) }] });
    const rect = rotateRegion(store, ["ground"], { x: 0, y: 0, width: 4, height: 1 }, "cw");
    expect(rect).toEqual({ x: 1, y: 0, width: 1, height: 3 });
  });

  it("four turns give the same rectangle and content back", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }), fc.boolean(), (w, h, cw) => {
        const { store, cell } = makeStore(30, 30);
        const cells = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push({ x: 12 + x, y: 12 + y, cell: cell(1 + ((x + y * w) % 6)) });
        store.dispatch({ type: "paintCells", layerId: "ground", cells });
        const before = serializeLevel(store.document);
        let rect = { x: 12, y: 12, width: w, height: h };
        for (let i = 0; i < 4; i++) rect = rotateRegion(store, ["ground"], rect, cw ? "cw" : "ccw")!;
        expect(rect).toEqual({ x: 12, y: 12, width: w, height: h });
        expect(serializeLevel(store.document)).toBe(before);
        expect(rotatedRect(rotatedRect({ x: 3, y: 4, width: w, height: h }))).toEqual({ x: 3, y: 4, width: w, height: h });
      }),
    );
  });
});
