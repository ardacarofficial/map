import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PATTERN_SCALE, patternImage, patternMark } from "./gridRaster";
import {
  blockedReason,
  cursorFor,
  dashSpans,
  isEmptyGridPick,
  moveOffset,
  movedRegion,
  nudgeOffset,
  rightPressAction,
  rightReleaseAction,
  toolForLayer,
  type LayerState,
} from "./tools";

const tile: LayerState = { kind: "tile", visible: true, locked: false };
const grid: LayerState = { ...tile, kind: "grid" };
const entity: LayerState = { ...tile, kind: "entity" };

describe("blockedReason", () => {
  it("paint tools explain locked / hidden / wrong-kind layers", () => {
    for (const tool of ["brush", "eraser", "fill", "rect"] as const) {
      expect(blockedReason(tool, tile)).toBeNull();
      expect(blockedReason(tool, grid)).toBeNull();
      expect(blockedReason(tool, { ...tile, locked: true })).toBe("locked");
      expect(blockedReason(tool, { ...tile, visible: false })).toBe("hidden");
      expect(blockedReason(tool, entity)).toBe("wrongKind");
    }
    // Locked wins over hidden (the explicit choice).
    expect(blockedReason("brush", { ...tile, locked: true, visible: false })).toBe("locked");
  });

  it("a saved stamp maps its own layers: never blocked", () => {
    expect(blockedReason("brush", { ...tile, locked: true }, true)).toBeNull();
    expect(blockedReason("brush", entity, true)).toBeNull();
    expect(blockedReason("eraser", entity, true)).toBe("wrongKind");
  });

  it("entity tool needs a visible entity layer (locked is left to the entity action)", () => {
    expect(blockedReason("entity", tile)).toBe("wrongKind");
    expect(blockedReason("entity", grid)).toBe("wrongKind");
    expect(blockedReason("entity", entity)).toBeNull();
    expect(blockedReason("entity", { ...entity, visible: false })).toBe("hidden");
    expect(blockedReason("entity", { ...entity, locked: true })).toBeNull();
  });

  it("select / eyedropper / hand never block; move needs a visible unlocked layer of any kind", () => {
    for (const tool of ["select", "eyedropper", "hand"] as const) expect(blockedReason(tool, { ...tile, locked: true })).toBeNull();
    expect(blockedReason("move", tile)).toBeNull();
    expect(blockedReason("move", entity)).toBeNull();
    expect(blockedReason("move", { ...grid, locked: true })).toBe("locked");
    expect(blockedReason("move", { ...grid, visible: false })).toBe("hidden");
    expect(blockedReason("brush", null)).toBeNull();
  });
});

describe("right click", () => {
  it("entity layers never pick tiles; entities ask for their menu", () => {
    expect(rightPressAction({ layer: "entity", tool: "brush", inRegion: false, entityHit: true })).toBe("entityMenu");
    expect(rightPressAction({ layer: "entity", tool: "select", inRegion: true, entityHit: false })).toBe("none");
  });

  it("select tool inside the selection: menu on click, pick on drag", () => {
    const press = rightPressAction({ layer: "tile", tool: "select", inRegion: true, entityHit: false });
    expect(press).toBe("selectionMenu");
    expect(rightReleaseAction(press, false)).toBe("selectionMenu");
    expect(rightReleaseAction(press, true)).toBe("pick");
    expect(rightReleaseAction("entityMenu", true)).toBe("none");
    expect(rightPressAction({ layer: "tile", tool: "select", inRegion: false, entityHit: false })).toBe("pick");
    expect(rightPressAction({ layer: "grid", tool: "brush", inRegion: true, entityHit: false })).toBe("pick");
    expect(rightPressAction({ layer: null, tool: "brush", inRegion: false, entityHit: false })).toBe("pick");
  });

  it("an empty grid cell picks nothing; values and areas do", () => {
    const at = (x: number) => (x === 1 ? 2 : 0);
    expect(isEmptyGridPick({ x: 0, y: 0, width: 1, height: 1 }, at)).toBe(true);
    expect(isEmptyGridPick({ x: 1, y: 0, width: 1, height: 1 }, at)).toBe(false);
    expect(isEmptyGridPick({ x: 0, y: 0, width: 2, height: 1 }, at)).toBe(false);
  });
});

