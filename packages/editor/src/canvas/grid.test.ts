import { describe, expect, it } from "vitest";

import { GRID_HIDE_PX, gridAlpha, gridLayout } from "./grid";
import { quantizeZoom } from "./camera";

describe("gridLayout", () => {
  it("puts interior lines on whole device pixels, evenly spaced when zoom is quantized", () => {
    for (const res of [1, 1.25, 1.5]) {
      const zoom = quantizeZoom(1, 32, res);
      const g = gridLayout({ x: 10.3, y: 7.7, zoom }, res, 800, 600, 32, 32, 100, 80);
      expect(g.alpha).toBeCloseTo(0.1);
      expect(g.xs.length).toBeGreaterThan(5);
      for (const x of g.xs) expect(Number.isInteger(x)).toBe(true);
      const gaps = new Set(g.xs.slice(1).map((x, i) => x - g.xs[i]!));
      expect([...gaps]).toEqual([32 * zoom * res]);
    }
  });

  it("only includes visible interior lines", () => {
    const g = gridLayout({ x: 0, y: 0, zoom: 1 }, 1, 100, 100, 32, 32, 3, 3);
    expect(g.xs).toEqual([32, 64]);
    expect(g.ys).toEqual([32, 64]);
    expect([g.left, g.top, g.right, g.bottom]).toEqual([0, 0, 96, 96]);
    const clipped = gridLayout({ x: -40, y: 0, zoom: 1 }, 1, 50, 100, 32, 32, 3, 3);
    expect(clipped.xs).toEqual([24]);
  });

  it("uses zoom independently of tile size and hides tiny cells", () => {
    for (const tile of [8, 16, 32, 64]) {
      const g = gridLayout({ x: 0, y: 0, zoom: 1 }, 2, 800, 600, tile, tile, 100, 80);
      expect(g.alpha).toBeCloseTo(0.1);
    }
    const tiny = gridLayout({ x: 0, y: 0, zoom: 1 }, 2, 800, 600, 4, 4, 100, 80);
    expect(tiny.alpha).toBe(0);
    expect(tiny.xs).toEqual([]);
  });

  it("fades out at low zoom", () => {
    expect(gridAlpha(0.1)).toBe(0);
    expect(gridAlpha(0.5)).toBe(0);
    expect(gridAlpha(0.75)).toBeCloseTo(0.05);
    expect(gridAlpha(1)).toBeCloseTo(0.1);
    expect(gridAlpha(1.5)).toBeCloseTo(0.12);
    expect(gridAlpha(2)).toBeCloseTo(0.14);
    expect(gridAlpha(4)).toBeCloseTo(0.14);
    expect(gridAlpha(1, GRID_HIDE_PX)).toBe(0);
    const g = gridLayout({ x: 0, y: 0, zoom: 0.1 }, 1, 800, 600, 32, 32, 100, 80);
    expect(g.alpha).toBe(0);
    expect(g.xs).toEqual([]);
  });
});
