import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  cameraAnchored,
  centeredCamera,
  clampZoom,
  easeZoom,
  fitZoom,
  frameCamera,
  nextZoomStep,
  quantizeZoom,
  screenToCell,
  screenToWorld,
  snappedOffset,
  visibleCells,
  wheelDeltaPixels,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
} from "./camera";

describe("camera conversions", () => {
  it("screen ↔ world round-trips with the snapped offset", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: 0.1, max: 32, noNaN: true }),
        fc.constantFrom(1, 1.25, 1.5, 2),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        (x, y, zoom, res, wx) => {
          const cam = { x, y, zoom };
          const s = worldToScreen(cam, wx, wx * 0.5, res);
          const w = screenToWorld(cam, s.x, s.y, res);
          expect(w.x).toBeCloseTo(wx, 6);
          expect(w.y).toBeCloseTo(wx * 0.5, 6);
        },
      ),
    );
  });

  it("snaps the offset to whole device pixels", () => {
    const o = snappedOffset({ x: 10.3, y: -3.7, zoom: 1 }, 1.25);
    expect(o.x * 1.25).toBe(Math.round(10.3 * 1.25));
    expect(o.y * 1.25).toBe(Math.round(-3.7 * 1.25));
  });

  it("maps screen points to cells with floor (negatives too)", () => {
    const cam = { x: 100, y: 50, zoom: 2 };
    expect(screenToCell(cam, 100, 50, 32, 32, 1)).toEqual({ x: 0, y: 0 });
    expect(screenToCell(cam, 163.9, 113.9, 32, 32, 1)).toEqual({ x: 0, y: 0 });
    expect(screenToCell(cam, 164, 114, 32, 32, 1)).toEqual({ x: 1, y: 1 });
    expect(screenToCell(cam, 99, 49, 32, 32, 1)).toEqual({ x: -1, y: -1 });
  });
});

describe("zoom", () => {
  it("zoomAt keeps the world point under the cursor fixed", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 0.1, max: 32, noNaN: true }),
        fc.double({ min: 0.1, max: 32, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        (x, z0, z1, sx) => {
          const cam = { x, y: x / 2, zoom: z0 };
          const before = { x: (sx - cam.x) / cam.zoom, y: (sx - cam.y) / cam.zoom };
          const next = zoomAt(cam, sx, sx, z1);
          expect(next.zoom).toBe(z1);
          expect((sx - next.x) / next.zoom).toBeCloseTo(before.x, 6);
          expect((sx - next.y) / next.zoom).toBeCloseTo(before.y, 6);
        },
      ),
    );
  });

  it("cameraAnchored places the world point on the screen point", () => {
    const cam = cameraAnchored({ x: 400, y: 300 }, { x: 64, y: 32 }, 3);
    expect(cam.x + 64 * 3).toBe(400);
    expect(cam.y + 32 * 3).toBe(300);
  });

  it("clamps zoom to [0.1, 32]", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(2)).toBe(2);
  });

  it("quantizes so one tile is a whole number of device pixels", () => {
    for (const res of [1, 1.25, 1.5, 1.75, 2]) {
      for (let z = 0.25; z <= 32; z *= 1.07) {
        const q = quantizeZoom(z, 32, res);
        const device = 32 * q * res;
        if (device >= 8) expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-9);
        expect(Math.abs(q - z) * 32 * res).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
    // 100 % at 125 % Windows scaling: 40 device px per tile, unchanged.
    expect(quantizeZoom(1, 32, 1.25)).toBe(1);
    // tiny tiles stay continuous
    expect(quantizeZoom(0.11, 32, 1)).toBe(0.11);
  });

  it("eases toward the target monotonically and reaches it", () => {
    let z = 1;
    let prev = z;
    for (let i = 0; i < 100 && z !== 4; i++) {
      z = easeZoom(z, 4, 16, 55);
      expect(z).toBeGreaterThanOrEqual(prev);
      expect(z).toBeLessThanOrEqual(4);
      prev = z;
    }
    expect(z).toBe(4);
    expect(easeZoom(2, 1, 16, 55)).toBeLessThan(2);
  });

  it("wheel factors: a mouse notch is ~1.25×, opposite deltas cancel, pinch is clamped", () => {
    expect(wheelZoomFactor(-100, false)).toBeCloseTo(1.25, 1);
    expect(wheelZoomFactor(100, false) * wheelZoomFactor(-100, false)).toBeCloseTo(1, 10);
    expect(wheelZoomFactor(-10000, true)).toBeCloseTo(Math.exp(0.5), 10);
    expect(wheelDeltaPixels(3, 1)).toBe(48);
    expect(wheelDeltaPixels(1, 2)).toBe(800);
    expect(wheelDeltaPixels(7, 0)).toBe(7);
  });

  it("steps through zoom levels", () => {
    expect(nextZoomStep(1, 1)).toBe(1.5);
    expect(nextZoomStep(1, -1)).toBeCloseTo(2 / 3);
    expect(nextZoomStep(1.2, 1)).toBe(1.5);
    expect(nextZoomStep(1.2, -1)).toBe(1);
    expect(nextZoomStep(32, 1)).toBe(MAX_ZOOM);
    expect(nextZoomStep(0.1, -1)).toBe(MIN_ZOOM);
    for (let i = 1; i < ZOOM_STEPS.length; i++) expect(ZOOM_STEPS[i]!).toBeGreaterThan(ZOOM_STEPS[i - 1]!);
  });

  it("fits the map with a zoom step and centers it", () => {
    // 100×80 map of 32 px = 3200×2560 px in a 1200×800 view → largest step ≤ 0.275 is 0.25
    const z = fitZoom(1200, 800, 3200, 2560, 48);
    expect(z).toBe(0.25);
    const cam = centeredCamera(1200, 800, 3200, 2560, z);
    expect(cam.x + (3200 * z) / 2).toBe(600);
    expect(cam.y + (2560 * z) / 2).toBe(400);
    // small map: capped at 4×
    expect(fitZoom(1200, 800, 64, 64, 48)).toBe(4);
  });
});

