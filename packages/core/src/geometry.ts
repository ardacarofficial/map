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

/** Brush tip shape. */
export type BrushShape = "square" | "circle";

/** Largest brush size accepted by {@link brushFootprint} (larger sizes are clamped). */
export const MAX_BRUSH_SIZE = 64;

/**
 * Cell offsets covered by a brush of `size` × `size` cells, relative to the
 * cursor cell, row-major. Odd sizes are centred on the cursor; even sizes
 * have no centre cell and extend one cell further toward the top-left
 * (size 2 covers the cursor and the cells left / above it: offsets −1..0).
 *
 * `"circle"`: cells whose centre lies within the disc of diameter `size`
 * (a small inset keeps size 3 a plus and size 5 a rounded 21-cell disc,
 * like pixel-art editors); sizes 1 and 2 are always full squares.
 * `size` is floored and clamped to `[1, MAX_BRUSH_SIZE]`.
 */
export function brushFootprint(size: number, shape: BrushShape = "square"): CellPoint[] {
  const n = Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.floor(Number.isFinite(size) ? size : 1)));
  const lo = 0 - Math.floor(n / 2); // not -0
  const centre = lo + (n - 1) / 2;
  const r2 = (n / 2) * (n / 2) - 0.5;
  const out: CellPoint[] = [];
  for (let dy = lo; dy < lo + n; dy++) {
    for (let dx = lo; dx < lo + n; dx++) {
      if (shape === "circle" && n > 2 && (dx - centre) ** 2 + (dy - centre) ** 2 > r2) continue;
      out.push({ x: dx, y: dy });
    }
  }
  return out;
}

/**
 * Every cell a brush covers along `points` (e.g. `lineCells` of a drag),
 * de-duplicated in first-touched order and clipped to `bounds` when given.
 */
export function strokeCells(points: readonly CellPoint[], footprint: readonly CellPoint[], bounds?: CellBounds): CellPoint[] {
  const seen = new Set<string>();
  const out: CellPoint[] = [];
  for (const p of points) {
    for (const o of footprint) {
      const x = p.x + o.x;
      const y = p.y + o.y;
      if (bounds && (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height)) continue;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * Corner `b` moved so that the rectangle from `a` to it is a square (Shift
 * while dragging): the side is the longer of the two spans and `b` keeps
 * its direction from `a`. Non-integer inputs are floored.
 */
export function squareCorner(a: CellPoint, b: CellPoint): CellPoint {
  const ax = Math.floor(a.x);
  const ay = Math.floor(a.y);
  const dx = Math.floor(b.x) - ax;
  const dy = Math.floor(b.y) - ay;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: ax + (dx < 0 ? -side : side), y: ay + (dy < 0 ? -side : side) };
}

/**
 * Rectangle tool / selection: the rectangle from `a` to `b` (both included),
 * made square first when `square` is true, then normalized and clipped to
 * `bounds` like {@link normalizeRect} (so a clipped square may not be square).
 */
export function constrainRect(a: CellPoint, b: CellPoint, square: boolean, bounds?: CellBounds): CellRect | null {
  const end = square ? squareCorner(a, b) : b;
  return normalizeRect(a.x, a.y, end.x, end.y, bounds);
}
