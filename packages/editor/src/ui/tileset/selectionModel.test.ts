import { cellPaletteIndex, clipFromTileset, FLIP_H, type TileClip, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import {
  arrowSelect,
  boundsOf,
  brushFor,
  clipSourceIds,
  gestureIds,
  isRectangle,
  outlinePath,
  rectIds,
  startGesture,
} from "./selectionModel";

const ts: Tileset = {
  id: "ow",
  name: "overworld-32",
  imagePath: "tilesets/overworld-32.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 8,
  rows: 8,
  margin: 0,
  spacing: 0,
};
const NONE = new Set<number>();
const c = (col: number, row: number) => ({ col, row });

/** Tile id at clip cell (x, y), or null. */
function tileAt(clip: TileClip, x: number, y: number): number | null {
  const v = clip.layers[0]!.cells[y * clip.width + x]!;
  return v === 0 ? null : clip.palette[cellPaletteIndex(v) - 1]!.tileId;
}

describe("tileset selection gestures", () => {
  it("click selects one tile", () => {
    const g = startGesture(ts, c(4, 1), { ctrl: false, shift: false }, null);
    expect(gestureIds(ts, g, c(4, 1))).toEqual([12]);
    expect(brushFor(ts, [12], NONE)).toEqual({ kind: "tile", tileId: 12 });
  });

  it("drag selects the rectangle in any direction", () => {
    const g = startGesture(ts, c(3, 2), { ctrl: false, shift: false }, { ids: [0], anchor: c(0, 0) });
    expect(gestureIds(ts, g, c(1, 1))).toEqual([9, 10, 11, 17, 18, 19]);
    expect(isRectangle(ts, gestureIds(ts, g, c(1, 1)))).toBe(true);
  });

  it("plain drag from the selected tile replaces it with a 4×4 marquee", () => {
    const gesture = startGesture(ts, c(0, 0), { ctrl: false, shift: false }, { ids: [0], anchor: c(0, 0) });
    expect(gestureIds(ts, gesture, c(3, 3))).toEqual([0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19, 24, 25, 26, 27]);
  });

  it("drag outside the grid is clamped", () => {
    expect(rectIds(ts, c(6, 7), c(20, 20))).toEqual([62, 63]);
  });

  it("a 3×2 drag becomes a clip with the same layout", () => {
    const g = startGesture(ts, c(1, 1), { ctrl: false, shift: false }, null);
    const brush = brushFor(ts, gestureIds(ts, g, c(3, 2)), NONE, "layer-1");
    expect(brush?.kind).toBe("clip");
    if (brush?.kind !== "clip") return;
    expect([brush.clip.width, brush.clip.height]).toEqual([3, 2]);
    expect(brush.clip.layers[0]!.layerId).toBe("layer-1");
    expect([tileAt(brush.clip, 0, 0), tileAt(brush.clip, 2, 0), tileAt(brush.clip, 0, 1), tileAt(brush.clip, 2, 1)]).toEqual([9, 11, 17, 19]);
  });

  it("ctrl toggles cells: adds when the start cell is unselected, removes otherwise", () => {
    const add = startGesture(ts, c(5, 0), { ctrl: true, shift: false }, { ids: [0, 1], anchor: c(0, 0) });
    expect(add).toMatchObject({ kind: "toggle", adding: true });
    expect(gestureIds(ts, add, c(5, 0))).toEqual([0, 1, 5]);
    const remove = startGesture(ts, c(1, 0), { ctrl: true, shift: false }, { ids: [0, 1, 2], anchor: c(0, 0) });
    expect(gestureIds(ts, remove, c(1, 0))).toEqual([0, 2]);
  });

  it("ctrl selection with holes → clip with empty cells", () => {
    const brush = brushFor(ts, [0, 2], NONE);
    expect(brush?.kind).toBe("clip");
    if (brush?.kind !== "clip") return;
    expect([brush.clip.width, brush.clip.height]).toEqual([3, 1]);
    expect([tileAt(brush.clip, 0, 0), tileAt(brush.clip, 1, 0), tileAt(brush.clip, 2, 0)]).toEqual([0, null, 2]);
    expect(isRectangle(ts, [0, 2])).toBe(false);
  });

  it("shift extends the rectangle from the anchor", () => {
    const g = startGesture(ts, c(2, 1), { ctrl: false, shift: true }, { ids: [0], anchor: c(0, 0) });
    expect(gestureIds(ts, g, c(2, 1))).toEqual([0, 1, 2, 8, 9, 10]);
  });

  it("shift without a selection starts a new one", () => {
    const g = startGesture(ts, c(2, 1), { ctrl: false, shift: true }, null);
    expect(gestureIds(ts, g, c(2, 1))).toEqual([10]);
  });

  it("transparent tiles are skipped in clips", () => {
    const empty = new Set([1, 9]);
    const brush = brushFor(ts, [0, 1, 2, 8, 9, 10], empty);
    expect(brush?.kind).toBe("clip");
    if (brush?.kind !== "clip") return;
    expect(brush.ids).toEqual([0, 2, 8, 10]);
    expect(tileAt(brush.clip, 1, 0)).toBeNull();
    expect(tileAt(brush.clip, 1, 1)).toBeNull();
    // Only one opaque tile left → plain tile; only transparent → nothing.
    expect(brushFor(ts, [1, 2, 9], empty)).toEqual({ kind: "tile", tileId: 2 });
    expect(brushFor(ts, [1, 9], empty)).toBeNull();
    // A single clicked transparent tile is still selectable.
    expect(brushFor(ts, [1], empty)).toEqual({ kind: "tile", tileId: 1 });
  });

  it("arrow keys move the single selection; shift + arrows grow from the anchor", () => {
    const moved = arrowSelect(ts, { anchor: c(1, 1), focus: c(1, 1) }, [1, 0], false);
    expect(moved.ids).toEqual([10]);
    const grown = arrowSelect(ts, { anchor: c(1, 1), focus: c(2, 1) }, [0, 1], true);
    expect(grown.ids).toEqual([9, 10, 17, 18]);
    expect(grown.anchor).toEqual(c(1, 1));
    expect(arrowSelect(ts, { anchor: c(0, 0), focus: c(0, 0) }, [-1, 0], false).ids).toEqual([0]);
  });

  it("outline traces only the selection's edge", () => {
    expect(outlinePath(ts, [0], 10, 10).match(/M/g)).toHaveLength(4);
    // 2×1 block: the shared edge is not drawn.
    expect(outlinePath(ts, [0, 1], 10, 10).match(/M/g)).toHaveLength(6);
    expect(boundsOf(ts, [9, 19])).toEqual({ col: 1, row: 1, width: 3, height: 2 });
  });
});

describe("map pick → tileset cells", () => {
  const get = (id: string) => (id === ts.id ? ts : undefined);

  it("a block copied from the tileset maps back to its cells", () => {
    const clip = clipFromTileset(ts, { x: 2, y: 3, w: 2, h: 2 })!;
    expect(clipSourceIds(clip, get)).toEqual({ tilesetId: "ow", ids: [26, 27, 34, 35] });
  });

  it("holes are fine as long as the layout matches", () => {
    const clip = clipFromTileset(ts, [c(0, 0), c(2, 1)])!;
    expect(clipSourceIds(clip, get)?.ids).toEqual([0, 10]);
  });

  it("a rearranged, flipped or multi-layer clip does not map", () => {
    const clip = clipFromTileset(ts, [c(0, 0), c(1, 0)])!;
    const layer = clip.layers[0]!;
    const swapped: TileClip = { ...clip, layers: [{ ...layer, cells: Uint32Array.from([layer.cells[1]!, layer.cells[0]!]) }] };
    expect(clipSourceIds(swapped, get)).toBeNull();
    const flipped: TileClip = { ...clip, layers: [{ ...layer, cells: Uint32Array.from([layer.cells[0]! | FLIP_H, layer.cells[1]!]) }] };
    expect(clipSourceIds(flipped, get)).toBeNull();
    expect(clipSourceIds({ ...clip, layers: [layer, { ...layer, layerId: "b" }] }, get)).toBeNull();
    expect(clipSourceIds(clip, () => undefined)).toBeNull();
  });
});
