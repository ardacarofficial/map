/**
 * Pure helpers of the sized brush and the rectangle modifiers: the brush
 * footprint (size × size square or circle around the cursor cell), stamping
 * it along a stroke without repeats, and the Shift (square) / Alt (from
 * centre) rectangle constraint. No Pixi, no DOM: unit tested.
 *
 * The footprint shape and the square corner come from core
 * (`brushFootprint`, `squareCorner`); this module adds the editor's size
 * range, per-stroke de-duplication across pointer events (core
 * `strokeCells` de-duplicates within one call only) and "from the centre".
 */
import { brushFootprint as coreBrushFootprint, squareCorner, type CellPoint } from "@smap/core";

import type { EditorState } from "../state/editorStore";

/** Brush tip shape (editor store `brushShape`). */
export type BrushShape = EditorState["brushShape"];

/** Brush size bounds (the store clamps to the same range). */
export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 16;

/** `size` clamped to a whole number in the brush range. */
export function clampBrushSize(size: number): number {
  if (!Number.isFinite(size)) return MIN_BRUSH_SIZE;
  return Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, Math.round(size)));
}

/**
 * Cell offsets of a brush relative to the cursor cell, row by row (core
 * `brushFootprint` with the editor's 1–16 size range): odd sizes are
 * centred on the cursor, even sizes extend one cell further up-left; a
 * circle of size 1–2 is a full square, 3 a plus, larger sizes are rounded.
 */
export function brushFootprint(size: number, shape: BrushShape): CellPoint[] {
  return coreBrushFootprint(clampBrushSize(size), shape);
}

/**
 * Cells covered by placing `offsets` at each of `centers`, in order, without
 * duplicates. `seen` (keys `"x,y"`) carries over between calls so a whole
 * stroke covers each cell once; new cells are added to it.
 */
export function footprintCells(
  centers: readonly CellPoint[],
  offsets: readonly CellPoint[],
  seen: Set<string> = new Set(),
): CellPoint[] {
  const out: CellPoint[] = [];
  for (const c of centers) {
    for (const o of offsets) {
      const x = c.x + o.x;
      const y = c.y + o.y;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y });
    }
  }
  return out;
}

/** Bounding box of `cells` (null when empty). */
export function cellsBounds(cells: readonly CellPoint[]): { x: number; y: number; width: number; height: number } | null {
  if (cells.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cells) {
    if (c.x < x0) x0 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.x > x1) x1 = c.x;
    if (c.y > y1) y1 = c.y;
  }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Rectangle drag modifiers: Shift = square, Alt = drawn from the centre. */
export interface RectModifiers {
  readonly square: boolean;
  readonly fromCenter: boolean;
}

/**
 * The two corners (both included) of a rectangle dragged from `start` to
 * `end` under `mods`. Square: the longer side wins, growing towards the
 * pointer. From centre: `start` is the centre cell, so the rectangle
 * mirrors around it (odd sizes).
 */
export function constrainRect(start: CellPoint, end: CellPoint, mods: RectModifiers): { a: CellPoint; b: CellPoint } {
  const b = mods.square ? squareCorner(start, end) : { x: end.x, y: end.y };
  const a = mods.fromCenter ? { x: 2 * start.x - b.x, y: 2 * start.y - b.y } : { x: start.x, y: start.y };
  return { a, b };
}
