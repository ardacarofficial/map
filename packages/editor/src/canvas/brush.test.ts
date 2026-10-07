import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { cellWrites, classifyWheel, strokeCells } from "./brush";

describe("strokeCells", () => {
  it("connects samples without gaps and excludes the already painted start", () => {
    const cells = strokeCells({ x: 0, y: 0 }, [{ x: 5, y: 0 }, { x: 5, y: 3 }]);
    expect(cells[0]).toEqual({ x: 1, y: 0 });
    expect(cells.at(-1)).toEqual({ x: 5, y: 3 });
    expect(cells).toHaveLength(8);
  });

  it("includes the first sample when there is no previous cell", () => {
    expect(strokeCells(null, [{ x: 2, y: 2 }])).toEqual([{ x: 2, y: 2 }]);
  });

  it("is always 8-connected and duplicate-free", () => {
    const pt = fc.record({ x: fc.integer({ min: -50, max: 50 }), y: fc.integer({ min: -50, max: 50 }) });
    fc.assert(
      fc.property(pt, fc.array(pt, { minLength: 1, maxLength: 20 }), (start, samples) => {
        const cells = strokeCells(start, samples);
        const keys = cells.map((c) => `${c.x},${c.y}`);
        expect(new Set(keys).size).toBe(keys.length);
        // every sample is covered (unless it is the start itself)
        for (const s of samples) {
          if (s.x === start.x && s.y === start.y) continue;
          expect(keys).toContain(`${s.x},${s.y}`);
        }
      }),
    );
  });
});

describe("cellWrites", () => {
  it("skips out-of-bounds cells and cells already holding the value", () => {
    const grid = new Map([["1,1", 7]]);
    const writes = cellWrites(
      [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 10, y: 0 }],
      7,
      10,
      10,
      (x, y) => grid.get(`${x},${y}`) ?? 0,
    );
    expect(writes).toEqual([{ x: 0, y: 0, cell: 7 }]);
  });
});

describe("classifyWheel", () => {
  const base = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };
  it("mouse notches zoom", () => {
    expect(classifyWheel({ ...base, deltaY: 100 }, false)).toBe("zoom");
    expect(classifyWheel({ ...base, deltaY: 3, deltaMode: 1 }, false)).toBe("zoom");
    expect(classifyWheel({ ...base, deltaY: 66.67 }, false)).toBe("zoom");
  });
  it("ctrl+wheel: small deltas are pinch, notches are zoom", () => {
    expect(classifyWheel({ ...base, deltaY: 2.5, ctrlKey: true }, false)).toBe("pinch");
    expect(classifyWheel({ ...base, deltaY: 100, ctrlKey: true }, false)).toBe("zoom");
  });
  it("trackpad scrolling pans", () => {
    expect(classifyWheel({ ...base, deltaX: 3, deltaY: 1 }, false)).toBe("pan");
    expect(classifyWheel({ ...base, deltaY: 4 }, false)).toBe("pan");
    expect(classifyWheel({ ...base, deltaY: 60 }, true)).toBe("pan");
    expect(classifyWheel({ ...base, deltaY: 100, shiftKey: true }, false)).toBe("pan");
  });
});
