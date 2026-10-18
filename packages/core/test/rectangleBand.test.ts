import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rectangleBand, rectangleBandContains } from "../src/rectangleBand";

describe("rectangleBand", () => {
  it("equals the distance-to-edge definition, without duplicates, including thin and over-thick rectangles", () => {
    fc.assert(fc.property(fc.integer({ min: -40, max: 40 }), fc.integer({ min: -40, max: 40 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 0, max: 8 }), (x, y, width, height, thickness) => {
      const r = { x, y, width, height };
      const actual = [...rectangleBand(r, thickness)];
      const expected = [];
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
        const included = thickness === 0 || Math.min(dx, dy, width - 1 - dx, height - 1 - dy) < thickness;
        expect(rectangleBandContains(r, thickness, x + dx, y + dy)).toBe(included);
        if (included) expected.push({ x: x + dx, y: y + dy });
      }
      expect(actual).toEqual(expected);
      expect(new Set(actual.map(p => `${p.x},${p.y}`)).size).toBe(actual.length);
      expect(rectangleBandContains(r, thickness, x - 1, y)).toBe(false);
    }));
  });

  it("clips iteration without inventing a border at viewport edges", () => {
    expect([...rectangleBand({ x: 0, y: 0, width: 10, height: 10 }, 1, { x: 3, y: 0, width: 3, height: 4 })]).toEqual([{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }]);
  });
});
