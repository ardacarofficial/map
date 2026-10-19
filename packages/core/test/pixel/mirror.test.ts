import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FLIP_D, FLIP_H, FLIP_V, makeCell, rotateCellFlags, cellFlags } from "../../src/cell";
import { composePixelFlags, inversePixelFlags, mirrorPixels, placedPixelSize, sourceToPlacedPixel, placedToSourcePixel } from "../../src/pixel/mirror";

const all = Array.from({ length: 8 }, (_, f) => ((f & 1 ? FLIP_D : 0) | (f & 2 ? FLIP_V : 0) | (f & 4 ? FLIP_H : 0)) >>> 0);
const flag = fc.constantFrom(...all);
const point = fc.record({ x: fc.integer({ min: -30, max: 30 }), y: fc.integer({ min: -30, max: 30 }) });
const keys = (ps: readonly { x: number; y: number }[]) => ps.map(p => `${p.x},${p.y}`).sort();

describe("pixel mirror axes", () => {
  it("mirror closure is idempotent and contains no duplicate axis pixels", () => {
    fc.assert(fc.property(fc.array(point, { maxLength: 20 }), fc.integer({ min: -10, max: 10 }), fc.integer({ min: -10, max: 10 }), (points, x, y) => {
      const axes = { horizontal: true, vertical: true, origin: { x: x / 2, y: y / 2 } };
      const once = mirrorPixels(points, axes);
      expect(keys(mirrorPixels(once, axes))).toEqual(keys(once));
      expect(new Set(keys(once)).size).toBe(once.length);
    }));
    const axes = { horizontal: true, vertical: true, origin: { x: 2, y: 3 } };
    expect(mirrorPixels([{ x: 2, y: 3 }], axes)).toEqual([{ x: 2, y: 3 }]);
    expect(mirrorPixels([{ x: 1, y: 1 }], { vertical: true, origin: { x: 1.5, y: 0 } })).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    expect(() => mirrorPixels([], { vertical: true, origin: { x: 0.2, y: 0 } })).toThrow(RangeError);
  });
});

describe("pixel D4 addressing", () => {
  it("composition, associativity and inverse obey group laws on rectangular rasters", () => {
    fc.assert(fc.property(flag, flag, flag, fc.integer({ min: 1, max: 32 }), fc.integer({ min: 1, max: 32 }), fc.nat(), fc.nat(), (a, b, c, w, h, x, y) => {
      const p = { x: x % w, y: y % h };
      const first = sourceToPlacedPixel(p, w, h, a), size = placedPixelSize(w, h, a);
      expect(sourceToPlacedPixel(first, size.width, size.height, b)).toEqual(sourceToPlacedPixel(p, w, h, composePixelFlags(a, b)));
      expect(placedToSourcePixel(first, w, h, a)).toEqual(p);
      expect(composePixelFlags(a, inversePixelFlags(a))).toBe(0);
      expect(composePixelFlags(inversePixelFlags(a), a)).toBe(0);
      expect(composePixelFlags(composePixelFlags(a, b), c)).toBe(composePixelFlags(a, composePixelFlags(b, c)));
    }), { numRuns: 1000 });
  });

  it("matches renderer inverse-UV semantics for all flags, and cell clockwise rotation", () => {
    for (const flags of all) for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const u = flags & FLIP_H ? 4 - x : x, v = flags & FLIP_V ? 4 - y : y;
      expect(placedToSourcePixel({ x, y }, 5, 5, flags)).toEqual(flags & FLIP_D ? { x: v, y: u } : { x: u, y: v });
      const cw = cellFlags(rotateCellFlags(makeCell(1, flags), "cw"));
      expect(composePixelFlags(flags, (FLIP_D | FLIP_H) >>> 0)).toBe(cw);
    }
    expect(sourceToPlacedPixel({ x: 0, y: 1 }, 2, 3, FLIP_D | FLIP_H)).toEqual({ x: 1, y: 0 });
  });
});