describe("selection move", () => {
  const map = { width: 10, height: 8 };
  const r = { x: 2, y: 2, width: 3, height: 2 };

  it("moves and clips the region to the map", () => {
    expect(movedRegion(r, 1, 1, map)).toEqual({ x: 3, y: 3, width: 3, height: 2 });
    expect(movedRegion(r, -4, 0, map)).toEqual({ x: 0, y: 2, width: 1, height: 2 });
    expect(movedRegion(r, 20, 0, map)).toBeNull();
  });

  it("offset follows the pointer but keeps the whole region on the map", () => {
    expect(moveOffset(r, { x: 3, y: 2 }, { x: 5, y: 4 }, map)).toEqual({ x: 2, y: 2 });
    expect(moveOffset(r, { x: 3, y: 2 }, { x: -20, y: 40 }, map)).toEqual({ x: -2, y: 4 });
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }), (px, py) => {
        const off = moveOffset(r, { x: 3, y: 3 }, { x: px, y: py }, map);
        expect(movedRegion(r, off.x, off.y, map)).toEqual({ ...r, x: r.x + off.x, y: r.y + off.y });
        // Inside the allowed range the offset is exactly the pointer delta.
        if (px - 3 >= -2 && px - 3 <= 5) expect(off.x).toBe(px - 3);
      }),
    );
  });

  it("arrow keys nudge 1 cell, Shift 10", () => {
    expect(nudgeOffset("ArrowLeft", false)).toEqual({ x: -1, y: 0 });
    expect(nudgeOffset("ArrowDown", true)).toEqual({ x: 0, y: 10 });
    expect(nudgeOffset("a", false)).toBeNull();
  });
});

describe("marching ants", () => {
  it("dashes cover half of the outline and march with the phase", () => {
    const total = (spans: [number, number][]) => spans.reduce((n, [a, b]) => n + (b - a), 0);
    expect(dashSpans(40, 4, 4, 0)).toEqual([[0, 4], [8, 12], [16, 20], [24, 28], [32, 36]]);
    expect(dashSpans(40, 4, 4, 2)[0]).toEqual([2, 6]);
    expect(dashSpans(40, 4, 4, 6)[0]).toEqual([0, 2]);
    expect(total(dashSpans(40, 4, 4, 3))).toBe(20);
    expect(dashSpans(0, 4, 4, 0)).toEqual([]);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.integer({ min: -100, max: 100 }), (p, phase) => {
        for (const [a, b] of dashSpans(p, 4, 4, phase)) {
          expect(a).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(p);
          expect(b).toBeGreaterThan(a);
        }
      }),
    );
  });
});

describe("tool ↔ layer and cursors", () => {
  it("swaps tools that cannot work on the new layer", () => {
    expect(toolForLayer("brush", true)).toBe("entity");
    expect(toolForLayer("fill", true)).toBe("entity");
    expect(toolForLayer("select", true)).toBe("select");
    expect(toolForLayer("hand", true)).toBe("hand");
    expect(toolForLayer("entity", false)).toBe("brush");
    expect(toolForLayer("eraser", false)).toBe("eraser");
  });

  it("hand tool grabs; select over the selection shows move", () => {
    const base = { panning: false, spaceDown: false, hasMap: true, overMap: true, editable: true } as const;
    expect(cursorFor({ ...base, tool: "hand" })).toBe("grab");
    expect(cursorFor({ ...base, tool: "hand", panning: true })).toBe("grabbing");
    expect(cursorFor({ ...base, tool: "hand", hasMap: false })).toBe("grab");
    expect(cursorFor({ ...base, tool: "select", region: "over" })).toBe("move");
    expect(cursorFor({ ...base, tool: "select", region: "moving" })).toBe("grabbing");
    expect(cursorFor({ ...base, tool: "select" })).toBe("crosshair");
  });
});

describe("collision patterns", () => {
  it("hatch / cross / dots marks run on seamlessly across cells", () => {
    expect(patternMark("/", 0, 0)).toBe(true);
    expect(patternMark("/", 1, 3)).toBe(true);
    expect(patternMark("/", 1, 0)).toBe(false);
    expect(patternMark("x", 9, 1)).toBe(true); // back diagonal
    expect(patternMark("x", 3, 1)).toBe(false); // sparser than the single hatch
    expect(patternMark("dots", 1, 1)).toBe(true);
    expect(patternMark("dots", 0, 1)).toBe(false);
    expect(patternMark("/", -1, 1)).toBe(true);
    // Cell boundary: the stripe at the right edge of a cell continues in the next one.
    expect(patternMark("/", PATTERN_SCALE - 1, 1)).toBe(patternMark("/", PATTERN_SCALE + 3, -3));
  });

  it("draws only coded cells, at PATTERN_SCALE px per cell", () => {
    const raster = new Uint8Array(32 * 32);
    expect(patternImage(raster, [null, { color: 0xff0000, fillAlpha: 0.2, markAlpha: 0.8, kind: "/" }], 0, 0)).toBeNull();
    raster[0] = 1;
    const img = patternImage(raster, [null, { color: 0xff0000, fillAlpha: 0.2, markAlpha: 0.8, kind: "/" }], 0, 0)!;
    const side = 32 * PATTERN_SCALE;
    expect(img.length).toBe(side * side * 4);
    expect(Array.from(img.subarray(0, 4))).toEqual([255, 0, 0, 204]); // (0,0) is on the hatch
    expect(img[(1 * side + 1) * 4 + 3]).toBe(51); // (1,1): fill
    expect(img[(0 * side + PATTERN_SCALE) * 4 + 3]).toBe(0); // next cell: empty
  });
});
