import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  LOD_ENTER_CELL_DEVICE_PX,
  LOD_EXIT_CELL_DEVICE_PX,
  THUMB_MAX_PX,
  cameraCenteredOn,
  chunkSpan,
  minimapLayout,
  minimapToWorld,
  nextLod,
  thumbnailScale,
  viewportRect,
} from "./minimapMath";

describe("thumbnailScale", () => {
  it("is an integer 1..4 px per cell while the map fits", () => {
    expect(thumbnailScale(64, 64)).toBe(4);
    expect(thumbnailScale(1500, 200)).toBe(2);
    expect(thumbnailScale(4096, 10)).toBe(1);
  });

  it("is a fraction for huge maps, keeping the longest side at the cap", () => {
    expect(thumbnailScale(65536, 100) * 65536).toBeCloseTo(THUMB_MAX_PX);
  });

  it("chunk spans tile the thumbnail without gaps or overlaps", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20000 }), (w) => {
        const s = thumbnailScale(w, 1);
        const chunks = Math.ceil(w / 32);
        let prev = 0;
        for (let c = 0; c < chunks; c++) {
          const span = chunkSpan(c, 32, s, w);
          if (span.from !== prev || span.to < span.from) return false;
          prev = span.to;
        }
        return prev === Math.round(w * s);
      }),
    );
  });
});

describe("minimap layout / viewport", () => {
  it("fits the map keeping its aspect", () => {
    expect(minimapLayout(2000, 1000, 200, 150)).toEqual({ width: 200, height: 100, scale: 0.1 });
    expect(minimapLayout(1000, 2000, 200, 150)).toEqual({ width: 75, height: 150, scale: 0.075 });
    expect(minimapLayout(0, 10, 200, 150).width).toBe(0);
  });

  it("viewport is the visible map part, clipped", () => {
    const layout = minimapLayout(2000, 1000, 200, 150); // scale 0.1
    // zoom 1, map origin at screen (-500, -200), view 800×600 → map px 500..1300 × 200..800
    expect(viewportRect({ x: -500, y: -200, zoom: 1 }, 800, 600, layout)).toEqual({ x: 50, y: 20, width: 80, height: 60 });
    // zoom 2 halves the visible map area
    const r = viewportRect({ x: -1000, y: -400, zoom: 2 }, 800, 600, layout);
    expect(r.x).toBeCloseTo(50);
    expect(r.width).toBeCloseTo(40);
    // whole map in view → whole minimap
    expect(viewportRect({ x: 100, y: 100, zoom: 0.1 }, 800, 600, layout)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    // view off the map → empty
    expect(viewportRect({ x: 5000, y: 0, zoom: 1 }, 800, 600, layout).width).toBe(0);
  });

  it("minimap clicks map back to world px; centering puts that point mid-view", () => {
    const layout = minimapLayout(2000, 1000, 200, 150);
    const w = minimapToWorld(130, 40, layout, 2000, 1000);
    expect(w).toEqual({ x: 1300, y: 400 });
    expect(minimapToWorld(-5, 999, layout, 2000, 1000)).toEqual({ x: 0, y: 1000 });
    const cam = cameraCenteredOn(w.x, w.y, 2, 800, 600);
    expect(w.x * cam.zoom + cam.x).toBe(400);
    expect(w.y * cam.zoom + cam.y).toBe(300);
    // the viewport rect is then centred on the click
    const vr = viewportRect(cam, 800, 600, layout);
    expect(vr.x + vr.width / 2).toBeCloseTo(130);
    expect(vr.y + vr.height / 2).toBeCloseTo(40);
  });
});

describe("LOD hysteresis", () => {
  it("enters below the enter threshold and leaves only above the exit threshold", () => {
    expect(nextLod(false, LOD_ENTER_CELL_DEVICE_PX)).toBe(false);
    expect(nextLod(false, LOD_ENTER_CELL_DEVICE_PX - 0.01)).toBe(true);
    expect(nextLod(true, LOD_ENTER_CELL_DEVICE_PX + 0.2)).toBe(true);
    expect(nextLod(true, LOD_EXIT_CELL_DEVICE_PX - 0.01)).toBe(true);
    expect(nextLod(true, LOD_EXIT_CELL_DEVICE_PX)).toBe(false);
  });

  it("never flickers while the size wiggles inside the band", () => {
    let lod = nextLod(false, 1.5);
    for (let i = 0; i < 50; i++) {
      lod = nextLod(lod, 2.2 + Math.sin(i) * 0.25);
      expect(lod).toBe(true);
    }
  });
});
