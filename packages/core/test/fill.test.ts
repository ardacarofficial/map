import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { floodFill, floodFillRuns, makeCell, normalizeRect, rectCells, serializeLevel, type CellSource } from "../src";
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

/** Independent pre-runs scanline traversal: retain point order as well as cells. */
function referencePointFill(grid: number[][], x: number, y: number, cell: number): { x: number; y: number }[] {
  const height = grid.length;
  const width = grid[0]!.length;
  if (x < 0 || y < 0 || x >= width || y >= height || grid[y]![x] === cell) return [];
  const target = grid[y]![x];
  const open = grid.map((row) => row.map((value) => value === target));
  const points: { x: number; y: number }[] = [];
  const stack = [{ x, y }];
  while (stack.length) {
    const start = stack.pop()!;
    if (!open[start.y]![start.x]) continue;
    let left = start.x;
    let right = start.x;
    while (left > 0 && open[start.y]![left - 1]) left--;
    while (right + 1 < width && open[start.y]![right + 1]) right++;
    for (let cx = left; cx <= right; cx++) {
      open[start.y]![cx] = false;
      points.push({ x: cx, y: start.y });
    }
    for (const cy of [start.y - 1, start.y + 1]) {
      if (cy < 0 || cy >= height) continue;
      let cx = left;
      while (cx <= right) {
        if (!open[cy]![cx]) { cx++; continue; }
        stack.push({ x: cx, y: cy });
        while (cx <= right && open[cy]![cx]) cx++;
      }
    }
  }
  return points;
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


describe("floodFillRuns", () => {
  it("expands to the existing scanline order and BFS region on sparse maps, including outside starts", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 45 }), fc.integer({ min: 1, max: 45 }),
      fc.array(fc.record({ x: fc.integer({ min: -32, max: 70 }), y: fc.integer({ min: -32, max: 70 }), cell: fc.integer({ min: 0, max: 3 }) }), { maxLength: 180 }),
      fc.integer({ min: -3, max: 48 }), fc.integer({ min: -3, max: 48 }), fc.integer({ min: 0, max: 4 }),
      (width, height, writes, x, y, value) => {
        const { store, ground } = makeStore(width, height);
        const inside = writes.filter((p) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height);
        store.dispatch({ type: "paintCells", layerId: ground, cells: inside });
        const layer = store.document.getLayer(ground)!;
        const bounds = { width, height };
        const runs = floodFillRuns(layer, x, y, value, bounds);
        expect(floodFillRuns(layer, x, y, value, bounds)).toEqual(runs);
        const expanded = runs.flatMap((r) => Array.from({ length: r.right - r.left + 1 }, (_, i) => ({ x: r.left + i, y: r.y })));
        expect(expanded).toEqual(floodFill(layer, x, y, value, bounds));
        const grid = Array.from({ length: height }, (_, cy) => Array.from({ length: width }, (_, cx) => layer.getCell(cx, cy)));
        expect(expanded).toEqual(referencePointFill(grid, x, y, value));
        const expected = x < 0 || y < 0 || x >= width || y >= height ? new Set() : referenceFill(grid, x, y, value);
        expect(new Set(expanded.map((p) => `${p.x},${p.y}`))).toEqual(expected);
        expect(expanded.length).toBe(expected.size);
        const depth = store.undoDepth;
        const before = grid;
        const beforeJson = serializeLevel(store.document);
        store.beginTransaction();
        store.dispatch({ type: "paintCells", layerId: ground, cells: expanded.map((p) => ({ ...p, cell: value })) });
        store.commit();
        const afterJson = serializeLevel(store.document);
        const after = grid.map((row, cy) => row.map((_, cx) => layer.getCell(cx, cy)));
        expect(store.undoDepth).toBe(depth + (expanded.length ? 1 : 0));
        if (expanded.length) {
          store.undo();
          expect(grid.map((row, cy) => row.map((_, cx) => layer.getCell(cx, cy)))).toEqual(before);
          expect(serializeLevel(store.document)).toBe(beforeJson);
          store.redo();
          expect(grid.map((row, cy) => row.map((_, cx) => layer.getCell(cx, cy)))).toEqual(after);
          expect(serializeLevel(store.document)).toBe(afterJson);
        }
        expect(floodFillRuns(layer, x, y, value, bounds)).toEqual([]);
      },
    ), { numRuns: 200 });
  });

  it("retains scanline order around disconnected spans", () => {
    const layer = { getCell: (x: number, y: number) => y === 1 && (x === 1 || x === 2) ? 1 : 0 };
    expect(floodFillRuns(layer, 0, 0, 2, { width: 4, height: 3 })).toEqual([
      { y: 0, left: 0, right: 3 },
      { y: 1, left: 3, right: 3 },
      { y: 2, left: 0, right: 3 },
      { y: 1, left: 0, right: 0 },
    ]);
    for (const x of [NaN, Infinity, 0.5]) expect(floodFillRuns(layer, x, 0, 2, { width: 4, height: 3 })).toEqual([]);
  });

  it("keeps uniform-map order, including empty sparse maps with outside chunks", () => {
    const bounds = { width: 4, height: 3 };
    const expected = [
      { y: 1, left: 0, right: 3 }, { y: 2, left: 0, right: 3 }, { y: 0, left: 0, right: 3 },
    ];
    expect(floodFillRuns({ getCell: () => 7 }, 2, 1, 8, bounds)).toEqual(expected);
    const { store, ground } = makeStore(4, 3);
    expect(floodFillRuns(store.document.getLayer(ground)!, 2, 1, 1, bounds)).toEqual(expected);
    const outside: CellSource = {
      getCell: () => 0,
      chunks: function* () { yield { cx: -1, cy: 0, key: "-1,0", filled: 1024, data: new Uint32Array(1024).fill(1) }; },
    };
    expect(floodFillRuns(outside, 2, 1, 1, bounds)).toEqual(expected);
  });

  it("keeps a million-cell region as 1024 runs", () => {
    expect(floodFillRuns({ getCell: () => 0 }, 0, 0, 1, { width: 1024, height: 1024 })).toHaveLength(1024);
  });
});
