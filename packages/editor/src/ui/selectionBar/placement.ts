/**
 * Where the selection action bar goes: centred under the selection; above
 * it when there is no room below; beside it (right, then left) when the
 * selection is too tall for either; and only when the selection covers the
 * whole view, pinned inside the view edge. It never covers the selection
 * while any of those fits. Pure; CSS px relative to the canvas' top-left corner.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type BarSide =
  /** Below the selection. */
  | "below"
  /** Above the selection (no room below). */
  | "above"
  /** Right of the selection (too tall for above / below). */
  | "right"
  /** Left of the selection (no room right either). */
  | "left"
  /** No room on any side (selection fills the view): pinned inside the view edge with more room. */
  | "overlap"
  /** Position unknown (no selection rect): top centre of the canvas. */
  | "fallback";

export interface BarPlacement {
  readonly x: number;
  readonly y: number;
  readonly side: BarSide;
}

/** Space between the selection and the bar. */
export const BAR_GAP = 8;
/** Minimum distance between the bar and the canvas edge. */
export const BAR_MARGIN = 8;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Top-left of the bar for a selection at `sel` (null = unknown) in a view of
 * `view` size. Horizontally centred on the visible part of the selection and
 * kept inside the view.
 */
export function placeSelectionBar(
  sel: Rect | null,
  bar: Size,
  view: Size,
  gap = BAR_GAP,
  margin = BAR_MARGIN,
  corner: Size | null = null,
): BarPlacement {
  const p = placeAroundSelection(sel, bar, view, gap, margin);
  return corner ? clearOfCorner(p, sel, bar, view, margin, corner) : p;
}

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * Slides a bar that would sit on the bottom-right `corner` box (the minimap,
 * its margin included) left of it, unless that would cover the selection or
 * leave the view.
 */
function clearOfCorner(p: BarPlacement, sel: Rect | null, bar: Size, view: Size, margin: number, corner: Size): BarPlacement {
  if (corner.width <= 0 || corner.height <= 0) return p;
  const box: Rect = { x: view.width - corner.width, y: view.height - corner.height, width: corner.width, height: corner.height };
  if (!intersects({ x: p.x, y: p.y, width: bar.width, height: bar.height }, box)) return p;
  const x = Math.round(box.x - bar.width);
  if (x < margin) return p;
  const moved = { x, y: p.y, width: bar.width, height: bar.height };
  if (sel && p.side !== "overlap" && intersects(moved, sel)) return p;
  return { ...p, x };
}

function placeAroundSelection(sel: Rect | null, bar: Size, view: Size, gap: number, margin: number): BarPlacement {
  const maxX = Math.max(margin, view.width - bar.width - margin);
  const maxY = Math.max(margin, view.height - bar.height - margin);
  if (!sel) return { x: Math.round(clamp((view.width - bar.width) / 2, margin, maxX)), y: margin, side: "fallback" };

  // Centre on the part of the selection that is on screen.
  const left = clamp(sel.x, 0, view.width);
  const right = clamp(sel.x + sel.width, 0, view.width);
  const center = left < right ? (left + right) / 2 : sel.x + sel.width / 2;
  const x = Math.round(clamp(center - bar.width / 2, margin, maxX));

  const below = sel.y + sel.height + gap;
  if (below + bar.height + margin <= view.height) return { x, y: Math.round(Math.max(margin, below)), side: "below" };
  const above = sel.y - gap - bar.height;
  if (above >= margin) return { x, y: Math.round(Math.min(maxY, above)), side: "above" };

  // Too tall for above / below: beside it, vertically centred on its visible part.
  const top = clamp(sel.y, 0, view.height);
  const bottom = clamp(sel.y + sel.height, 0, view.height);
  const middle = top < bottom ? (top + bottom) / 2 : sel.y + sel.height / 2;
  const y = Math.round(clamp(middle - bar.height / 2, margin, maxY));
  const besideRight = sel.x + sel.width + gap;
  if (besideRight + bar.width + margin <= view.width) return { x: Math.round(Math.max(margin, besideRight)), y, side: "right" };
  const leftX = sel.x - gap - bar.width;
  if (leftX >= margin) return { x: Math.round(Math.min(maxX, leftX)), y, side: "left" };

  // The selection covers the view: inside the edge with more free space (the margin is the offset).
  const roomBelow = view.height - (sel.y + sel.height);
  const roomAbove = sel.y;
  return { x, y: Math.round(roomBelow >= roomAbove ? maxY : margin), side: "overlap" };
}
