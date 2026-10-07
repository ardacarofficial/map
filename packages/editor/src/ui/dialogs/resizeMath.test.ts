import { describe, expect, it } from "vitest";
import { arrowRotation, resizeOffsets } from "./resizeMath";

describe("resizeOffsets", () => {
  const from = { width: 10, height: 8 };
  it("keeps the anchored side in place", () => {
    expect(resizeOffsets(from, { width: 13, height: 10 }, 0)).toEqual({ offsetX: 0, offsetY: 0 });
    expect(resizeOffsets(from, { width: 13, height: 10 }, 8)).toEqual({ offsetX: 3, offsetY: 2 });
    expect(resizeOffsets(from, { width: 13, height: 10 }, 4)).toEqual({ offsetX: 1, offsetY: 1 });
    expect(resizeOffsets(from, { width: 13, height: 10 }, 5)).toEqual({ offsetX: 3, offsetY: 1 });
  });
  it("shrinks from the side opposite the anchor", () => {
    expect(resizeOffsets(from, { width: 6, height: 8 }, 2)).toEqual({ offsetX: -4, offsetY: 0 });
    expect(resizeOffsets(from, { width: 6, height: 4 }, 4)).toEqual({ offsetX: -2, offsetY: -2 });
  });
});

describe("arrowRotation", () => {
  it("points away from the anchor for neighbouring cells only", () => {
    expect(arrowRotation(4, 4)).toBeNull();
    expect(arrowRotation(1, 4)).toBe(0); // up
    expect(arrowRotation(5, 4)).toBe(90); // right
    expect(arrowRotation(7, 4)).toBe(180); // down
    expect(arrowRotation(8, 0)).toBeNull(); // two cells away
    expect(arrowRotation(1, 0)).toBe(90);
  });
});
