import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pixelFootprint, pixelLine, pixelRectangle, pixelStrokePoints } from "../../src/pixel/tools";

const coord = fc.integer({ min: -50, max: 50 });
const point = fc.record({ x: coord, y: coord });
const keys = (points: readonly { x: number; y: number }[]) => points.map(p => `${p.x},${p.y}`).sort();

describe("pixel geometry", () => {
  it("Bresenham includes both endpoints and is reversal symmetric, connected and unique", () => {
    fc.assert(fc.property(point, point, (a, b) => {
      const line = pixelLine(a, b);
      expect(line).toEqual(pixelLine(b, a).reverse());
      expect(line[0]).toEqual(a);
      expect(line.at(-1)).toEqual(b);
      expect(line.length).toBe(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) + 1);
      expect(new Set(keys(line)).size).toBe(line.length);
      expect(line.every((p, i) => i === 0 || (Math.abs(p.x - line[i - 1]!.x) <= 1 && Math.abs(p.y - line[i - 1]!.y) <= 1))).toBe(true);
    }), { numRuns: 1000 });
  }, 15_000);

  it("footprints have exact integer extents and symmetric circle rows for odd/even sizes", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), n => {
      const square = pixelFootprint(n, "square"), circle = pixelFootprint(n, "circle");
      expect(square.length).toBe(n * n);
      const lo = 0 - Math.floor(n / 2), hi = lo + n - 1;
      expect(Math.min(...square.map(p => p.x))).toBe(lo);
      expect(Math.max(...square.map(p => p.y))).toBe(hi);
      expect(keys(circle)).toEqual(keys(circle.map(p => ({ x: lo + hi - p.x, y: p.y }))));
      expect(keys(circle)).toEqual(keys(circle.map(p => ({ x: p.x, y: lo + hi - p.y }))));
      expect(circle.length).toBeGreaterThan(0);
      expect(circle.length).toBeLessThanOrEqual(n * n);
    }));
    expect([1, 2, 3, 5].map(n => pixelFootprint(n, "circle").length)).toEqual([1, 4, 5, 21]);
    for (const bad of [0, -1, 1.5, NaN, Infinity]) expect(() => pixelFootprint(bad)).toThrow(RangeError);
  });

  it("rectangle outline includes corners once and handles a single row/column", () => {
    fc.assert(fc.property(point, point, (a, b) => {
      const w = Math.abs(a.x - b.x) + 1, h = Math.abs(a.y - b.y) + 1;
      const filled = pixelRectangle(a, b, true), outline = pixelRectangle(a, b, false);
      expect(filled.length).toBe(w * h);
      expect(outline.length).toBe(w === 1 || h === 1 ? w * h : 2 * w + 2 * h - 4);
      expect(new Set(keys(outline)).size).toBe(outline.length);
      expect(outline).toEqual(pixelRectangle(b, a, false));
    }));
  });

  it("coalesced samples bridge gaps and deduplicate the entire footprint union", () => {
    fc.assert(fc.property(fc.array(point, { maxLength: 8 }), fc.integer({ min: 1, max: 6 }), (samples, size) => {
      const centres = samples.flatMap((p, i) => i ? pixelLine(samples[i - 1]!, p) : [p]);
      const expected = new Set(centres.flatMap(p => pixelFootprint(size).map(o => `${p.x + o.x},${p.y + o.y}`)));
      const actual = pixelStrokePoints(samples, size);
      expect(new Set(keys(actual))).toEqual(expected);
      expect(actual.length).toBe(expected.size);
    }));
    expect(pixelStrokePoints([], 1)).toEqual([]);
  });

  it("rejects non-finite or fractional world pixels instead of hanging", () => {
    expect(() => pixelLine({ x: Infinity, y: 0 }, { x: 0, y: 0 })).toThrow(RangeError);
    expect(() => pixelRectangle({ x: 0.5, y: 0 }, { x: 0, y: 0 })).toThrow(RangeError);
  });
});
