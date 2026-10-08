import { describe, expect, it } from "vitest";

import { anchoredScroll, fitScale, MAX_FIT_SCALE, stepZoom, zoomLabel } from "./zoomModel";

describe("tileset zoom", () => {
  it("fit prefers a whole-number scale", () => {
    // 8 × 32 px = 256 px in a 268 px panel → 1×; 16 px tiles → 2×.
    expect(fitScale(268, 256, 32)).toBe(1);
    expect(fitScale(268, 128, 16)).toBe(2);
    expect(fitScale(520, 256, 32)).toBe(2);
  });

  it("fit fills the width with a tile-aligned scale when a whole number would waste space", () => {
    // 460 / 256 = 1.8: 1× fills only 56 %, so one tile becomes 57 px.
    expect(fitScale(460, 256, 32)).toBe(57 / 32);
    // Wider than the panel: shrink, tiles stay whole pixels.
    const s = fitScale(268, 1024, 32);
    expect(s).toBeLessThan(1);
    expect(Number.isInteger(32 * s)).toBe(true);
    expect(1024 * s).toBeLessThanOrEqual(268);
  });

  it("fit is capped and safe with no size", () => {
    expect(fitScale(1000, 32, 16)).toBe(MAX_FIT_SCALE);
    expect(fitScale(0, 256, 32)).toBe(1);
    expect(fitScale(300, 0, 32)).toBe(1);
  });

  it("steps through the zoom levels from any scale", () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(1.78, 1)).toBe(2);
    expect(stepZoom(1.78, -1)).toBe(1.5);
    expect(stepZoom(8, 1)).toBe(8);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });

  it("anchored scroll keeps the point under the cursor", () => {
    // Content starts at 10 px (padding, scroll 0); cursor at 110 px → content x 100 at 1×.
    // At 2× that point is at 200 + 10; to keep it at 110 the view scrolls by 100.
    expect(anchoredScroll(110, 10, 1, 2, 10)).toBe(100);
    // Zooming back out returns to scroll 0.
    expect(anchoredScroll(110, 10 - 100, 2, 1, 10)).toBe(0);
    expect(anchoredScroll(0, 100, 1, 1, 10)).toBe(0); // never negative
  });

  it("labels", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(57 / 32)).toBe("178%");
  });
});
