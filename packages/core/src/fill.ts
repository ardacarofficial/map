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

/**
 * Flood fill: the 4-connected region of cells equal to the cell at
 * (`x`, `y`), inside `bounds`. Returns the cells to write, without
 * duplicates; empty when the start is out of bounds or already equals `cell`
 * (filling would change nothing). Iterative scanline — no recursion.
 *
 * Paint the result with a `paintCells` op (one undo step):
 * `store.dispatch({ type: "paintCells", layerId, cells: floodFill(...).map((p) => ({ ...p, cell })) })`.
 */
export function floodFill(layer: CellSource, x: number, y: number, cell: Cell, bounds: CellBounds): CellPoint[] {
  const { width, height } = bounds;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return [];
  const target = layer.getCell(x, y);
  if (target === cell) return [];

  // open[i] = 1 while cell i matches the target and has not been filled yet.
  const open = matchMask(layer, target, width, height);
  const points: CellPoint[] = [];
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
    for (let ix = left; ix <= right; ix++) points.push({ x: ix, y: sy });
    // Seed one cell per open run in the rows above and below.
    if (sy > 0) seedRow(open, stack, (sy - 1) * width, sy - 1, left, right);
    if (sy < height - 1) seedRow(open, stack, (sy + 1) * width, sy + 1, left, right);
  }
  return points;
}

function seedRow(open: Uint8Array, stack: number[], row: number, y: number, left: number, right: number): void {
  let inRun = false;
  for (let ix = left; ix <= right; ix++) {
    const match = open[row + ix] === 1;
    if (match && !inRun) stack.push(ix, y);
    inRun = match;
  }
}

/** `width × height` mask: 1 where the cell equals `target`. */
function matchMask(layer: CellSource, target: Cell, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (!layer.chunks) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) if (layer.getCell(x, y) === target) mask[y * width + x] = 1;
    }
    return mask;
  }
  // Empty cells are everywhere without a chunk: start from all-ones and clear.
  const empty = target === EMPTY_CELL;
  if (empty) mask.fill(1);
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
          if (!match) mask[dst + x] = 0;
        } else if (match) {
          mask[dst + x] = 1;
        }
      }
    }
  }
  return mask;
}
