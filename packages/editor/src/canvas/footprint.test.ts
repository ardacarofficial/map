import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { strokeCells } from "./brush";
import { brushFootprint, cellsBounds, clampBrushSize, constrainRect, footprintCells } from "./footprint";

const keys = (cells: readonly { x: number; y: number }[]) => cells.map((c) => `${c.x},${c.y}`);

describe("brushFootprint", () => {
  it("is the cursor cell at size 1", () => {
    expect(keys(brushFootprint(1, "square"))).toEqual(["0,0"]);
    expect(keys(brushFootprint(1, "circle"))).toEqual(["0,0"]);
  });

  it("is a size × size square centred on the cursor", () => {
    for (let n = 1; n <= 16; n++) {
      const fp = brushFootprint(n, "square");
      expect(fp).toHaveLength(n * n);
      const b = cellsBounds(fp)!;
      expect([b.x + Math.floor(n / 2), b.y + Math.floor(n / 2), b.width, b.height]).toEqual([0, 0, n, n]);
      expect(keys(fp)).toContain("0,0");
    }
  });

  it("rounds circles: 3 is a plus, 2 a full square, bigger ones lose the corners", () => {
    expect(new Set(keys(brushFootprint(3, "circle")))).toEqual(new Set(["0,-1", "-1,0", "0,0", "1,0", "0,1"]));
    expect(brushFootprint(2, "circle")).toHaveLength(4);
    const five = keys(brushFootprint(5, "circle"));
    expect(five).not.toContain("-2,-2");
    expect(five).toContain("-2,0");
    expect(five).toContain("0,0");
  });

  it("circles are symmetric, inside the square and contain the cursor", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 16 }), (n) => {
        const circle = brushFootprint(n, "circle");
        const square = new Set(keys(brushFootprint(n, "square")));
        const set = new Set(keys(circle));
        expect(set.has("0,0")).toBe(true);
        const lo = -Math.floor(n / 2);
        const hi = lo + n - 1;
        for (const c of circle) {
          expect(square.has(`${c.x},${c.y}`)).toBe(true);
          // mirror symmetric around the footprint centre, and transposable
          expect(set.has(`${lo + hi - c.x},${c.y}`)).toBe(true);
          expect(set.has(`${c.y},${c.x}`)).toBe(true);
        }
      }),
    );
  });

  it("clamps the size", () => {
    expect(clampBrushSize(0)).toBe(1);
    expect(clampBrushSize(40)).toBe(16);
    expect(clampBrushSize(Number.NaN)).toBe(1);
    expect(brushFootprint(99, "square")).toHaveLength(256);
  });
});

describe("footprint along a stroke", () => {
  it("covers a 3-wide band along a horizontal line, each cell once", () => {
    const offsets = brushFootprint(3, "square");
    const centers = strokeCells(null, [{ x: 0, y: 0 }, { x: 9, y: 0 }]);
    const cells = footprintCells(centers, offsets);
    expect(cells).toHaveLength(12 * 3);
    expect(new Set(keys(cells)).size).toBe(cells.length);
    expect(cellsBounds(cells)).toEqual({ x: -1, y: -1, width: 12, height: 3 });
  });

  it("never repeats a cell across calls that share `seen` (one stroke)", () => {
    const pt = fc.record({ x: fc.integer({ min: -30, max: 30 }), y: fc.integer({ min: -30, max: 30 }) });
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.constantFrom("square" as const, "circle" as const), fc.array(pt, { minLength: 1, maxLength: 8 }), (n, shape, samples) => {
        const offsets = brushFootprint(n, shape);
        const seen = new Set<string>();
        const all: { x: number; y: number }[] = [];
        let last: { x: number; y: number } | null = null;
        for (const s of samples) {
          all.push(...footprintCells(strokeCells(last, [s]), offsets, seen));
          last = s;
        }
        expect(new Set(keys(all)).size).toBe(all.length);
        // every sample's whole footprint is covered
        const set = new Set(keys(all));
        for (const s of samples) for (const o of offsets) expect(set.has(`${s.x + o.x},${s.y + o.y}`)).toBe(true);
      }),
    );
  });

  it("a Shift line starts after the last painted cell's footprint", () => {
    // How the tool controller joins a Shift + click to the previous stroke.
    const offsets = brushFootprint(1, "square");
    const from = { x: 2, y: 2 };
    const seen = new Set<string>();
    footprintCells([from], offsets, seen);
    const cells = footprintCells(strokeCells(from, [{ x: 6, y: 4 }]), offsets, seen);
    expect(keys(cells)).not.toContain("2,2");
    expect(cells.at(-1)).toEqual({ x: 6, y: 4 });
    expect(cells).toHaveLength(4);
    // 8-connected without gaps
    let prev = from;
    for (const c of cells) {
      expect(Math.max(Math.abs(c.x - prev.x), Math.abs(c.y - prev.y))).toBe(1);
      prev = c;
    }
  });
});

describe("constrainRect", () => {
  const none = { square: false, fromCenter: false };

  it("passes the drag through without modifiers", () => {
    expect(constrainRect({ x: 1, y: 2 }, { x: 5, y: 3 }, none)).toEqual({ a: { x: 1, y: 2 }, b: { x: 5, y: 3 } });
  });

  it("Shift makes a square towards the pointer, the longer side wins", () => {
    expect(constrainRect({ x: 0, y: 0 }, { x: 5, y: 2 }, { square: true, fromCenter: false }).b).toEqual({ x: 5, y: 5 });
    expect(constrainRect({ x: 0, y: 0 }, { x: -1, y: -4 }, { square: true, fromCenter: false }).b).toEqual({ x: -4, y: -4 });
    expect(constrainRect({ x: 3, y: 3 }, { x: 3, y: 3 }, { square: true, fromCenter: false }).b).toEqual({ x: 3, y: 3 });
  });

  it("Alt mirrors around the start cell", () => {
    expect(constrainRect({ x: 5, y: 5 }, { x: 7, y: 6 }, { square: false, fromCenter: true })).toEqual({ a: { x: 3, y: 4 }, b: { x: 7, y: 6 } });
  });

  it("always yields a square with Shift, centred on the start with Alt", () => {
    const pt = fc.record({ x: fc.integer({ min: -50, max: 50 }), y: fc.integer({ min: -50, max: 50 }) });
    fc.assert(
      fc.property(pt, pt, fc.boolean(), (start, end, center) => {
        const { a, b } = constrainRect(start, end, { square: true, fromCenter: center });
        expect(Math.abs(b.x - a.x)).toBe(Math.abs(b.y - a.y));
        if (center) {
          expect(a.x + b.x).toBe(2 * start.x);
          expect(a.y + b.y).toBe(2 * start.y);
        } else expect(a).toEqual(start);
      }),
    );
  });
});
