import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CELL_FLAG_MASK,
  EMPTY_CELL,
  FLIP_D,
  FLIP_H,
  FLIP_V,
  MAX_PALETTE_INDEX,
  cellFlags,
  cellPaletteIndex,
  hasFlipH,
  hasFlipV,
  isValidCell,
  makeCell,
  toggleFlipH,
  toggleFlipV,
  withFlags,
  withFlipH,
} from "../src";

const index = fc.integer({ min: 1, max: MAX_PALETTE_INDEX });
const flags = fc.subarray([FLIP_H, FLIP_V, FLIP_D]).map((bits) => bits.reduce((a, b) => (a | b) >>> 0, 0));

describe("cell packing", () => {
  it("roundtrips palette index and flags", () => {
    fc.assert(
      fc.property(index, flags, (i, f) => {
        const cell = makeCell(i, f);
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThanOrEqual(0xffffffff);
        expect(cellPaletteIndex(cell)).toBe(i);
        expect(cellFlags(cell)).toBe(f);
        expect(isValidCell(cell)).toBe(true);
      }),
    );
  });

  it("stays unsigned with the top bit set", () => {
    const cell = makeCell(MAX_PALETTE_INDEX, FLIP_H | FLIP_V | FLIP_D);
    expect(cell).toBe(0xffffffff);
    expect(cellFlags(cell)).toBe(CELL_FLAG_MASK);
    expect(hasFlipH(cell)).toBe(true);
  });

  it("ignores non-flag bits in flags, even negative numbers", () => {
    fc.assert(
      fc.property(index, fc.integer({ min: -(2 ** 31), max: 2 ** 32 - 1 }), (i, junk) => {
        const cell = makeCell(i, junk);
        expect(cellPaletteIndex(cell)).toBe(i);
        expect(cell).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("rejects out-of-range or non-integer palette indices", () => {
    for (const bad of [-1, MAX_PALETTE_INDEX + 1, 2 ** 32, 1.5, Number.NaN, Infinity]) {
      expect(() => makeCell(bad)).toThrow(RangeError);
    }
  });

  it("empty cells never carry flags", () => {
    expect(makeCell(0, FLIP_H)).toBe(EMPTY_CELL);
    expect(withFlags(EMPTY_CELL, FLIP_V)).toBe(EMPTY_CELL);
    expect(toggleFlipH(EMPTY_CELL)).toBe(EMPTY_CELL);
    expect(isValidCell(FLIP_H)).toBe(false);
  });

  it("toggling twice is the identity and touches only its bit", () => {
    fc.assert(
      fc.property(index, flags, (i, f) => {
        const cell = makeCell(i, f);
        expect(toggleFlipH(toggleFlipH(cell))).toBe(cell);
        expect(toggleFlipV(toggleFlipV(cell))).toBe(cell);
        expect(hasFlipH(toggleFlipH(cell))).toBe(!hasFlipH(cell));
        expect(hasFlipV(toggleFlipH(cell))).toBe(hasFlipV(cell));
        expect(cellPaletteIndex(withFlipH(cell, true))).toBe(i);
      }),
    );
  });

  it("isValidCell rejects non-uint32 values", () => {
    for (const bad of [-1, 2 ** 32, 0.5, Number.NaN]) expect(isValidCell(bad)).toBe(false);
  });
});
