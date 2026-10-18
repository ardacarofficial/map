import { FLIP_H, FLIP_V, makeCell, type TileClip } from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { cellMaskImage, membershipMask } from "./cellMask";
import { buildCellQuads } from "./chunkGeometry";
import {
  EYEDROPPER_CURSOR,
  cursorFor,
  decidePick,
  dragRegion,
  isEditable,
  mod,
  patternCell,
  patternLayerIndex,
  pickLayer,
  rectPreviewCells,
  regionContains,
  snapToStampGrid,
  stampMapping,
  stampOrigins,
  stampPreviewCells,
  type LayerInfo,
} from "./tools";

function layer(id: string, cells: Record<string, number> = {}, props: Partial<LayerInfo> = {}): LayerInfo {
  return { id, visible: true, locked: false, grid: false, getCell: (x, y) => cells[`${x},${y}`] ?? 0, ...props };
}

/** 2×2 clip, one layer "a": tiles 1 2 / 3 0 (palette = tileIds 10, 11, 12). */
function clip2x2(layers: { id: string; grid?: boolean }[] = [{ id: "a" }]): TileClip {
  return {
    width: 2,
    height: 2,
    palette: [
      { tilesetId: "t", tileId: 10 },
      { tilesetId: "t", tileId: 11 },
      { tilesetId: "t", tileId: 12 },
    ],
    layers: layers.map((l) => ({
      layerId: l.id,
      name: l.id,
      ...(l.grid ? { grid: true } : {}),
      cells: Uint32Array.from([makeCell(1), makeCell(2, FLIP_H), makeCell(3), 0]),
    })),
  };
}

describe("mod / regions", () => {
  it("mod is non-negative", () => {
    expect(mod(-1, 3)).toBe(2);
    expect(mod(-3, 3)).toBe(0);
    expect(mod(4, 3)).toBe(1);
  });

  it("dragRegion normalizes any corner order and clamps to the map", () => {
    const bounds = { width: 10, height: 8 };
    expect(dragRegion({ x: 5, y: 6 }, { x: 2, y: 1 }, bounds)).toEqual({ x: 2, y: 1, width: 4, height: 6 });
    expect(dragRegion({ x: -3, y: -3 }, { x: 20, y: 2 }, bounds)).toEqual({ x: 0, y: 0, width: 10, height: 3 });
    expect(dragRegion({ x: -3, y: 0 }, { x: -1, y: 2 }, bounds)).toBeNull();
  });

  it("dragRegion always lies inside the map and contains clamped corners", () => {
    const pt = fc.record({ x: fc.integer({ min: -20, max: 40 }), y: fc.integer({ min: -20, max: 40 }) });
    fc.assert(
      fc.property(pt, pt, (a, b) => {
        const r = dragRegion(a, b, { width: 16, height: 12 });
        if (!r) return;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(16);
        expect(r.y + r.height).toBeLessThanOrEqual(12);
        const clamp = (p: { x: number; y: number }) => ({ x: Math.min(15, Math.max(0, p.x)), y: Math.min(11, Math.max(0, p.y)) });
        expect(regionContains(r, clamp(a))).toBe(true);
        expect(regionContains(r, clamp(b))).toBe(true);
      }),
    );
  });

  it("regionContains", () => {
    const r = { x: 1, y: 1, width: 2, height: 2 };
    expect(regionContains(r, { x: 2, y: 2 })).toBe(true);
    expect(regionContains(r, { x: 3, y: 2 })).toBe(false);
    expect(regionContains(null, { x: 0, y: 0 })).toBe(false);
  });
});

