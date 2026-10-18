import { createDocument, floodFill, floodFillRuns, MapStore } from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fillRegionPlan, fillRunWrites, runPoints } from "./fillRegionPlan";

function fixture() {
  const store = new MapStore(createDocument({ width: 8, height: 6 }));
  const id = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
  const layer = store.document.getLayer(id)!;
  store.clearHistory();
  return { store, layer, id };
}

describe("shared fill region", () => {
  it("reuses hover results for a click anywhere in the region, with lazy identical imagery", () => {
    const { store, layer } = fixture();
    const plan = fillRegionPlan(store, layer, { x: 0, y: 0 });
    expect(fillRegionPlan(store, layer, { x: 7, y: 5 })).toBe(plan);
    expect([...runPoints(plan.runs)]).toHaveLength(48);
    expect(plan.runsAt({ x: 7, y: 5 })).toEqual(floodFillRuns(layer, 7, 5, -1, store.document.map));
    expect(plan.image).toBe(plan.image);
    expect(plan.image?.data.every((v) => v === 255)).toBe(true);
  });

  it("invalidates on writes, undo, redo, layer and document changes", () => {
    const { store, layer, id } = fixture();
    const first = fillRegionPlan(store, layer, { x: 0, y: 0 });
    store.dispatch({ type: "paintGrid", layerId: id, cells: Array.from({ length: 6 }, (_, y) => ({ x: 4, y, value: 1 })) });
    const left = fillRegionPlan(store, layer, { x: 0, y: 0 });
    expect(left).not.toBe(first);
    expect([...runPoints(left.runs)]).toHaveLength(24);
    const right = fillRegionPlan(store, layer, { x: 7, y: 0 });
    expect(right).not.toBe(left);
    expect([...runPoints(right.runs)]).toHaveLength(18);
    store.undo();
    const undone = fillRegionPlan(store, layer, { x: 7, y: 0 });
    expect(undone).not.toBe(right);
    expect([...runPoints(undone.runs)]).toHaveLength(48);
    store.redo();
    expect(fillRegionPlan(store, layer, { x: 7, y: 0 })).not.toBe(undone);
    const otherId = store.dispatch({ type: "addLayer", layer: { name: "Other", type: "grid", role: "collision" } });
    expect(fillRegionPlan(store, store.document.getLayer(otherId)!, { x: 0, y: 0 }).layer).not.toBe(layer);
    const other = fixture();
    expect(fillRegionPlan(other.store, other.layer, { x: 0, y: 0 })).not.toBe(first);
  });

  it("keeps exact fresh-click traversal from any cached hover origin on arbitrary maps", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 35 }), fc.integer({ min: 1, max: 35 }),
      fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1225, maxLength: 1225 }),
      fc.nat(), fc.nat(),
      (width, height, values, sx, sy) => {
        const store = new MapStore(createDocument({ width, height }));
        const layer = { getCell: (x: number, y: number) => values[y * 35 + x]! };
        const origin = { x: sx % width, y: sy % height };
        const plan = fillRegionPlan(store, layer, origin);
        // Every run's endpoints and midpoint exercise branches and queued overlaps.
        for (const r of plan.runs) {
          for (const x of [r.left, r.right, (r.left + r.right) >>> 1]) {
            const click = { x, y: r.y };
            expect(fillRegionPlan(store, layer, click)).toBe(plan);
            expect(plan.runsAt(click)).toEqual(floodFillRuns(layer, x, r.y, -1, { width, height }));
          }
        }
        expect(plan.runsAt({ x: -1, y: 0 })).toEqual([]);
        expect(plan.runsAt({ x: 0.5, y: 0 })).toEqual([]);
      },
    ), { numRuns: 200 });
  });

  it("invalidates after map resizing", () => {
    const { store, layer } = fixture();
    const first = fillRegionPlan(store, layer, { x: 0, y: 0 });
    store.dispatch({ type: "resizeMap", width: 10, height: 8 });
    const resized = fillRegionPlan(store, layer, { x: 0, y: 0 });
    expect(resized).not.toBe(first);
    expect(resized.mask).toHaveLength(80);
    expect([...runPoints(resized.runs)]).toHaveLength(80);
  });

  it("never reuses an edge membership bit for an out-of-bounds start", () => {
    const { store, layer } = fixture();
    fillRegionPlan(store, layer, { x: 0, y: 0 });
    expect(fillRegionPlan(store, layer, { x: 8, y: 0 }).runs).toEqual([]);
    expect(fillRegionPlan(store, layer, { x: -1, y: 1 }).runs).toEqual([]);
    fillRegionPlan(store, layer, { x: 0, y: 0 });
    expect(fillRegionPlan(store, layer, { x: 0, y: 0.5 }).runs).toEqual([]);
  });
});

describe("run fill writes", () => {
  it("matches point-fill writes for mixed patterns, no-ops and flags in exact order", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 35 }), fc.integer({ min: 1, max: 35 }),
      fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1225, maxLength: 1225 }),
      fc.nat(), fc.nat(),
      (width, height, values, sx, sy) => {
        const layer = { getCell: (x: number, y: number) => values[y * 35 + x]! };
        const x = sx % width;
        const y = sy % height;
        const before = layer.getCell(x, y);
        const candidates = [0, before, 3, 0x8000_0004];
        const at = (cx: number, cy: number) => candidates[(cx * 31 + cy * 17) % candidates.length]!;
        const expected = floodFill(layer, x, y, -1, { width, height }).flatMap((p) => {
          const cell = at(p.x, p.y);
          return cell === 0 || layer.getCell(p.x, p.y) === cell ? [] : [{ ...p, cell }];
        });
        expect(fillRunWrites(floodFillRuns(layer, x, y, -1, { width, height }), before, at)).toEqual(expected);
      },
    ), { numRuns: 200 });
  });
});
