import { describe, expect, it } from "vitest";
import { tabRevealDelta } from "./Tabs";

describe("tabRevealDelta", () => {
  it("keeps fully visible tabs stationary, including exact edge alignment", () => {
    expect(tabRevealDelta(20, 80, 20, 120)).toBe(0);
    expect(tabRevealDelta(80, 120, 20, 120)).toBe(0);
  });
  it("reveals either clipped edge with the smallest scroll", () => {
    expect(tabRevealDelta(10, 60, 20, 120)).toBe(-10);
    expect(tabRevealDelta(100, 140, 20, 120)).toBe(20);
  });
  it("aligns an oversized tab to its leading edge without alternating edges", () => {
    expect(tabRevealDelta(10, 160, 20, 120)).toBe(-10);
    expect(tabRevealDelta(20, 170, 20, 120)).toBe(0);
  });
});