describe("layers and picking", () => {
  it("isEditable excludes hidden, locked and grid layers", () => {
    expect(isEditable(layer("a"))).toBe(true);
    expect(isEditable(layer("a", {}, { visible: false }))).toBe(false);
    expect(isEditable(layer("a", {}, { locked: true }))).toBe(false);
    expect(isEditable(layer("a", {}, { grid: true }))).toBe(false);
    expect(isEditable(undefined)).toBe(false);
  });

  it("pickLayer defaults to the topmost visible tile layer", () => {
    const bottom = layer("bottom", { "1,1": 5 });
    const top = layer("top", { "1,1": 6 });
    const hidden = layer("hidden", { "1,1": 7 }, { visible: false });
    const grid = layer("grid", { "1,1": 1 }, { grid: true });
    const layers = [bottom, top, hidden, grid];
    expect(pickLayer(layers, "bottom", 1, 1)?.id).toBe("top");
    expect(pickLayer(layers, "empty", 1, 1)?.id).toBe("top");
    expect(pickLayer(layers, "hidden", 1, 1)?.id).toBe("top");
    expect(pickLayer(layers, "bottom", 0, 0)).toBeNull();
  });

  const palette = (i: number) => (i === 5 ? { tilesetId: "t", tileId: 50 } : undefined);

  it("a plain cell picks its tile", () => {
    const l = layer("a", { "2,3": makeCell(5) });
    expect(decidePick([l], "a", { x: 2, y: 3, width: 1, height: 1 }, palette)).toEqual({
      kind: "tile",
      layerId: "a",
      entry: { tilesetId: "t", tileId: 50 },
    });
  });

  it("a flipped cell picks a 1×1 clip of the layer it was found on", () => {
    const l = layer("a", { "2,3": makeCell(5, FLIP_V) });
    expect(decidePick([l, layer("b")], "b", { x: 2, y: 3, width: 1, height: 1 }, palette)).toEqual({
      kind: "clip",
      layerId: "a",
      region: { x: 2, y: 3, width: 1, height: 1 },
    });
  });

  it("an empty cell picks nothing", () => {
    expect(decidePick([layer("a")], "a", { x: 0, y: 0, width: 1, height: 1 }, palette)).toEqual({ kind: "none" });
  });

  it("an area clips the active layer only, nothing when empty there", () => {
    const a = layer("a", { "1,1": makeCell(5) });
    const b = layer("b");
    const area = { x: 0, y: 0, width: 3, height: 2 };
    expect(decidePick([a, b], "a", area, palette)).toEqual({ kind: "clip", layerId: "a", region: area });
    expect(decidePick([a, b], "b", area, palette)).toEqual({ kind: "none" });
  });
});

describe("stamps", () => {
  it("a one-layer clip maps to the active layer", () => {
    const lookup = (id: string) => ({ act: layer("act"), locked: layer("locked", {}, { locked: true }) })[id];
    expect(stampMapping(clip2x2(), "act", lookup)).toEqual({ a: "act" });
    expect(stampMapping(clip2x2(), "locked", lookup)).toEqual({});
    expect(stampMapping(clip2x2(), null, lookup)).toEqual({});
  });

  it("a multi-layer clip maps to same-id layers, skipping unusable ones", () => {
    const clip = clip2x2([{ id: "ground" }, { id: "walls" }, { id: "roof" }]);
    const layers: Record<string, LayerInfo> = {
      ground: layer("ground"),
      walls: layer("walls", {}, { visible: false }),
      act: layer("act"),
    };
    expect(stampMapping(clip, "act", (id) => layers[id])).toEqual({ ground: "ground" });
  });

  it("a multi-layer clip from another document puts its first layer on the active layer", () => {
    const clip = clip2x2([{ id: "x" }, { id: "y" }]);
    expect(stampMapping(clip, "act", (id) => (id === "act" ? layer("act") : undefined))).toEqual({ x: "act" });
  });

  it("grid clip layers only map to grid layers", () => {
    const clip = clip2x2([{ id: "g", grid: true }]);
    expect(stampMapping(clip, "act", () => layer("act"))).toEqual({});
    expect(stampMapping(clip, "act", () => layer("act", {}, { grid: true }))).toEqual({ g: "act" });
  });

  it("patternLayerIndex picks the clip layer for the active layer, else the first tile layer", () => {
    const clip = clip2x2([{ id: "g", grid: true }, { id: "a" }, { id: "b" }]);
    expect(patternLayerIndex(clip, { b: "act" }, "act")).toBe(2);
    expect(patternLayerIndex(clip, {}, "act")).toBe(1);
  });

  it("patternCell tiles the clip from the anchor, also leftwards/upwards", () => {
    const clip = clip2x2();
    const at = (x: number, y: number) => patternCell(clip, 0, x, y, 5, 5);
    expect(at(5, 5)).toBe(makeCell(1));
    expect(at(6, 5)).toBe(makeCell(2, FLIP_H));
    expect(at(7, 7)).toBe(makeCell(1));
    expect(at(4, 5)).toBe(makeCell(2, FLIP_H));
    expect(at(4, 4)).toBe(0);
    expect(patternCell(clip, 9, 0, 0)).toBe(0);
  });

  it("stampOrigins places each grid slot once per stroke", () => {
    const placed = new Set<string>();
    const start = { x: 10, y: 10 };
    const first = stampOrigins(start, [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }], 2, 2, placed);
    expect(first).toEqual([{ x: 10, y: 10 }, { x: 12, y: 10 }]);
    expect(stampOrigins(start, [{ x: 13, y: 11 }, { x: 9, y: 9 }], 2, 2, placed)).toEqual([{ x: 8, y: 8 }]);
  });

  it("snapToStampGrid always returns a slot that contains the cell", () => {
    const pt = fc.record({ x: fc.integer({ min: -100, max: 100 }), y: fc.integer({ min: -100, max: 100 }) });
    fc.assert(
      fc.property(pt, pt, fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 9 }), (s, c, w, h) => {
        const o = snapToStampGrid(s, c, w, h);
        expect(mod(o.x - s.x, w)).toBe(0);
        expect(mod(o.y - s.y, h)).toBe(0);
        expect(regionContains({ x: o.x, y: o.y, width: w, height: h }, c)).toBe(true);
      }),
    );
  });

  it("stampPreviewCells lists mapped, non-empty tile cells with flags", () => {
    const clip = clip2x2([{ id: "a" }, { id: "b" }]);
    const cells = stampPreviewCells(clip, { b: "x" });
    expect(cells).toHaveLength(3);
    expect(cells[1]).toEqual({ x: 1, y: 0, entry: { tilesetId: "t", tileId: 11 }, flags: FLIP_H });
  });

  it("rectPreviewCells clips to the view and gives up above the cap", () => {
    const entry = { tilesetId: "t", tileId: 0 };
    const at = () => ({ entry, flags: 0 });
    const region = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectPreviewCells(region, { x: 90, y: 95, width: 50, height: 50 }, 1000, at)).toHaveLength(10 * 5);
    expect(rectPreviewCells(region, { x: 0, y: 0, width: 100, height: 100 }, 1000, at)).toBeNull();
    expect(rectPreviewCells(region, { x: 200, y: 0, width: 10, height: 10 }, 1000, at)).toEqual([]);
  });
});

