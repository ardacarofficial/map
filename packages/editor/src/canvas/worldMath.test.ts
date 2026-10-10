import { describe, expect, it } from "vitest";

import { CameraController } from "./cameraController";
import {
  arrowHead,
  dragLevelPosition,
  ellipsize,
  exceedsDragThreshold,
  gridSpacing,
  hitTestLevels,
  linkEndpoints,
  snapWorldPosition,
  worldBounds,
  type WorldLevelBox,
} from "./worldMath";

const box = (id: string, x: number, y: number, width = 100, height = 50): WorldLevelBox => ({ id, x, y, width, height });

describe("snapWorldPosition", () => {
  it("rounds to the nearest multiple of the snap size per axis", () => {
    expect(snapWorldPosition({ x: 47, y: 15 }, 32, 16)).toEqual({ x: 32, y: 16 });
    expect(snapWorldPosition({ x: 48, y: 25 }, 32, 16)).toEqual({ x: 64, y: 32 });
    expect(snapWorldPosition({ x: -47, y: -9 }, 32, 16)).toEqual({ x: -32, y: -16 });
  });
  it("never yields -0", () => {
    const p = snapWorldPosition({ x: -3, y: -0.2 }, 32, 32);
    expect(Object.is(p.x, -0)).toBe(false);
    expect(Object.is(p.y, -0)).toBe(false);
  });
  it("rounds to whole pixels without snapping (Alt) or with a bad snap size", () => {
    expect(snapWorldPosition({ x: 47.4, y: 15.6 }, 32, 32, false)).toEqual({ x: 47, y: 16 });
    expect(snapWorldPosition({ x: 47.4, y: 15.6 }, 0, -1)).toEqual({ x: 47, y: 16 });
  });
});

describe("dragLevelPosition", () => {
  it("moves the origin by the pointer delta, then snaps", () => {
    const origin = { x: 64, y: 32 };
    expect(dragLevelPosition(origin, { x: 10, y: 10 }, { x: 50, y: 10 }, 32, 32)).toEqual({ x: 96, y: 32 });
    expect(dragLevelPosition(origin, { x: 10, y: 10 }, { x: 20, y: 30 }, 32, 32)).toEqual({ x: 64, y: 64 });
    expect(dragLevelPosition(origin, { x: 10, y: 10 }, { x: 20, y: 30 }, 32, 32, false)).toEqual({ x: 74, y: 52 });
  });
  it("a tiny move snaps back to the origin", () => {
    expect(dragLevelPosition({ x: 64, y: 32 }, { x: 0, y: 0 }, { x: 5, y: -5 }, 32, 32)).toEqual({ x: 64, y: 32 });
  });
});

describe("exceedsDragThreshold", () => {
  it("is false within the threshold and true beyond it", () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 4, y: 1 })).toBe(true);
  });
});

describe("hitTestLevels", () => {
  const boxes = [box("a", 0, 0), box("b", 50, 25), box("c", 500, 500)];
  it("returns the top-most (last) box under the point", () => {
    expect(hitTestLevels(boxes, { x: 10, y: 10 })?.id).toBe("a");
    expect(hitTestLevels(boxes, { x: 60, y: 30 })?.id).toBe("b");
    expect(hitTestLevels(boxes, { x: 300, y: 300 })).toBeNull();
  });
  it("uses half-open edges", () => {
    expect(hitTestLevels([box("a", 0, 0)], { x: 100, y: 10 })).toBeNull();
    expect(hitTestLevels([box("a", 0, 0)], { x: 99.9, y: 49.9 })?.id).toBe("a");
  });
  it("counts the label strip above a box", () => {
    expect(hitTestLevels(boxes, { x: 510, y: 490 })).toBeNull();
    expect(hitTestLevels(boxes, { x: 510, y: 490 }, 18)?.id).toBe("c");
    expect(hitTestLevels(boxes, { x: 510, y: 483 }, 18)?.id).toBe("c");
    expect(hitTestLevels(boxes, { x: 510, y: 483 }, 10)).toBeNull();
  });
});

describe("worldBounds", () => {
  it("is null without boxes and spans all boxes otherwise", () => {
    expect(worldBounds([])).toBeNull();
    expect(worldBounds([box("a", -10, 20), box("b", 200, -40, 10, 10)])).toEqual({ x: -10, y: -40, width: 220, height: 110 });
  });
});

describe("linkEndpoints", () => {
  const boxes = new Map([
    ["a", box("a", 100, 100)],
    ["b", box("b", 1000, 0, 200, 80)],
  ]);
  it("offsets the portal and target point by their levels' positions", () => {
    expect(linkEndpoints({ fromLevelId: "a", from: { x: 16, y: 8 }, toLevelId: "b", to: { x: 32, y: 64 } }, boxes)).toEqual({
      from: { x: 116, y: 108 },
      to: { x: 1032, y: 64 },
    });
  });
  it("points at the target level's centre when the point is not set", () => {
    expect(linkEndpoints({ fromLevelId: "a", from: { x: 0, y: 0 }, toLevelId: "b", to: null }, boxes)?.to).toEqual({ x: 1100, y: 40 });
  });
  it("is null when a level is not on the map", () => {
    expect(linkEndpoints({ fromLevelId: "a", from: { x: 0, y: 0 }, toLevelId: "gone", to: null }, boxes)).toBeNull();
    expect(linkEndpoints({ fromLevelId: "gone", from: { x: 0, y: 0 }, toLevelId: "a", to: null }, boxes)).toBeNull();
  });
});

