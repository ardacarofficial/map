/**
 * Tileset panel selection, as pure functions (unit tested): click = one
 * tile, drag = rectangle, Ctrl/Cmd = toggle cells (any shape, holes
 * allowed), Shift = rectangle from the anchor. A finished selection becomes
 * the brush: one tile → plain selection, more → a core `TileClip`
 * (`clipFromTileset`), fully transparent tiles left out.
 *
 * Cells are addressed by tile id (`row * columns + col`), kept sorted.
 */
import {
  cellFlags,
  cellPaletteIndex,
  clipFromTileset,
  tilePosition,
  tilesetCellsInRect,
  type TileClip,
  type Tileset,
  type TilesetCell,
} from "@smap/core";

/** The grid size a selection needs (a `Tileset` satisfies it). */
export interface GridSize {
  readonly columns: number;
  readonly rows: number;
}

export type Cell = TilesetCell;

/** What a drag in the tileset does with the cells under it. */
export type SelectGesture =
  /** Plain or Shift drag: the rectangle from `anchor` replaces the selection. */
  | { readonly kind: "rect"; readonly anchor: Cell }
  /** Ctrl/Cmd drag: the rectangle is added to (or removed from) `base`. */
  | { readonly kind: "toggle"; readonly anchor: Cell; readonly base: readonly number[]; readonly adding: boolean };

export interface Modifiers {
  readonly ctrl: boolean;
  readonly shift: boolean;
}

export const idOf = (grid: GridSize, c: Cell): number => c.row * grid.columns + c.col;
export const cellOf = (grid: GridSize, id: number): Cell => ({ col: id % grid.columns, row: Math.floor(id / grid.columns) });

export function insideGrid(grid: GridSize, c: Cell): boolean {
  return c.col >= 0 && c.row >= 0 && c.col < grid.columns && c.row < grid.rows;
}

export function clampCell(grid: GridSize, c: Cell): Cell {
  return {
    col: Math.min(grid.columns - 1, Math.max(0, Math.floor(c.col))),
    row: Math.min(grid.rows - 1, Math.max(0, Math.floor(c.row))),
  };
}

/** Sorted tile ids of the rectangle spanned by `a` and `b` (both included, clamped to the grid). */
export function rectIds(grid: GridSize, a: Cell, b: Cell): number[] {
  return tilesetCellsInRect(grid as Tileset, a, b).map((c) => idOf(grid, c));
}

const sorted = (ids: Iterable<number>) => [...new Set(ids)].sort((x, y) => x - y);

/**
 * Starts a drag at `cell`. `current` is what is selected now (its ids and
 * anchor) when it is in the same tileset, else null.
 */
export function startGesture(
  grid: GridSize,
  cell: Cell,
  mods: Modifiers,
  current: { readonly ids: readonly number[]; readonly anchor: Cell } | null,
): SelectGesture {
  if (mods.ctrl) {
    const base = current?.ids ?? [];
    return { kind: "toggle", anchor: cell, base, adding: !base.includes(idOf(grid, cell)) };
  }
  if (mods.shift && current) return { kind: "rect", anchor: current.anchor };
  return { kind: "rect", anchor: cell };
}

/** Selected ids while the pointer is over `cell` (live preview, and the result on release). */
export function gestureIds(grid: GridSize, gesture: SelectGesture, cell: Cell): number[] {
  const rect = rectIds(grid, gesture.anchor, cell);
  if (gesture.kind === "rect") return rect;
  if (gesture.adding) return sorted([...gesture.base, ...rect]);
  const drop = new Set(rect);
  return gesture.base.filter((id) => !drop.has(id));
}

/** What a finished selection puts on the brush. */
export type TilesetBrush =
  | { readonly kind: "tile"; readonly tileId: number }
  | { readonly kind: "clip"; readonly clip: TileClip; readonly ids: readonly number[] };

/**
 * The brush for `ids` of `tileset`. A single cell is always a plain tile
 * (even a transparent one: the user clicked it). Larger selections skip
 * `empty` tiles; one tile left → plain tile, none → null.
 */
export function brushFor(
  tileset: Tileset,
  ids: readonly number[],
  empty: ReadonlySet<number>,
  layerId = "tiles",
): TilesetBrush | null {
  const unique = sorted(ids).filter((id) => id >= 0 && id < tileset.columns * tileset.rows);
  if (unique.length === 0) return null;
  if (unique.length === 1) return { kind: "tile", tileId: unique[0]! };
  const kept = unique.filter((id) => !empty.has(id));
  if (kept.length === 0) return null;
  if (kept.length === 1) return { kind: "tile", tileId: kept[0]! };
  const clip = clipFromTileset(
    tileset,
    kept.map((id) => cellOf(tileset, id)),
    { layerId },
  );
  if (!clip) return null;
  return { kind: "clip", clip, ids: kept };
}

