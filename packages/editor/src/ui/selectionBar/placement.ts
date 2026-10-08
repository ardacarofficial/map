/**
 * Where the selection action bar goes: centred under the selection, or
 * above it when there is no room below, never on top of it unless the
 * selection leaves no room on either side. Pure; CSS px relative to the
 * canvas' top-left corner.
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
  /** No room on either side (selection fills the view): pinned to the view edge with more room. */
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
export function placeSelectionBar(sel: Rect | null, bar: Size, view: Size, gap = BAR_GAP, margin = BAR_MARGIN): BarPlacement {
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

  // The selection covers the view vertically: use the edge with more free space.
  const roomBelow = view.height - (sel.y + sel.height);
  const roomAbove = sel.y;
  return { x, y: Math.round(roomBelow >= roomAbove ? maxY : margin), side: "overlap" };
}