describe("cursorFor", () => {
  const base = { tool: "brush" as const, panning: false, spaceDown: false, hasMap: true, overMap: true, editable: true };
  it("pan cursors win", () => {
    expect(cursorFor({ ...base, panning: true })).toBe("grabbing");
    expect(cursorFor({ ...base, spaceDown: true })).toBe("grab");
  });
  it("edit tools show not-allowed over the map on a locked/hidden layer", () => {
    expect(cursorFor({ ...base, editable: false })).toBe("not-allowed");
    expect(cursorFor({ ...base, editable: false, overMap: false })).toBe("crosshair");
    expect(cursorFor({ ...base, tool: "select", editable: false })).toBe("crosshair");
  });
  it("per tool", () => {
    expect(cursorFor({ ...base, tool: "fill" })).toBe("cell");
    expect(cursorFor({ ...base, tool: "eyedropper" })).toBe(EYEDROPPER_CURSOR);
    expect(cursorFor({ ...base, hasMap: false })).toBe("default");
  });
});

describe("cellMask", () => {
  it("crops to the bounding box", () => {
    const img = cellMaskImage([{ x: 3, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 6 }])!;
    expect([img.x, img.y, img.width, img.height]).toEqual([3, 4, 3, 3]);
    expect(img.data[3]).toBe(255); // (3,4)
    expect(img.data[7]).toBe(0); // (4,4)
    expect(img.data[(2 * 3 + 1) * 4 + 3]).toBe(255); // (4,6)
    expect(cellMaskImage([])).toBeNull();
  });

  it("membershipMask", () => {
    const m = membershipMask([{ x: 1, y: 2 }], 4, 3);
    expect(m[2 * 4 + 1]).toBe(1);
    expect(m.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("buildCellQuads", () => {
  it("groups by texture and swaps UVs for flips", () => {
    const src = (group: number) => ({ group, u0: 0, v0: 0, u1: 1, v1: 1 });
    const batches = buildCellQuads(
      [
        { x: 2, y: 1, flags: FLIP_H | FLIP_V, src: src(1) },
        { x: 0, y: 0, flags: 0, src: src(0) },
      ],
      16,
      8,
    );
    expect(batches.map((b) => b.group)).toEqual([0, 1]);
    const flipped = batches[1]!;
    expect(Array.from(flipped.positions)).toEqual([32, 8, 48, 8, 48, 16, 32, 16]);
    expect(Array.from(flipped.uvs)).toEqual([1, 1, 0, 1, 0, 0, 1, 0]);
    expect(Array.from(flipped.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });
});

describe("cursorFor (entities)", () => {
  const base = { tool: "entity" as const, panning: false, spaceDown: false, hasMap: true, overMap: true, editable: false };
  it("shows move / grabbing over and while dragging an entity, not-allowed when the entity tool cannot place", () => {
    expect(cursorFor({ ...base, entity: "over" })).toBe("move");
    expect(cursorFor({ ...base, entity: "drag" })).toBe("grabbing");
    expect(cursorFor({ ...base, entity: "blocked" })).toBe("not-allowed");
    expect(cursorFor({ ...base, entity: "blocked", overMap: false })).toBe("crosshair");
    expect(cursorFor({ ...base, entity: null })).toBe("crosshair");
    expect(cursorFor({ ...base, entity: "over", panning: true })).toBe("grabbing");
  });
});
