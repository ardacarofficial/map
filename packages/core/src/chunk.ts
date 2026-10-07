import { EMPTY_CELL, type Cell } from "./cell";

/** Chunks are `2^CHUNK_SHIFT` cells wide and tall. */
export const CHUNK_SHIFT = 5;
/** Chunk side length in cells (32). */
export const CHUNK_SIZE = 1 << CHUNK_SHIFT;
/** Mask for the cell position inside a chunk (31). */
export const CHUNK_MASK = CHUNK_SIZE - 1;
/** Cells per chunk (1024). */
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;

/** String key of a chunk, `"cx,cy"`. */
export type ChunkKey = string;

/** Chunk coordinate of a cell coordinate. Uses `>>`, which floors negatives correctly. */
export function chunkCoord(cellCoord: number): number {
  return cellCoord >> CHUNK_SHIFT;
}

/** Position inside the chunk (`0..31`). Uses `&`, which is correct for negatives. */
export function localCoord(cellCoord: number): number {
  return cellCoord & CHUNK_MASK;
}

/** Index into a chunk's `data` array for local coordinates (row-major). */
export function localIndex(lx: number, ly: number): number {
  return (ly << CHUNK_SHIFT) | lx;
}

/** Key for chunk (`cx`, `cy`). */
export function chunkKey(cx: number, cy: number): ChunkKey {
  return `${cx},${cy}`;
}

/** Inverse of {@link chunkKey}. */
export function parseChunkKey(key: ChunkKey): { cx: number; cy: number } {
  const comma = key.indexOf(",");
  return { cx: Number(key.slice(0, comma)), cy: Number(key.slice(comma + 1)) };
}

/** Read-only view of a chunk handed to renderers. Do not write to `data`. */
export interface ReadonlyChunk {
  readonly cx: number;
  readonly cy: number;
  readonly key: ChunkKey;
  /**
   * 1024 cells, row-major: cell (lx, ly) is `data[ly * 32 + lx]`.
   * World cell = (`cx * 32 + lx`, `cy * 32 + ly`).
   */
  readonly data: Uint32Array;
  /** Number of non-empty cells (always ≥ 1 for a stored chunk). */
  readonly filled: number;
}

/** @internal A 32×32 block of cells. Created only when it receives a non-empty cell. */
export class Chunk implements ReadonlyChunk {
  readonly cx: number;
  readonly cy: number;
  readonly key: ChunkKey;
  readonly data = new Uint32Array(CHUNK_AREA);
  filled = 0;

  constructor(cx: number, cy: number) {
    this.cx = cx;
    this.cy = cy;
    this.key = chunkKey(cx, cy);
  }

  /** Writes a cell and keeps `filled` in sync. Returns the previous value. */
  set(index: number, cell: Cell): Cell {
    const before = this.data[index] ?? EMPTY_CELL;
    if (before === cell) return before;
    this.data[index] = cell;
    if (before === EMPTY_CELL) this.filled++;
    else if (cell === EMPTY_CELL) this.filled--;
    return before;
  }
}
