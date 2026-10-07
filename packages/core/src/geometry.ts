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