describe("arrowHead", () => {
  it("puts the tip at the end and the base behind it, symmetric", () => {
    const head = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 4)!;
    expect(head[0]).toEqual({ x: 100, y: 0 });
    expect(head[1].x).toBeCloseTo(90);
    expect(head[2].x).toBeCloseTo(90);
    expect(Math.abs(head[1].y)).toBeCloseTo(4);
    expect(head[1].y).toBeCloseTo(-head[2].y);
  });
  it("follows the direction", () => {
    const head = arrowHead({ x: 0, y: 0 }, { x: 0, y: -50 }, 10, 4)!;
    expect(head[1].y).toBeCloseTo(-40);
    expect(head[2].y).toBeCloseTo(-40);
  });
  it("is null for a zero-length segment", () => {
    expect(arrowHead({ x: 5, y: 5 }, { x: 5, y: 5 }, 10, 4)).toBeNull();
  });
});

describe("gridSpacing", () => {
  it("doubles the snap size until a cell is wide enough on screen", () => {
    expect(gridSpacing(32, 1, 16)).toBe(32);
    expect(gridSpacing(32, 0.25, 16)).toBe(64);
    expect(gridSpacing(32, 0.01, 16)).toBe(2048);
    expect(gridSpacing(0, 1, 16)).toBe(32);
  });
});

describe("ellipsize", () => {
  const measure = (s: string) => s.length * 10;
  it("keeps text that fits", () => {
    expect(ellipsize("Zindan", 60, measure)).toBe("Zindan");
  });
  it("cuts with an ellipsis to fit", () => {
    const out = ellipsize("Kuzey Ormanı", 60, measure);
    expect(out.endsWith("…")).toBe(true);
    expect(measure(out)).toBeLessThanOrEqual(60);
    expect(out).toBe("Kuzey…");
  });
  it("is empty when not even the ellipsis fits", () => {
    expect(ellipsize("Zindan", 5, measure)).toBe("");
  });
});

describe("CameraController world framing", () => {
  it("frames a world rectangle when frameBounds is set (zoom ≤ 1, centred)", () => {
    const cam = new CameraController(() => undefined, () => {});
    cam.resize(800, 600, 1);
    cam.setZoomLimits(0.002, 2);
    cam.frameBounds = () => ({ x: 1000, y: -500, width: 7040, height: 3040 });
    cam.frameMap();
    const z = cam.camera.zoom;
    expect(z).toBeCloseTo((800 - 96) / 7040);
    // Rect centre lands at the view centre.
    expect(cam.camera.x + (1000 + 3520) * z).toBeCloseTo(400);
    expect(cam.camera.y + (-500 + 1520) * z).toBeCloseTo(300);
  });
  it("zooms out below the smallest zoom step inside the world limits", () => {
    const cam = new CameraController(() => undefined, () => {});
    cam.resize(800, 600, 1);
    cam.setZoomLimits(0.002, 2);
    cam.setZoom(0.1, { x: 400, y: 300 });
    cam.zoomStep(-1);
    expect(cam.zoomTarget).toBeLessThan(0.1);
    cam.setZoomLimits(0.1, 32);
    expect(cam.zoomLevel).toBeGreaterThanOrEqual(0.1);
  });
});

describe("CameraController level view memory", () => {
  const map = { width: 64, height: 48, tileWidth: 32, tileHeight: 32 };
  it("remembers nothing for the untouched opening view", () => {
    const cam = new CameraController(() => map, () => {});
    cam.resize(800, 600, 1);
    cam.initialView();
    expect(cam.savedView()).toBeNull();
  });
  it("remembers a fitted view (Sığdır), which differs from the opening view", () => {
    const cam = new CameraController(() => map, () => {});
    cam.resize(800, 600, 1);
    cam.initialView();
    const opening = cam.camera.zoom;
    cam.frameMap();
    const view = cam.savedView();
    expect(view).not.toBeNull();
    expect(view!.zoom).toBe(cam.camera.zoom);
    expect(view!.zoom).not.toBe(opening);
  });
  it("restores zoom and centre, also in another view size", () => {
    const cam = new CameraController(() => map, () => {});
    cam.resize(800, 600, 1);
    cam.initialView();
    cam.setZoom(2, { x: 400, y: 300 });
    cam.panBy(-120, 40);
    const view = cam.savedView()!;
    expect(view.zoom).toBe(2);
    const other = new CameraController(() => map, () => {});
    other.resize(1000, 700, 1);
    other.restoreView(view);
    expect(other.camera.zoom).toBe(2);
    expect((500 - other.camera.x) / 2).toBeCloseTo(view.cx);
    expect((350 - other.camera.y) / 2).toBeCloseTo(view.cy);
  });
});
