import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { cellSpan, labelStep, niceStep, rulerTicks, tickStep } from "./rulerMath";

describe("ruler steps", () => {
  it("labels every ten tiles when spacing fits, otherwise uses nice steps", () => {
    expect(labelStep(64)).toBe(10);
    expect(labelStep(32)).toBe(10);
    expect(labelStep(16)).toBe(10);
    expect(labelStep(4.4)).toBe(10);
    expect(labelStep(4)).toBe(20);
    expect(tickStep(5)).toBe(1);
    expect(tickStep(32)).toBe(1);
    expect(labelStep(0.5)).toBe(100);
  });

  it("nice steps are 1, 2, 5 × 10ⁿ and long enough", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 500, noNaN: true }), (cellPx) => {
        const step = niceStep(cellPx, 44);
        expect(step * cellPx).toBeGreaterThanOrEqual(44);
        const lead = step / 10 ** Math.floor(Math.log10(step));
        expect([1, 2, 5]).toContain(Math.round(lead));
      }),
    );
  });

  it("minor ticks divide the label step and are not too dense", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 300, noNaN: true }), (cellPx) => {
        const minor = tickStep(cellPx);
        expect(labelStep(cellPx) % minor).toBe(0);
        if (minor < labelStep(cellPx)) expect(minor * cellPx).toBeGreaterThanOrEqual(5);
      }),
    );
  });
});

describe("rulerTicks", () => {
  it("lists cell boundaries inside the map and the ruler", () => {
    // 32 px cells, map starts 10 px in, 100 px long ruler, 10-cell map.
    const ticks = rulerTicks(10, 32, 100, 10);
    expect(ticks.map((t) => [t.pos, t.cell, t.major])).toEqual([
      [10, 0, true],
      [42, 1, false],
      [74, 2, false],
    ]);
  });

  it("starts at the first boundary on screen when scrolled past the map's start", () => {
    const ticks = rulerTicks(-100, 32, 64, 50);
    expect(ticks[0]!.cell).toBe(4);
    expect(ticks.every((t) => t.pos >= 0 && t.pos <= 64)).toBe(true);
  });

  it("stops at the map's end", () => {
    const ticks = rulerTicks(0, 32, 1000, 3);
    expect(ticks.at(-1)!.cell).toBe(3);
  });

  it("is empty without a map or a size", () => {
    expect(rulerTicks(0, 32, 100, 0)).toEqual([]);
    expect(rulerTicks(0, 0, 100, 10)).toEqual([]);
  });
});

describe("cellSpan", () => {
  it("is the hovered cell's span, clipped to the ruler", () => {
    expect(cellSpan(10, 32, 100, 1, 10)).toEqual({ from: 42, to: 74 });
    expect(cellSpan(10, 32, 100, 2, 10)).toEqual({ from: 74, to: 100 });
    expect(cellSpan(10, 32, 100, null, 10)).toBeNull();
    expect(cellSpan(10, 32, 100, 10, 10)).toBeNull();
    expect(cellSpan(10, 32, 100, 5, 10)).toBeNull(); // off the ruler
  });
});
