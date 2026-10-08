import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  MAX_ZOOM,
  WHEEL_STEP_PX,
  ZOOM_PRESETS,
  initialZoom,
  nearestZoomStep,
  nextZoomStep,
  quantizeZoom,
  wheelZoomSteps,
} from "./camera";

describe("zoom presets", () => {
  it("are the pixel-art steps 12.5 % … 1600 %, ascending, ending at MAX_ZOOM", () => {
    expect(ZOOM_PRESETS.map((z) => Math.round(z * 1000) / 10)).toEqual([12.5, 25, 33.3, 50, 66.7, 100, 150, 200, 300, 400, 600, 800, 1200, 1600]);
    expect(ZOOM_PRESETS[ZOOM_PRESETS.length - 1]).toBe(MAX_ZOOM);
  });

  it("presets ≥ 100 % keep tiles whole device px at common Windows scalings (32 px tiles)", () => {
    for (const res of [1, 1.25, 1.5, 2]) {
      for (const z of ZOOM_PRESETS.filter((p) => p >= 1)) {
        expect(quantizeZoom(z, 32, res)).toBeCloseTo(z, 12);
        expect(Number.isInteger(Math.round(32 * z * res * 1e9) / 1e9)).toBe(true);
      }
    }
  });

  it("nearestZoomStep snaps in log space", () => {
    expect(nearestZoomStep(1.25)).toBe(1.5); // ln 1.25 is closer to ln 1.5 than to ln 1
    expect(nearestZoomStep(1.1)).toBe(1);
    expect(nearestZoomStep(1.97)).toBe(2);
    expect(nearestZoomStep(0.3)).toBeCloseTo(1 / 3);
    expect(nearestZoomStep(100)).toBe(16);
    expect(nearestZoomStep(0.01)).toBe(0.125);
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 40, noNaN: true }), (z) => {
        const s = nearestZoomStep(z);
        expect(ZOOM_PRESETS).toContain(s);
        for (const p of ZOOM_PRESETS) expect(Math.abs(Math.log(s / z))).toBeLessThanOrEqual(Math.abs(Math.log(p / z)) + 1e-12);
      }),
    );
  });

  it("nextZoomStep respects custom limits", () => {
    expect(nextZoomStep(16, 1, ZOOM_PRESETS, 0.1, 16)).toBe(16);
    expect(nextZoomStep(0.125, -1, ZOOM_PRESETS, 0.1, 16)).toBe(0.1);
    expect(nextZoomStep(1, 1, ZOOM_PRESETS, 0.1, 1.2)).toBe(1.2);
  });
});

describe("wheelZoomSteps", () => {
  it("a mouse notch is one step, up zooms in", () => {
    expect(wheelZoomSteps(-100, 0, 0)).toEqual({ steps: 1, acc: 0 });
    expect(wheelZoomSteps(100, 0, 0)).toEqual({ steps: -1, acc: 0 });
    // Fractional notches at 125 % / 150 % scaling, Firefox line mode.
    expect(wheelZoomSteps(-125, 0, 0).steps).toBe(1);
    expect(wheelZoomSteps(3, 1, 0).steps).toBe(-1);
  });

  it("small deltas accumulate to one step per WHEEL_STEP_PX", () => {
    let acc = 0;
    let steps = 0;
    for (let i = 0; i < 10; i++) {
      const r = wheelZoomSteps(-20, 0, acc);
      acc = r.acc;
      steps += r.steps;
    }
    expect(steps).toBe((10 * 20) / WHEEL_STEP_PX);
    // Reversing direction starts over.
    expect(wheelZoomSteps(20, 0, -80)).toEqual({ steps: 0, acc: 20 });
    expect(wheelZoomSteps(0, 0, 30)).toEqual({ steps: 0, acc: 30 });
  });
});

describe("initialZoom", () => {
  it("opens big maps at 100 % (32 px tiles), never below 50 %", () => {
    expect(initialZoom(0.28, 32)).toBe(0.5);
    expect(initialZoom(0.6, 32)).toBe(0.5);
    expect(initialZoom(0.8, 32)).toBe(2 / 3);
    expect(initialZoom(1.4, 32)).toBe(1);
    expect(initialZoom(4, 32)).toBe(1);
  });

  it("small tiles open larger so the grid stays readable", () => {
    expect(initialZoom(0.3, 16)).toBe(1); // ≥ 16 px cells
    expect(initialZoom(10, 16)).toBe(2); // ≤ 32 px cells
    expect(initialZoom(10, 8)).toBe(4);
    expect(initialZoom(10, 64)).toBe(1);
  });

  it("always returns a preset", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 50, noNaN: true }), fc.integer({ min: 4, max: 128 }), (fit, tile) => {
        expect(ZOOM_PRESETS).toContain(initialZoom(fit, tile));
      }),
    );
  });
});
