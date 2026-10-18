import { describe, expect, it } from "vitest";
import { keysFor } from "../../shortcuts/shortcuts";
import { FOCUS_REGIONS, nextFocusRegion } from "./focusRegions";

describe("region focus", () => {
  it("registers forward and backward shortcuts in the shared list", () => {
    expect(keysFor("view.focusNextRegion")).toEqual(["F6"]);
    expect(keysFor("view.focusPrevRegion")).toEqual(["Shift+F6"]);
  });
  it("cycles in both directions and wraps", () => {
    FOCUS_REGIONS.forEach((region, i) => {
      expect(nextFocusRegion(region, FOCUS_REGIONS, 1)).toBe(FOCUS_REGIONS[(i + 1) % 5]);
      expect(nextFocusRegion(region, FOCUS_REGIONS, -1)).toBe(FOCUS_REGIONS[(i + 4) % 5]);
    });
  });
  it("skips unavailable regions and handles focus elsewhere", () => {
    expect(nextFocusRegion("dock", ["canvas", "library"], 1)).toBe("library");
    expect(nextFocusRegion("library", ["canvas"], -1)).toBe("canvas");
    expect(nextFocusRegion(null, FOCUS_REGIONS, 1)).toBe("canvas");
    expect(nextFocusRegion(null, FOCUS_REGIONS, -1)).toBe("library");
    expect(nextFocusRegion("canvas", [], 1)).toBeNull();
  });
});
