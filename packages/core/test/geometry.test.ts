import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lineCells } from "../src";

const coord = fc.integer({ min: -200, max: 200 });

describe("lineCells", () => {
  it("includes both endpoints, is 8-connected and has max(|dx|,|dy|)+1 cells", () => {
    fc.assert(
      fc.property(coord, coord, coord, coord, (x0, y0, x1, y1) => {
        const cells = lineCells(x0, y0, x1, y1);
        expect(cells[0]).toEqual({ x: x0, y: y0 });
        expect(cells.at(-1)).toEqual({ x: x1, y: y1 });
        expect(cells.length).toBe(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
        for (let i = 1; i < cells.length; i++) {
          const a = cells[i - 1]!;
          const b = cells[i]!;
          expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBe(1);
        }
      }),
    );
  });

  it("single point", () => {
    expect(lineCells(3, 4, 3, 4)).toEqual([{ x: 3, y: 4 }]);
  });

  it("floors fractional inputs", () => {
    expect(lineCells(0.9, 0.2, 2.5, -0.5)).toEqual(lineCells(0, 0, 2, -1));
  });

  it("is symmetric as a set for axis-aligned and diagonal lines", () => {
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    expect(new Set(lineCells(0, 0, 5, 5).map(key))).toEqual(new Set(lineCells(5, 5, 0, 0).map(key)));
    expect(lineCells(0, 0, 0, 3).map(key)).toEqual(["0,0", "0,1", "0,2", "0,3"]);
  });
});
