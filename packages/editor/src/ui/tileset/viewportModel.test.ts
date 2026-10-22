import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { clampViewport, inversePoint, panViewport, scrollProjection, snapOrigin, sourceCellAt, zoomViewport, wheelScale } from "./viewportModel";

describe("single PNG viewport", () => {
  it("keeps the cursor source point through random zoom and pan sequences", () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -500, max: 500 })), { minLength: 1, maxLength: 100 }), steps => {
      let view = { x: 8, y: 8, scale: 1 };
      for (const [x, y, delta] of steps) {
        view = panViewport(view, delta / 3, delta / 7);
        const before = inversePoint(view, x, y);
        view = zoomViewport(view, wheelScale(view.scale, delta), x, y);
        const after = inversePoint(view, x, y);
        expect(after.x).toBeCloseTo(before.x, 8);
        expect(after.y).toBeCloseTo(before.y, 8);
        expect(view.scale).toBeGreaterThanOrEqual(0.125);
        expect(view.scale).toBeLessThanOrEqual(16);
      }
    }));
  });
  for (const dpr of [1, 1.25, 1.5]) it(`hits source tiles and rejects gutters at DPR ${dpr}`, () => {
    const grid = { tileWidth: 16, tileHeight: 12, columns: 4, rows: 3, margin: 3, spacing: 2 };
    const view = snapOrigin({ x: -17.13, y: 23.77, scale: 1.317 }, dpr);
    expect(view.x * dpr).toBeCloseTo(Math.round(view.x * dpr));
    const hit = (x: number, y: number) => sourceCellAt(grid, inversePoint(view, view.x + x * view.scale, view.y + y * view.scale));
    expect(hit(22, 20)).toEqual({ col: 1, row: 1 });
    expect(hit(19.5, 10)).toBeNull();
    expect(hit(2, 5)).toBeNull();
    expect(hit(-1, -1)).toBeNull();
    expect(hit(100, 100)).toBeNull();
  });
  it("responds continuously to small wheel deltas", () => {
    expect(wheelScale(1, -1)).toBeGreaterThan(1);
    expect(wheelScale(1, -1)).toBeLessThan(1.01);
  });
});

describe("viewport restoration", () => {
  it("projects all-view free panning on both axes without clipping at the top or left", () => {
    for (const dpr of [1, 1.25, 1.5, 2]) for (const offset of [{ x: 0, y: 0 }, { x: 120, y: 240 }, { x: -700, y: -500 }, { x: 900, y: 800 }]) {
      const { origin, scrollLeft, scrollTop } = scrollProjection(offset, { width: 260, height: 400 }, dpr);
      expect(scrollLeft).toBeGreaterThanOrEqual(0);
      expect(scrollTop).toBeGreaterThanOrEqual(0);
      expect(origin.x - scrollLeft).toBeCloseTo(offset.x);
      expect(origin.y - scrollTop).toBeCloseTo(offset.y);
    }
  });

  it("preserves a reachable pan and zoom, and never reconciles a hidden viewport", () => {
    const v = { x: -90, y: 70, scale: 2.5 };
    expect(clampViewport(v, 280, 300, 256, 256)).toEqual(v);
    for (const [w, h] of [[0, 0], [0, 300], [280, 0]]) {
      expect(clampViewport(v, w!, h!, 256, 256)).toBe(v);
    }
  });
  it("restores an offscreen sheet without changing its zoom", () => {
    const v = clampViewport({ x: -9000, y: 9000, scale: 2.5 }, 280, 100, 256, 256);
    expect(v.scale).toBe(2.5);
    expect(v.x + 256 * v.scale).toBeGreaterThanOrEqual(32);
    expect(v.y).toBeLessThanOrEqual(100 - 32);
    expect(clampViewport(v, 280, 100, 256, 256)).toEqual(v);
  });
  it("repairs invalid saved coordinates and scale", () => {
    expect(clampViewport({ x: NaN, y: Infinity, scale: NaN }, 280, 100, 256, 256)).toEqual({ x: 8, y: 8, scale: 1 });
  });
});