/** Bounding box of `ids` in cells, or null when empty. */
export function boundsOf(grid: GridSize, ids: readonly number[]): { col: number; row: number; width: number; height: number } | null {
  if (ids.length === 0) return null;
  let c0 = Infinity;
  let r0 = Infinity;
  let c1 = -Infinity;
  let r1 = -Infinity;
  for (const id of ids) {
    const { col, row } = cellOf(grid, id);
    c0 = Math.min(c0, col);
    r0 = Math.min(r0, row);
    c1 = Math.max(c1, col);
    r1 = Math.max(r1, row);
  }
  return { col: c0, row: r0, width: c1 - c0 + 1, height: r1 - r0 + 1 };
}

/** True when `ids` fill their bounding box (a plain rectangle). */
export function isRectangle(grid: GridSize, ids: readonly number[]): boolean {
  const b = boundsOf(grid, ids);
  return !!b && new Set(ids).size === b.width * b.height;
}

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Arrow key → `[dx, dy]`, or null. */
export function arrowDelta(key: string): readonly [number, number] | null {
  return ARROWS[key] ?? null;
}

/**
 * Arrow key in the focused panel: without Shift the single selection moves
 * (from `focus`); with Shift the rectangle from `anchor` grows / shrinks
 * towards the moved focus. Returns the new anchor, focus and ids.
 */
export function arrowSelect(
  grid: GridSize,
  state: { readonly anchor: Cell; readonly focus: Cell } | null,
  delta: readonly [number, number],
  shift: boolean,
): { anchor: Cell; focus: Cell; ids: number[] } {
  if (!state) {
    const start = { col: 0, row: 0 };
    return { anchor: start, focus: start, ids: [idOf(grid, start)] };
  }
  const focus = clampCell(grid, { col: state.focus.col + delta[0], row: state.focus.row + delta[1] });
  if (shift) return { anchor: state.anchor, focus, ids: rectIds(grid, state.anchor, focus) };
  return { anchor: focus, focus, ids: [idOf(grid, focus)] };
}

/**
 * SVG path (`M…H…V…` segments) of the outline of `ids`: only edges between
 * a selected and an unselected cell, so a rectangle is one frame and an
 * arbitrary set shows its holes. Coordinates in CSS px for `cellW × cellH` cells.
 */
export function outlinePath(grid: GridSize, ids: readonly number[], cellW: number, cellH: number): string {
  const set = new Set(ids);
  const has = (col: number, row: number) =>
    col >= 0 && row >= 0 && col < grid.columns && row < grid.rows && set.has(row * grid.columns + col);
  const parts: string[] = [];
  const x = (col: number) => Math.round(col * cellW);
  const y = (row: number) => Math.round(row * cellH);
  for (const id of set) {
    const { col, row } = cellOf(grid, id);
    if (!has(col, row - 1)) parts.push(`M${x(col)} ${y(row)}H${x(col + 1)}`);
    if (!has(col, row + 1)) parts.push(`M${x(col)} ${y(row + 1)}H${x(col + 1)}`);
    if (!has(col - 1, row)) parts.push(`M${x(col)} ${y(row)}V${y(row + 1)}`);
    if (!has(col + 1, row)) parts.push(`M${x(col + 1)} ${y(row)}V${y(row + 1)}`);
  }
  return parts.join("");
}

/**
 * Map pick → tileset cells: when `clip` is one tile layer whose cells all
 * come from one tileset, unflipped, laid out as in the tileset (one common
 * offset; holes allowed), the source tile ids. Otherwise null (the panel
 * then only shows the brush preview).
 */
export function clipSourceIds(
  clip: TileClip,
  getTileset: (id: string) => Tileset | undefined,
): { tilesetId: string; ids: number[] } | null {
  if (clip.layers.length !== 1) return null;
  const layer = clip.layers[0]!;
  if (layer.grid) return null;
  let tileset: Tileset | undefined;
  let dCol = 0;
  let dRow = 0;
  const ids: number[] = [];
  for (let y = 0; y < clip.height; y++) {
    for (let x = 0; x < clip.width; x++) {
      const cell = layer.cells[y * clip.width + x] ?? 0;
      if (cell === 0) continue;
      if (cellFlags(cell) !== 0) return null;
      const entry = clip.palette[cellPaletteIndex(cell) - 1];
      if (!entry) return null;
      if (!tileset) {
        tileset = getTileset(entry.tilesetId);
        if (!tileset) return null;
        const p = tilePosition(tileset, entry.tileId);
        dCol = p.col - x;
        dRow = p.row - y;
      } else if (entry.tilesetId !== tileset.id) return null;
      const p = tilePosition(tileset, entry.tileId);
      if (p.col - x !== dCol || p.row - y !== dRow) return null;
      ids.push(entry.tileId);
    }
  }
  if (!tileset || ids.length === 0) return null;
  return { tilesetId: tileset.id, ids: sorted(ids) };
}
