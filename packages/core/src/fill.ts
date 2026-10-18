import { EMPTY_CELL, type Cell } from "./cell";
import { CHUNK_SHIFT, CHUNK_SIZE, type ReadonlyChunk } from "./chunk";
import type { CellBounds, CellPoint } from "./geometry";

/**
 * Anything cells can be read from. `TileLayer` satisfies it; with `chunks()`
 * present the fill reads whole chunks instead of single cells (much faster).
 */
export interface CellSource {
  getCell(x: number, y: number): Cell;
  chunks?(): Iterable<ReadonlyChunk>;
}

/** Inclusive horizontal span, in the existing scanline traversal order. */
export interface FillRun {
  readonly y: number;
  readonly left: number;
  readonly right: number;
}

/** Compatibility wrapper returning individual cells in scanline order. */
export function floodFill(layer: CellSource, x: number, y: number, cell: Cell, bounds: CellBounds): CellPoint[] {
  const points: CellPoint[] = [];
  for (const run of floodFillRuns(layer, x, y, cell, bounds)) {
    for (let ix = run.left; ix <= run.right; ix++) points.push({ x: ix, y: run.y });
  }
  return points;
}

/**
 * The 4-connected same-valued region inside bounds, without per-cell objects.
 * Empty for an outside/noninteger start or a no-op. Iterative, no recursion.
 * Consumers build writes and dispatch through the store in one transaction.
 */
export function floodFillRuns(layer: CellSource, x: number, y: number, cell: Cell, bounds: CellBounds): FillRun[] {
  const { width, height } = bounds;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return [];
  const target = layer.getCell(x, y);
  if (target === cell) return [];
  const open = matchMask(layer, target, width, height);
  const runs: FillRun[] = [];
  // A uniform bounded map has one run per row. Keep the original LIFO
  // traversal (down from the seed, then up), without scanning its cells again.
  if (open === null) {
    for (let iy = y; iy < height; iy++) runs.push({ y: iy, left: 0, right: width - 1 });
    for (let iy = y - 1; iy >= 0; iy--) runs.push({ y: iy, left: 0, right: width - 1 });
    return runs;
  }
  const stack: number[] = [x, y];
  while (stack.length > 0) {
    const sy = stack.pop()!;
    const sx = stack.pop()!;
    const row = sy * width;
    if (open[row + sx] === 0) continue;
    let left = sx;
    while (left > 0 && open[row + left - 1] === 1) left--;
    let right = sx;
    while (right < width - 1 && open[row + right + 1] === 1) right++;
    open.fill(0, row + left, row + right + 1);
    runs.push({ y: sy, left, right });
    if (sy > 0) seedRow(open, stack, (sy - 1) * width, sy - 1, left, right);
    if (sy < height - 1) seedRow(open, stack, (sy + 1) * width, sy + 1, left, right);
  }
  return runs;
}

function seedRow(open: Uint8Array, stack: number[], row: number, y: number, left: number, right: number): void {
  let inRun = false;
  for (let ix = left; ix <= right; ix++) {
    const match = open[row + ix] === 1;
    if (match && !inRun) stack.push(ix, y);
    inRun = match;
  }
}

/** `width × height` match mask; null when the whole bounded map matches. */
function matchMask(layer: CellSource, target: Cell, width: number, height: number): Uint8Array | null {
  const mask = new Uint8Array(width * height);
  if (!layer.chunks) {
    let uniform = true;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (layer.getCell(x, y) === target) mask[y * width + x] = 1;
        else uniform = false;
      }
    }
    return uniform ? null : mask;
  }
  // Empty cells are everywhere without a chunk: start from all-ones and clear.
  const empty = target === EMPTY_CELL;
  if (empty) mask.fill(1);
  let uniform = empty;
  for (const chunk of layer.chunks()) {
    const x0 = chunk.cx << CHUNK_SHIFT;
    const y0 = chunk.cy << CHUNK_SHIFT;
    const xEnd = Math.min(x0 + CHUNK_SIZE, width);
    const yEnd = Math.min(y0 + CHUNK_SIZE, height);
    if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) continue;
    const data = chunk.data;
    for (let y = y0; y < yEnd; y++) {
      const src = (y - y0) << CHUNK_SHIFT;
      const dst = y * width;
      for (let x = x0; x < xEnd; x++) {
        const match = data[src + x - x0] === target;
        if (empty) {
          if (!match) {
            mask[dst + x] = 0;
            uniform = false;
          }
        } else if (match) {
          mask[dst + x] = 1;
        }
      }
    }
  }
  return uniform ? null : mask;
}
