/** Numeric field parsing accepts decimal separators and rejects incomplete/unsafe numeric text. */
import { describe, expect, it } from "vitest";

import { parsePropNumber } from "./PropRow";

describe("parsePropNumber", () => {
  it("accepts signed integers and dot/comma decimals", () => {
    for (const [text, expected] of [["42", 42], [" -12 ", -12], ["+3", 3], ["1.25", 1.25], ["1,25", 1.25], [",5", 0.5], ["-.5", -0.5], ["1.", 1]] as const) {
      expect(parsePropNumber(text)).toBe(expected);
    }
  });
  it("keeps incomplete text distinct from zero and rejects unsupported forms", () => {
    for (const text of ["", " ", "-", "+", ".", ",", "1,2,3", "1.2.3", "0x10", "1e3", "Infinity", "NaN", "12px", "9".repeat(400)]) {
      expect(parsePropNumber(text)).toBeUndefined();
    }
  });
});
