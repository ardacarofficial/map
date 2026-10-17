/** Roving keyboard navigation contract: wrap, skip disabled options, endpoints and RTL. */
import { describe, expect, it } from "vitest";

import { rovingIndex } from "./rovingFocus";

describe("rovingIndex", () => {
  it("wraps in both directions and skips disabled items", () => {
    const disabled = [false, true, false, true];
    expect(rovingIndex("ArrowRight", 0, disabled)).toBe(2);
    expect(rovingIndex("ArrowRight", 2, disabled)).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, disabled)).toBe(2);
    expect(rovingIndex("ArrowDown", 0, disabled)).toBe(2);
    expect(rovingIndex("ArrowUp", 0, disabled)).toBe(2);
  });
  it("goes to the first/last enabled option", () => {
    expect(rovingIndex("Home", 2, [true, false, false, true])).toBe(1);
    expect(rovingIndex("End", 1, [true, false, false, true])).toBe(2);
  });
  it("reverses horizontal arrows in RTL without reversing vertical arrows", () => {
    expect(rovingIndex("ArrowRight", 0, [false, false, false], true)).toBe(2);
    expect(rovingIndex("ArrowLeft", 0, [false, false, false], true)).toBe(1);
    expect(rovingIndex("ArrowDown", 0, [false, false, false], true)).toBe(1);
  });
  it("leaves unrelated keys and fully disabled groups alone", () => {
    expect(rovingIndex("Tab", 0, [false, false])).toBeUndefined();
    expect(rovingIndex("ArrowRight", 0, [true, true])).toBeUndefined();
    expect(rovingIndex("Home", 0, [])).toBeUndefined();
  });
});
