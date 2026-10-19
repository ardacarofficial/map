import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planPixelFill, planPixelFillAt } from "../../src/pixel/fill";
import { FLIP_H } from "../../src/cell";
import type { PixelGrid, RasterView } from "../../src/pixel/planner";
import type { Rgba8 } from "../../src/pixel/color";

const red = { r: 255, g: 0, b: 0, a: 128 };
const replacement = { r: 8, g: 9, b: 10, a: 255 };
function view(w: number, h: number, values: number[]): RasterView {
  return { width: w, height: h, get(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) throw new Error("out of bounds read");
    return { ...red, r: values[y * w + x]! };
  } };
}
function oracle(raster: RasterView, sx: number, sy: number): Set<string> {
  const target = raster.get(sx, sy), seen = new Set<string>(), queue = [{ x: sx, y: sy }];
  while (queue.length) {
    const p = queue.shift()!;
    const key = `${p.x},${p.y}`;
    if (p.x < 0 || p.y < 0 || p.x >= raster.width || p.y >= raster.height || seen.has(key)) continue;
    const c = raster.get(p.x, p.y);
    if ((Object.keys(c) as (keyof Rgba8)[]).some(k => c[k] !== target[k])) continue;
    seen.add(key);
    queue.push({ x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 });
  }
  return seen;
}

describe("tile pixel fill", () => {
  it("4-neighbour fill agrees with an independent naive BFS without mutating the source", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 16 }), fc.integer({ min: 1, max: 16 }), fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 256, maxLength: 256 }), fc.nat(), fc.nat(), (w, h, values, x, y) => {
      const raster = view(w, h, values), before = values.slice();
      x %= w; y %= h;
      const plan = planPixelFill(raster, { x, y }, replacement);
      expect(new Set(plan.writes.map(p => `${p.x},${p.y}`))).toEqual(oracle(raster, x, y));
      expect(plan.writes.every(p => p.color === plan.writes[0]!.color)).toBe(true);
      expect(values).toEqual(before);
      const all = planPixelFill(raster, { x, y }, replacement, "global");
      expect(all.writes.length).toBe(values.slice(0, w * h).filter(v => v === values[y * w + x]).length);
    }), { numRuns: 500 });
  });

  it("addresses a world seed through its cell flip and stays in that one tile", () => {
    const raster: RasterView = { width: 16, height: 16, get: x => x === 0 ? red : { r: 0, g: 0, b: 0, a: 0 } };
    const grid: PixelGrid = { tileWidth: 16, tileHeight: 16, getTile: (x, y) => x === 1 && y === 0 ? { raster, flags: FLIP_H } : null };
    const plan = planPixelFillAt({ x: 31, y: 3 }, grid, replacement);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ cellX: 1, cellY: 0, dirtyRect: { x: 0, y: 0, width: 1, height: 16 } });
    expect(plan[0]!.writes).toEqual(Array.from({ length: 16 }, (_, y) => ({ x: 0, y, color: replacement })));
    expect(planPixelFillAt({ x: -1, y: 0 }, grid, replacement)).toEqual([]);
    expect(planPixelFillAt({ x: 31, y: 3 }, grid, red)).toEqual([]);
  });

  it("matches alpha exactly, does not cross diagonals, and skips same-colour/outside fills", () => {
    const raster: RasterView = { width: 2, height: 2, get: (x, y) => x === y ? red : { ...red, a: 127 } };
    expect(planPixelFill(raster, { x: 0, y: 0 }, replacement).writes.length).toBe(1);
    expect(planPixelFill(raster, { x: 0, y: 0 }, replacement, "global").writes.length).toBe(2);
    expect(planPixelFill(raster, { x: 0, y: 0 }, red)).toEqual({ writes: [], dirtyRect: null });
    expect(planPixelFill(raster, { x: -1, y: 0 }, red)).toEqual({ writes: [], dirtyRect: null });
    expect(planPixelFill(raster, { x: 2, y: 0 }, red).writes).toEqual([]);
    expect(planPixelFill({ width: 0, height: 0, get: () => red }, { x: 0, y: 0 }, red).writes).toEqual([]);
  });
});
