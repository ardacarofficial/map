/**
 * Cell format.
 *
 * A cell is an unsigned 32-bit integer:
 *
 * ```text
 *  bit 31   bit 30   bit 29   bits 28..0
 *  flipH    flipV    flipD    palette index (0 = empty)
 * ```
 *
 * - `0` is the empty cell. An empty cell never carries flags.
 * - `flipD` (diagonal flip = transpose, applied before H and V, as in Tiled)
 *   is produced by 90° rotation ({@link rotateCellFlags}, round 4; opt-in).
 * - Every result goes through `>>> 0`, so values stay in `[0, 2^32)` and never
 *   turn negative the way `Int32` arithmetic would.
 */

/** An unsigned 32-bit cell value (see module docs). */
export type Cell = number;

/** The empty cell. */
export const EMPTY_CELL: Cell = 0;

/** Horizontal flip flag (bit 31). */
export const FLIP_H = 0x8000_0000;
/** Vertical flip flag (bit 30). */
export const FLIP_V = 0x4000_0000;
/** Diagonal flip flag (bit 29): transpose, applied before H / V. Produced by rotation (round 4). */
export const FLIP_D = 0x2000_0000;
/** Mask of all flag bits. */
export const CELL_FLAG_MASK = 0xe000_0000;
/** Mask of the palette index bits. */
export const CELL_INDEX_MASK = 0x1fff_ffff;
/** Largest palette index a cell can address. */
export const MAX_PALETTE_INDEX = CELL_INDEX_MASK;
/** Largest valid cell value. */
export const MAX_CELL = 0xffff_ffff;

/** True when `value` is an integer palette index in `[0, MAX_PALETTE_INDEX]`. */
export function isValidPaletteIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_PALETTE_INDEX;
}

/**
 * Builds a cell from a palette index and flag bits.
 *
 * `flags` may be any combination of {@link FLIP_H}, {@link FLIP_V}, {@link FLIP_D};
 * other bits are ignored. Palette index `0` always yields {@link EMPTY_CELL}.
 *
 * @throws RangeError when `paletteIndex` is not an integer in `[0, MAX_PALETTE_INDEX]`.
 */
export function makeCell(paletteIndex: number, flags = 0): Cell {
  if (!isValidPaletteIndex(paletteIndex)) {
    throw new RangeError(
      `Palette index must be an integer in [0, ${MAX_PALETTE_INDEX}], got ${paletteIndex}`,
    );
  }
  if (paletteIndex === 0) return EMPTY_CELL;
  return ((flags & CELL_FLAG_MASK) | paletteIndex) >>> 0;
}

/** Palette index of a cell (`0` for empty). */
export function cellPaletteIndex(cell: Cell): number {
  return (cell & CELL_INDEX_MASK) >>> 0;
}

/** Flag bits of a cell (a combination of `FLIP_*`). */
export function cellFlags(cell: Cell): number {
  return (cell & CELL_FLAG_MASK) >>> 0;
}

/** True for the empty cell. */
export function isEmptyCell(cell: Cell): boolean {
  return cellPaletteIndex(cell) === 0;
}

/**
 * True when `value` is a well-formed cell: an integer in `[0, 2^32)` whose
 * flags are zero whenever its palette index is zero.
 */
export function isValidCell(value: number): boolean {
  if (!Number.isInteger(value) || value < 0 || value > MAX_CELL) return false;
  return cellPaletteIndex(value) !== 0 || value === 0;
}

/** Replaces all flag bits of `cell`. Empty cells stay empty. */
export function withFlags(cell: Cell, flags: number): Cell {
  if (isEmptyCell(cell)) return EMPTY_CELL;
  return ((cell & CELL_INDEX_MASK) | (flags & CELL_FLAG_MASK)) >>> 0;
}

/** Replaces the palette index of `cell`, keeping its flags (index 0 → empty). */
export function withPaletteIndex(cell: Cell, paletteIndex: number): Cell {
  return makeCell(paletteIndex, cellFlags(cell));
}

/** Sets or clears the horizontal flip flag. Empty cells stay empty. */
export function withFlipH(cell: Cell, on: boolean): Cell {
  return withFlags(cell, on ? cellFlags(cell) | FLIP_H : cellFlags(cell) & ~FLIP_H);
}

/** Sets or clears the vertical flip flag. Empty cells stay empty. */
export function withFlipV(cell: Cell, on: boolean): Cell {
  return withFlags(cell, on ? cellFlags(cell) | FLIP_V : cellFlags(cell) & ~FLIP_V);
}

/** Sets or clears the (reserved) diagonal flip flag. Empty cells stay empty. */
export function withFlipD(cell: Cell, on: boolean): Cell {
  return withFlags(cell, on ? cellFlags(cell) | FLIP_D : cellFlags(cell) & ~FLIP_D);
}

/** Toggles the horizontal flip flag (the `X` shortcut). */
export function toggleFlipH(cell: Cell): Cell {
  return withFlipH(cell, !hasFlipH(cell));
}

/** Toggles the vertical flip flag (the `Y` shortcut). */
export function toggleFlipV(cell: Cell): Cell {
  return withFlipV(cell, !hasFlipV(cell));
}

/** True when the horizontal flip flag is set. */
export function hasFlipH(cell: Cell): boolean {
  return (cell & FLIP_H) !== 0;
}

/** True when the vertical flip flag is set. */
export function hasFlipV(cell: Cell): boolean {
  return (cell & FLIP_V) !== 0;
}

/** True when the diagonal flip flag is set. */
export function hasFlipD(cell: Cell): boolean {
  return (cell & FLIP_D) !== 0;
}

/** Direction of a 90° rotation: clockwise or counter-clockwise. */
export type RotateDirection = "cw" | "ccw";

/**
 * Orientation tables for 90° rotation, indexed by `mask = H << 2 | V << 1 | D`
 * (Tiled `tilelayer.cpp`): the new mask after rotating a tile with `mask`.
 */
const ROTATE_CW: readonly number[] = [5, 4, 1, 0, 7, 6, 3, 2];
const ROTATE_CCW: readonly number[] = [3, 2, 7, 6, 1, 0, 5, 4];

function flagsToMask(flags: number): number {
  return ((flags & FLIP_H) !== 0 ? 4 : 0) | ((flags & FLIP_V) !== 0 ? 2 : 0) | ((flags & FLIP_D) !== 0 ? 1 : 0);
}

function maskToFlags(mask: number): number {
  return ((mask & 4 ? FLIP_H : 0) | (mask & 2 ? FLIP_V : 0) | (mask & 1 ? FLIP_D : 0)) >>> 0;
}

/**
 * The cell with its flip flags turned 90° (`"cw"` or `"ccw"`); the palette
 * index stays. Four turns in one direction give the cell back. Empty cells stay empty.
 */
export function rotateCellFlags(cell: Cell, dir: RotateDirection): Cell {
  if (isEmptyCell(cell)) return EMPTY_CELL;
  const table = dir === "cw" ? ROTATE_CW : ROTATE_CCW;
  return withFlags(cell, maskToFlags(table[flagsToMask(cellFlags(cell))]!));
}