describe("frameCamera", () => {
  const corner = { width: 226, height: 176 };
  const clearOf = (c: { x: number; y: number; zoom: number }, mw: number, mh: number, vw: number, vh: number) =>
    c.x + mw * c.zoom <= vw - corner.width || c.y + mh * c.zoom <= vh - corner.height;

  it("centres in the whole view when the corner box is already clear", () => {
    const cam = frameCamera(1200, 800, 320, 320, 48, corner);
    expect(cam).toEqual(centeredCamera(1200, 800, 320, 320, fitZoom(1200, 800, 320, 320, 48)));
  });

  it("moves a map that would run under the box beside or above it", () => {
    // Square map: centred it would reach under the minimap; fits left of it at the same zoom.
    expect(clearOf(centeredCamera(1000, 800, 2048, 2048, 1 / 3), 2048, 2048, 1000, 800)).toBe(false);
    const cam = frameCamera(1000, 800, 2048, 2048, 48, corner);
    expect(cam.zoom).toBe(1 / 3);
    expect(clearOf(cam, 2048, 2048, 1000, 800)).toBe(true);
    expect(cam.y + (2048 * cam.zoom) / 2).toBe(400);
    // Very wide map: above the minimap.
    const wide = frameCamera(1200, 800, 4096, 512, 48, corner);
    expect(clearOf(wide, 4096, 512, 1200, 800)).toBe(true);
    expect(wide.x + (4096 * wide.zoom) / 2).toBe(600);
  });

  it("keeps the map clear of the box for any view and map size", () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 3000 }), fc.integer({ min: 400, max: 2000 }), fc.integer({ min: 1, max: 1024 }), fc.integer({ min: 1, max: 1024 }), (vw, vh, w, h) => {
        const cam = frameCamera(vw, vh, w * 32, h * 32, 48, corner);
        // Clear of the box, unless the map cannot get any smaller (smallest zoom).
        return clearOf(cam, w * 32, h * 32, vw, vh) || cam.zoom <= MIN_ZOOM;
      }),
    );
  });

  it("without a box it is the plain centred fit", () => {
    expect(frameCamera(1200, 800, 3200, 2560, 48, null)).toEqual(centeredCamera(1200, 800, 3200, 2560, 0.25));
  });
});

describe("visibleCells", () => {
  it("clips to the map and covers partly visible cells", () => {
    const r = visibleCells({ x: -16, y: 0, zoom: 1 }, 100, 50, 32, 32, 10, 10, 1);
    expect(r).toEqual({ x0: 0, y0: 0, x1: 4, y1: 2 });
    const off = visibleCells({ x: 5000, y: 0, zoom: 1 }, 100, 50, 32, 32, 10, 10, 1);
    expect(off.x1).toBeLessThanOrEqual(off.x0);
  });
});
