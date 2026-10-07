/** Integer cell position. */
export interface CellPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Cells on the line from (`x0`, `y0`) to (`x1`, `y1`), both ends included,
 * using Bresenham's algorithm. Consecutive cells are 8-connected (they differ
 * by at most 1 on each axis), so a fast brush drag leaves no gaps.
 *
 * Non-integer inputs are floored (pointer positions converted to cells).
 */
export function lineCells(x0: number, y0: number, x1: number, y1: number): CellPoint[] {
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const xEnd = Math.floor(x1);
  const yEnd = Math.floor(y1);
  const dx = Math.abs(xEnd - x);
  const dy = -Math.abs(yEnd - y);
  const sx = x < xEnd ? 1 : -1;
  const sy = y < yEnd ? 1 : -1;
  let err = dx + dy;
  const points: CellPoint[] = [];
  for (;;) {
    points.push({ x, y });
    if (x === xEnd && y === yEnd) return points;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Map bounds: cells `0 ≤ x < width`, `0 ≤ y < height`. `MapInfo` satisfies it. */
export interface CellBounds {
  readonly width: number;
  readonly height: number;
}

/** Integer cell rectangle: top-left corner plus size. */
export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Rectangle spanned by two corner cells (any order, both included) as a
 * normalized {@link CellRect}, clipped to `bounds` when given. Non-integer
 * inputs are floored. Returns `null` when nothing is left after clipping.
 */
export function normalizeRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bounds?: CellBounds,
): CellRect | null {
  let left = Math.min(Math.floor(x0), Math.floor(x1));
  let top = Math.min(Math.floor(y0), Math.floor(y1));
  let right = Math.max(Math.floor(x0), Math.floor(x1));
  let bottom = Math.max(Math.floor(y0), Math.floor(y1));
  if (bounds) {
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, bounds.width - 1);
    bottom = Math.min(bottom, bounds.height - 1);
  }
  if (right < left || bottom < top) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Cells of the rectangle spanned by two corner cells (any order, both
 * included), clipped to `bounds` when given, in row-major order.
 * Feed them to a `paintCells` op for the rectangle tool.
 */
export function rectCells(x0: number, y0: number, x1: number, y1: number, bounds?: CellBounds): CellPoint[] {
  const rect = normalizeRect(x0, y0, x1, y1, bounds);
  if (!rect) return [];
  const points: CellPoint[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) points.push({ x, y });
  }
  return points;
}
