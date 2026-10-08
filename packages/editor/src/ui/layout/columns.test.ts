import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { clampWidth, COLUMNS, defaultLibraryWidth, fitColumns, MIN_CANVAS, RAIL_WIDTH, readFlag, readWidth, widenLibraryTarget, writeFlag, writeWidth, type WidthStorage } from "./columns";

function memory(initial: Record<string, string> = {}): WidthStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}
const throwing: WidthStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("column widths", () => {
  it("clamps to min / max and rounds", () => {
    expect(clampWidth(COLUMNS.library, 100)).toBe(240);
    expect(clampWidth(COLUMNS.library, 9999)).toBe(520);
    expect(clampWidth(COLUMNS.library, 300.6)).toBe(301);
    expect(clampWidth(COLUMNS.right, 200)).toBe(260);
    expect(clampWidth(COLUMNS.right, Number.NaN)).toBe(COLUMNS.right.initial);
  });

  it("persists the clamped width and reads it back", () => {
    const store = memory();
    expect(readWidth(COLUMNS.library, store)).toBe(COLUMNS.library.initial);
    writeWidth(COLUMNS.library, store, 400);
    expect(readWidth(COLUMNS.library, store)).toBe(400);
    writeWidth(COLUMNS.library, store, 5000);
    expect(store.data[COLUMNS.library.key]).toBe("520");
    expect(readWidth(COLUMNS.library, memory({ [COLUMNS.library.key]: "12" }))).toBe(240);
    expect(readWidth(COLUMNS.library, memory({ [COLUMNS.library.key]: "abc" }))).toBe(COLUMNS.library.initial);
    expect(readWidth(COLUMNS.library, memory({ [COLUMNS.library.key]: "" }))).toBe(COLUMNS.library.initial);
  });

  it("survives blocked or missing storage", () => {
    expect(readWidth(COLUMNS.right, throwing)).toBe(COLUMNS.right.initial);
    expect(() => writeWidth(COLUMNS.right, throwing, 300)).not.toThrow();
    expect(readWidth(COLUMNS.right, null)).toBe(COLUMNS.right.initial);
    expect(readFlag("x", throwing)).toBe(false);
    const store = memory();
    writeFlag("x", store, true);
    expect(readFlag("x", store)).toBe(true);
  });

  it("1366 px: defaults fit with a canvas of at least MIN_CANVAS", () => {
    const fit = fitColumns(1366, { library: COLUMNS.library.initial, right: COLUMNS.right.initial });
    expect(fit).toEqual({ library: COLUMNS.library.initial, right: COLUMNS.right.initial });
    expect(1366 - RAIL_WIDTH - fit.library - fit.right).toBeGreaterThanOrEqual(MIN_CANVAS);
  });

  it("when the window is too small the wider column gives way first, never below its min", () => {
    const fit = fitColumns(1366, { library: 520, right: 440 });
    expect(1366 - RAIL_WIDTH - fit.library - fit.right).toBe(MIN_CANVAS);
    expect(fit.library).toBeGreaterThanOrEqual(240);
    expect(fit.right).toBeGreaterThanOrEqual(260);
    expect(fitColumns(800, { library: 520, right: 440 })).toEqual({ library: 240, right: 260 });
  });

  it("hidden columns take no width", () => {
    expect(fitColumns(1366, { library: 300, right: 300 }, { library: false, right: true })).toEqual({ library: 0, right: 300 });
  });

  it("property: widths stay within bounds and the canvas gets MIN_CANVAS whenever the minimums allow it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 600, max: 4000 }), fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 0, max: 2000 }), (vw, l, r) => {
        const fit = fitColumns(vw, { library: l, right: r });
        expect(fit.library).toBeGreaterThanOrEqual(COLUMNS.library.min);
        expect(fit.library).toBeLessThanOrEqual(COLUMNS.library.max);
        expect(fit.right).toBeGreaterThanOrEqual(COLUMNS.right.min);
        expect(fit.right).toBeLessThanOrEqual(COLUMNS.right.max);
        const roomForMins = vw - RAIL_WIDTH - COLUMNS.library.min - COLUMNS.right.min >= MIN_CANVAS;
        if (roomForMins) expect(vw - RAIL_WIDTH - fit.library - fit.right).toBeGreaterThanOrEqual(MIN_CANVAS);
      }),
    );
  });
});

describe("library default and smart widen", () => {
  it("is wider by default on wide screens", () => {
    expect(defaultLibraryWidth(1366)).toBe(COLUMNS.library.initial);
    expect(defaultLibraryWidth(1920)).toBeGreaterThanOrEqual(340);
    expect(defaultLibraryWidth(1920)).toBeLessThanOrEqual(360);
  });

  it("widens by the missing width when it fits", () => {
    // 12 columns × 32 px = 384 px of tiles in a 272 px view: 112 px more.
    expect(widenLibraryTarget(1366, { library: 288, right: 288 }, 112)).toBe(400);
  });

  it("refuses past the column max or into the canvas minimum", () => {
    expect(widenLibraryTarget(1920, { library: 352, right: 288 }, 400)).toBeNull();
    // 1100 px window: 1100 − 44 − 288 − 400 = 368 px at most.
    expect(widenLibraryTarget(1100, { library: 288, right: 288 }, 112)).toBeNull();
    expect(widenLibraryTarget(1100, { library: 288, right: 288 }, 80)).toBe(368);
    expect(widenLibraryTarget(1366, { library: 288, right: 288 }, 0)).toBeNull();
  });

  it("never leaves the canvas below its minimum", () => {
    fc.assert(
      fc.property(fc.integer({ min: 900, max: 3000 }), fc.integer({ min: 240, max: 520 }), fc.integer({ min: 260, max: 440 }), fc.integer({ min: 1, max: 400 }), (vw, lib, right, extra) => {
        const target = widenLibraryTarget(vw, { library: lib, right }, extra);
        if (target === null) return;
        const fitted = fitColumns(vw, { library: target, right });
        expect(fitted.library).toBe(target);
        expect(vw - RAIL_WIDTH - fitted.library - fitted.right).toBeGreaterThanOrEqual(MIN_CANVAS);
        expect(target).toBeLessThanOrEqual(COLUMNS.library.max);
      }),
    );
  });
});
