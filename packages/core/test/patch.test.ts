/**
 * Compact cell patches: per-chunk typed arrays behind the public
 * `LayerPatch.cells` list (built on first read).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeCell, patchCellCount, rectCells, serializeLevel, type CellChange, type CellWrite } from "../src";
import { makeStore } from "./helpers";

describe("compact patches", () => {
  it("cells are built on read, once, chunk by chunk in recording order", () => {
    const { store, ground, cell } = makeStore(100, 80);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 33, y: 0, cell: cell(5) }] });
    const patch = store.dispatch({
      type: "paintCells",
      layerId: ground,
      cells: [
        { x: 33, y: 0, cell: cell(1) },
        { x: 2, y: 3, cell: cell(2) },
        { x: 40, y: 1, cell: cell(3) },
        { x: 1, y: 0, cell: cell(4) },
        { x: 2, y: 3, cell: cell(5) }, // same cell again: last write wins
      ],
    });
    expect(patchCellCount(patch)).toBe(4);
    expect(patch.cells).toEqual([
      { x: 33, y: 0, before: cell(5), after: cell(1) },
      { x: 40, y: 1, before: 0, after: cell(3) },
      { x: 2, y: 3, before: 0, after: cell(5) },
      { x: 1, y: 0, before: 0, after: cell(4) },
    ]);
    expect(patch.cells).toBe(patch.cells);
    expect(Object.isFrozen(patch)).toBe(true);
    expect(Object.isFrozen(patch.cells)).toBe(true);
    expect(Object.keys(patch)).toEqual(["layerId", "cells"]);
  });

  it("a cell written and restored within one op is not in the patch", () => {
    const { store, ground, cell } = makeStore();
    const patch = store.dispatch({
      type: "paintCells",
      layerId: ground,
      cells: [{ x: 1, y: 1, cell: cell(1) }, { x: 2, y: 1, cell: cell(1) }, { x: 1, y: 1, cell: 0 }],
    });
    expect(patch.cells).toEqual([{ x: 2, y: 1, before: 0, after: cell(1) }]);
    expect(patchCellCount(patch)).toBe(1);
  });

  it("patchCellCount works for plain patch objects", () => {
    expect(patchCellCount({ layerId: "a", cells: [{ x: 0, y: 0, before: 0, after: 1 }] })).toBe(1);
  });

  it("whole chunks (all 1024 cells) undo and redo exactly and list every cell", () => {
    const { store, ground, cell } = makeStore(96, 64);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 40, y: 7, cell: cell(3) }] });
    const start = serializeLevel(store.document);
    // Reverse row order: recording order differs from local index order.
    const writes = rectCells(0, 0, 95, 63).reverse().map((p) => ({ ...p, cell: cell(1 + ((p.x + p.y) % 4)) }));
    store.beginTransaction();
    const patch = store.dispatch({ type: "paintCells", layerId: ground, cells: writes });
    store.commit();
    const end = serializeLevel(store.document);
    expect(patchCellCount(patch)).toBe(96 * 64);
    const byPos = new Map(patch.cells.map((c) => [`${c.x},${c.y}`, c]));
    expect(byPos.size).toBe(96 * 64);
    expect(byPos.get("40,7")).toEqual({ x: 40, y: 7, before: cell(3), after: cell(1 + (47 % 4)) });
    expect(byPos.get("95,63")).toEqual({ x: 95, y: 63, before: 0, after: cell(1 + (158 % 4)) });
    store.undo();
    expect(serializeLevel(store.document)).toBe(start);
    store.redo();
    expect(serializeLevel(store.document)).toBe(end);
  });

  it("matches a naive per-cell patch; undo / redo of random transactions restore exactly", () => {
    const W = 70;
    const H = 66;
    const write = fc.record({
      x: fc.integer({ min: -2, max: W + 1 }),
      y: fc.integer({ min: -2, max: H + 1 }),
      cell: fc.integer({ min: 0, max: 4 }),
    });
    const rect = fc
      .record({ x: fc.integer({ min: -3, max: W }), y: fc.integer({ min: -3, max: H }), w: fc.integer({ min: 1, max: 40 }), h: fc.integer({ min: 1, max: 40 }), cell: fc.integer({ min: 0, max: 4 }) })
      .map(({ x, y, w, h, cell }) => rectCells(x, y, x + w - 1, y + h - 1).map((p) => ({ ...p, cell })));
    const op = fc.oneof(fc.array(write, { maxLength: 30 }), rect);
    const tx = fc.array(op, { minLength: 1, maxLength: 4 });
    fc.assert(
      fc.property(fc.array(tx, { minLength: 1, maxLength: 6 }), (txs) => {
        const { store, ground } = makeStore(W, H, 4);
        const layer = store.document.getLayer(ground)!;
        const snapshots = [serializeLevel(store.document)];
        for (const ops of txs) {
          const depth = store.undoDepth;
          store.beginTransaction();
          for (const raw of ops) {
            const cells: CellWrite[] = raw.map((w) => ({ ...w, cell: makeCell(w.cell) }));
            // Naive expectation: first before / last after per in-bounds cell, no-ops dropped.
            const expected = new Map<string, { x: number; y: number; before: number; after: number }>();
            for (const w of cells) {
              if (w.x < 0 || w.y < 0 || w.x >= W || w.y >= H) continue;
              const key = `${w.x},${w.y}`;
              const prev = expected.get(key);
              if (prev) prev.after = w.cell;
              else expected.set(key, { x: w.x, y: w.y, before: layer.getCell(w.x, w.y), after: w.cell });
            }
            const want = [...expected.values()].filter((c) => c.before !== c.after);
            const patch = store.dispatch({ type: "paintCells", layerId: ground, cells });
            const sortKey = (c: CellChange) => c.y * W + c.x;
            expect([...patch.cells].sort((a, b) => sortKey(a) - sortKey(b))).toEqual(want.sort((a, b) => sortKey(a) - sortKey(b)));
            expect(patchCellCount(patch)).toBe(want.length);
          }
          store.commit();
          // A transaction that changed nothing makes no undo step.
          if (store.undoDepth > depth) snapshots.push(serializeLevel(store.document));
          else expect(serializeLevel(store.document)).toBe(snapshots.at(-1));
        }
        for (let i = snapshots.length - 2; i >= 0; i--) {
          expect(store.undo()).toBe(true);
          expect(serializeLevel(store.document)).toBe(snapshots[i]);
        }
        expect(store.canUndo).toBe(false);
        let i = 0;
        while (store.redo()) {
          i++;
          expect(serializeLevel(store.document)).toBe(snapshots[i]);
        }
        expect(i).toBe(snapshots.length - 1);
      }),
      { numRuns: 150 },
    );
  });
});
