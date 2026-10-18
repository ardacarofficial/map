import type { CellBounds, CellPoint, CellRect } from "./geometry";
import { rectangleBand } from "./rectangleBand";

export const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;
export type BorderSide = typeof BORDER_SIDES[number];
/** Start is zero-based along the inset rectangle: horizontal left→right, vertical top→bottom. */
export interface BorderGap { readonly side: BorderSide; readonly start: number; readonly length: number }
export interface MapBorderOptions {
  readonly thickness: number;
  readonly inset: number;
  readonly sides?: Partial<Record<BorderSide, boolean>>;
  readonly gaps?: readonly BorderGap[];
}
export interface MapBorder {
  readonly rect: CellRect;
  readonly thickness: number;
  readonly inset: number;
  readonly clamped: boolean;
  readonly cells: readonly CellPoint[];
}

/** Finite perimeter band, in row order. Gaps cut through all overlapping side strips. No document mutation. */
export function mapBorder(bounds: CellBounds, options: MapBorderOptions): MapBorder {
  const { width, height } = bounds;
  if (![width, height, options.thickness, options.inset].every(Number.isSafeInteger) || width < 1 || height < 1 || options.thickness < 1 || options.inset < 0) throw new RangeError("invalid map border dimensions");
  for (const gap of options.gaps ?? []) if (!BORDER_SIDES.includes(gap.side) || !Number.isSafeInteger(gap.start) || !Number.isSafeInteger(gap.length) || gap.start < 0 || gap.length < 1) throw new RangeError("invalid border gap");
  const inset = Math.min(options.inset, Math.floor((Math.min(width, height) - 1) / 2));
  const rect = { x: inset, y: inset, width: width - 2 * inset, height: height - 2 * inset };
  const thickness = Math.min(options.thickness, Math.ceil(Math.min(rect.width, rect.height) / 2));
  const cells: CellPoint[] = [];
  for (const p of rectangleBand(rect, thickness)) {
    const x = p.x - inset, y = p.y - inset;
    const on: Record<BorderSide, boolean> = { top: y < thickness, bottom: y >= rect.height - thickness, left: x < thickness, right: x >= rect.width - thickness };
    if (!BORDER_SIDES.some(side => on[side] && options.sides?.[side] !== false)) continue;
    if (options.gaps?.some(gap => {
      const pos = gap.side === "top" || gap.side === "bottom" ? x : y;
      return on[gap.side] && options.sides?.[gap.side] !== false && pos >= gap.start && pos - gap.start < gap.length;
    })) continue;
    cells.push(p);
  }
  return { rect, thickness, inset, clamped: inset !== options.inset || thickness !== options.thickness, cells };
}
