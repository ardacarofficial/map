import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { floodFill, makeCell, normalizeRect, rectCells, type CellSource } from "../src";
import { makeStore } from "./helpers";

/** Naive reference: BFS over a plain grid. */
function referenceFill(grid: number[][], x: number, y: number, cell: number): Set<string> {
  const h = grid.length;
  const w = grid[0]!.length;
  const target = grid[y]![x]!;
  const out = new Set<string>();
  if (target === cell) return out;
  const queue = [[x, y] as const];
  out.add(`${x},${y}`);
  while (queue.length) {
    const [cx, cy] = queue.shift()!;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (grid[ny]![nx] !== target || out.has(`${nx},${ny}`)) continue;
      out.add(`${nx},${ny}`);
      queue.push([nx, ny]);
    }
  }
  return out;
}

describe("rectCells", () => {
  it("normalizes corners and clips to bounds", () => {
    expect(rectCells(2, 1, 0, 0)).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    ]);
    expect(rectCells(-3, -3, 0, 0, { width: 5, height: 5 })).toEqual([{ x: 0, y: 0 }]);
    expect(rectCells(-3, -3, -1, -1, { width: 5, height: 5 })).toEqual([]);
    expect(rectCells(4, 4, 9, 9, { width: 5, height: 5 })).toEqual([{ x: 4, y: 4 }]);
    expect(normalizeRect(7, 2, 3, 5)).toEqual({ x: 3, y: 2, width: 5, height: 4 });
  });
});

describe("floodFill", () => {
  it("matches a naive BFS on random grids (both via getCell and the chunk fast path)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 40 }),
        fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1600, maxLength: 1600 }),
        fc.nat(),
        fc.nat(),
        fc.integer({ min: 0, max: 3 }),
        (w, h, values, sx, sy, fillWith) => {
          const grid = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => values[y * 40 + x]!));
          const x = sx % w;
          const y = sy % h;
          const expected = referenceFill(grid, x, y, fillWith);
          const plain: CellSource = { getCell: (cx, cy) => grid[cy]?.[cx] ?? 0 };
          const got = floodFill(plain, x, y, fillWith, { width: w, height: h });
          expect(new Set(got.map((p) => `${p.x},${p.y}`))).toEqual(expected);
          expect(got.length).toBe(expected.size); // no duplicates

          const { store, ground } = makeStore(w, h, 3);
          store.dispatch({ type: "paintCells", layerId: ground, cells: grid.flatMap((row, cy) => row.map((v, cx) => ({ x: cx, y: cy, cell: makeCell(v) }))) });
          const layer = store.document.getLayer(ground)!;
          const fast = floodFill(layer, x, y, fillWith, store.document.map);
          expect(new Set(fast.map((p) => `${p.x},${p.y}`))).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns nothing out of bounds or when the region already has the cell", () => {
    const { store, ground } = makeStore(10, 10);
    const layer = store.document.getLayer(ground)!;
    expect(floodFill(layer, -1, 0, makeCell(1), store.document.map)).toEqual([]);
    expect(floodFill(layer, 10, 0, makeCell(1), store.document.map)).toEqual([]);
    expect(floodFill(layer, 0, 0, 0, store.document.map)).toEqual([]);
  });

  it("stops at walls and respects flip flags as different cells", () => {
    const { store, ground, cell } = makeStore(5, 5);
    // vertical wall at x = 2
    store.dispatch({ type: "paintCells", layerId: ground, cells: rectCells(2, 0, 2, 4).map((p) => ({ ...p, cell: cell(1) })) });
    const layer = store.document.getLayer(ground)!;
    expect(floodFill(layer, 0, 0, cell(2), store.document.map)).toHaveLength(10);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 2, y: 2, cell: cell(1, 0x8000_0000) }] });
    expect(floodFill(layer, 2, 0, cell(3), store.document.map)).toHaveLength(2);
  });

  // Wall-clock budgets: always-on bounds are generous (they only catch an
  // accidental O(n²) and must not fail under parallel test load); set
  // SMAP_PERF=1 for the strict budgets on a quiet machine.
  const strictPerf = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.["SMAP_PERF"] === "1";

  it("fills a 1000×1000 map quickly and as one undo step", { timeout: 120_000 }, () => {
    const { store, ground, cell } = makeStore(1000, 1000);
    // A few obstacles so it is not a single trivial run per row.
    store.dispatch({ type: "paintCells", layerId: ground, cells: rectCells(100, 0, 100, 998).map((p) => ({ ...p, cell: cell(1) })) });
    const layer = store.document.getLayer(ground)!;
    // Best of 3 (the first run includes JIT warm-up and suffers most from parallel test workers).
    let points: ReturnType<typeof floodFill> = [];
    let fillMs = Infinity;
    for (let run = 0; run < 3; run++) {
      const t0 = Date.now();
      points = floodFill(layer, 500, 500, cell(2), store.document.map);
      fillMs = Math.min(fillMs, Date.now() - t0);
    }
    expect(points).toHaveLength(1000 * 1000 - 999);
    expect(fillMs).toBeLessThan(strictPerf ? 500 : 5_000);

    const t1 = Date.now();
    const depth = store.undoDepth;
    store.dispatch({ type: "paintCells", layerId: ground, cells: points.map((p) => ({ ...p, cell: cell(2) })) });
    const paintMs = Date.now() - t1;
    expect(store.undoDepth).toBe(depth + 1);
    expect(layer.getCell(0, 0)).toBe(cell(2));
    expect(paintMs).toBeLessThan(strictPerf ? 5_000 : 45_000);
    store.undo();
    expect(layer.getCell(0, 0)).toBe(0);
  });
});
