import { describe, expect, it, vi } from "vitest";

import { CameraController } from "./cameraController";

const map = { width: 64, height: 48, tileWidth: 32, tileHeight: 32 };
const center = (cam: CameraController) => ({
  x: (cam.viewW / 2 - cam.camera.x) / cam.camera.zoom,
  y: (cam.viewH / 2 - cam.camera.y) / cam.camera.zoom,
});

function expectFit(cam: CameraController) {
  expect(cam.camera.x).toBeGreaterThanOrEqual(0);
  expect(cam.camera.y).toBeGreaterThanOrEqual(0);
  expect(cam.camera.x + map.width * 32 * cam.camera.zoom).toBeLessThanOrEqual(cam.viewW);
  expect(cam.camera.y + map.height * 32 * cam.camera.zoom).toBeLessThanOrEqual(cam.viewH);
  expect(center(cam).x).toBeCloseTo(1024);
  expect(center(cam).y).toBeCloseTo(768);
}

describe("opening frame and layout resize", () => {
  it.each([1, 1.25, 1.5, 2])("fits a 64×48 map at device scale %s, below 50 percent", resolution => {
    const cam = new CameraController(() => map, () => {});
    cam.requestInitialView();
    cam.resize(760, 420, resolution);
    expectFit(cam);
    expect(cam.camera.zoom).toBeLessThan(0.5);
    expect(cam.camera.zoom * 32 * resolution).toBeCloseTo(Math.round(cam.camera.zoom * 32 * resolution));
  });

  it("Tab during opening settlement preserves zoom and centre in both directions", () => {
    const cam = new CameraController(() => map, () => {});
    cam.resize(760, 420, 1);
    cam.requestInitialView();
    const before = cam.camera;
    cam.keepView();
    cam.resize(1326, 672, 1);
    expect(cam.camera.zoom).toBe(before.zoom);
    expect(center(cam).x).toBeCloseTo(1024);
  expect(center(cam).y).toBeCloseTo(768);
    cam.resize(760, 420, 1);
    expect(cam.camera).toEqual(before);
  });

  it("only follows the opening layout for 300ms; later resizes preserve a panned view", () => {
    vi.useFakeTimers();
    try {
      const cam = new CameraController(() => map, () => {});
      cam.resize(1000, 700, 1);
      cam.requestInitialView();
      cam.resize(760, 420, 1);
      expectFit(cam);
      vi.advanceTimersByTime(301);
      const zoom = cam.camera.zoom;
      cam.resize(1200, 650, 1);
      expect(cam.camera.zoom).toBe(zoom);
      cam.panBy(27, -41);
      const point = center(cam);
      cam.resize(800, 400, 1);
      expect(cam.camera.zoom).toBe(zoom);
      expect(center(cam)).toEqual(point);
    } finally {
      vi.useRealTimers();
    }
  });

  it("explicit fit remains available but does not follow subsequent resizes", () => {
    const cam = new CameraController(() => map, () => {});
    cam.resize(760, 420, 1);
    cam.setZoom(2, cam.viewCenter());
    cam.requestFrameMap();
    expectFit(cam);
    const zoom = cam.camera.zoom;
    cam.resize(1200, 650, 1);
    expect(cam.camera.zoom).toBe(zoom);
    expect(center(cam).x).toBeCloseTo(1024);
  expect(center(cam).y).toBeCloseTo(768);
  });

  it("opens very large maps below the ordinary zoom floor", () => {
    const cam = new CameraController(() => ({ ...map, width: 1000, height: 1000 }), () => {});
    cam.resize(760, 420, 1);
    expect(cam.camera.zoom).toBeLessThan(0.1);
    expect(cam.camera.x).toBeGreaterThanOrEqual(0);
    expect(cam.camera.y).toBeGreaterThanOrEqual(0);
  });
});

describe("opening frame density", () => {
  it("uses 92 percent of the canvas before snapping down to device pixels", () => {
    const cam = new CameraController(() => map, () => {});
    cam.resize(770, 450, 1);
    cam.requestInitialView();
    const fit = Math.min(770 * 0.92 / 2048, 450 * 0.92 / 1536);
    expect(cam.camera.zoom).toBe(Math.floor(fit * 32) / 32);
    expect(cam.camera.zoom).toBe(0.25);
    expectFit(cam);
  });
});
