import { describe, expect, it } from "vitest";
import { majorGridLayout } from "./majorGrid";

describe("major grid", () => {
  it("places only interval lines relative to the origin, at whole device pixels at all DPRs and zooms", () => {
    for (const dpr of [1, 1.25, 1.5]) for (const zoom of [0.125, 0.5, 1, 1.37, 2, 8]) {
      const grid = majorGridLayout({ x: -13.3, y: 5.4, zoom }, dpr, 800, 600, 32, 32, 64, 48, { interval: 8, x: 2, y: -1 });
      expect([...grid.xs, ...grid.ys].every(Number.isInteger)).toBe(true);
      expect(grid.xs.length).toBeLessThanOrEqual(8);
      for (const x of grid.xs) expect(Array.from({ length: 8 }, (_, i) => Math.round(Math.round(-13.3 * dpr) + (2 + i * 8) * 32 * zoom * dpr))).toContain(x);
    }
  });
  it("is empty when disabled and remains bounded when zoomed far out", () => {
    const args = [{ x: 0, y: 0, zoom: 0.001 }, 1, 800, 600, 32, 32, 100000, 100000] as const;
    expect(majorGridLayout(...args, { interval: 0, x: 0, y: 0 }).xs).toEqual([]);
    expect(majorGridLayout(...args, { interval: 2, x: 0, y: 0 }).xs).toEqual([]);
  });
});
