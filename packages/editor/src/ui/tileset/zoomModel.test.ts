import { describe, expect, it } from "vitest";

import { classifyWheel } from "../../canvas/brush";

import { accumulateWheelZoom, anchoredScroll, fitScale, naturalScale, MIN_ZOOM, MAX_FIT_SCALE, stackWheel, stepZoom, tilesetWheel, zoomLabel } from "./zoomModel";

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

  it("wheel follows the map: mouse notch zooms, Shift scrolls sideways, trackpad pans, pinch / Ctrl zooms", () => {
    const base = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };
    for (const e of [
      { ...base, deltaY: 100 },
      { ...base, deltaY: 3, deltaMode: 1 },
      { ...base, deltaY: 2.5, ctrlKey: true },
      { ...base, deltaY: -120, metaKey: true },
      { ...base, deltaX: 2, deltaY: 1 },
      { ...base, deltaY: 4 },
      { ...base, deltaY: 100, shiftKey: true },
    ]) {
      // Same decision as the map canvas.
      const map = classifyWheel({ ...e, deltaY: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY }, false);
      expect(tilesetWheel(e, false).kind, JSON.stringify(e)).toBe(map === "pan" ? "pan" : "zoom");
    }
    expect(tilesetWheel({ ...base, deltaY: 100 }, false)).toEqual({ kind: "zoom", delta: 100 });
    expect(tilesetWheel({ ...base, deltaY: 3, deltaMode: 1 }, false)).toEqual({ kind: "zoom", delta: 48 });
    // Shift + mouse wheel: sideways.
    expect(tilesetWheel({ ...base, deltaY: 100, shiftKey: true }, false)).toEqual({ kind: "pan", dx: 100, dy: 0 });
    // Two-finger swipe: both axes; an ongoing pan keeps panning.
    expect(tilesetWheel({ ...base, deltaX: 5, deltaY: -3 }, false)).toEqual({ kind: "pan", dx: 5, dy: -3 });
    expect(tilesetWheel({ ...base, deltaY: 60 }, true).kind).toBe("pan");
  });

  it("wheel zoom steps once per notch, pinches add up", () => {
    expect(accumulateWheelZoom(0, -100)).toEqual({ acc: 0, step: 1 });
    expect(accumulateWheelZoom(0, 100)).toEqual({ acc: 0, step: -1 });
    let acc = 0;
    let steps = 0;
    for (let i = 0; i < 10; i++) {
      const r = accumulateWheelZoom(acc, -5);
      acc = r.acc;
      steps += r.step;
    }
    expect(steps).toBe(1);
    // A turn in the other direction starts over.
    expect(accumulateWheelZoom(-30, 10)).toEqual({ acc: 10, step: 0 });
  });

  it("in the Tümü list a plain wheel scrolls; only Ctrl / Cmd / pinch zooms", () => {
    const base = { deltaY: -100, deltaMode: 0, ctrlKey: false, metaKey: false };
    expect(stackWheel(base)).toBeNull();
    expect(stackWheel({ ...base, deltaY: 8 })).toBeNull();
    expect(stackWheel({ ...base, ctrlKey: true })).toBe(-100);
    expect(stackWheel({ ...base, metaKey: true, deltaY: 3, deltaMode: 1 })).toBeGreaterThan(3);
  });
});


describe("naturalScale", () => {
  it("keeps tiles at most 32px at a supported step, with a minimum zoom", () => {
    expect(naturalScale(16)).toBe(2);
    expect(naturalScale(32)).toBe(1);
    expect(naturalScale(48)).toBe(0.5);
    expect(naturalScale(64)).toBe(0.5);
    expect(naturalScale(256)).toBe(MIN_ZOOM);
  });
});
