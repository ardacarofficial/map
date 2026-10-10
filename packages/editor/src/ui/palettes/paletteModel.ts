/**
 * Palettes ("Paletler"): the user's own tile sections. A palette is a grid
 * of slots with a fixed column count; each filled slot names a tile of
 * some tileset (references only, no pixels). Core stores it as a
 * `Collection` in project.smap; this module is the pure editing model
 * (unit tested): drop / paste / move / clear, the selection → stamp clip,
 * and how many rows the grid shows.
 *
 * Cells are kept sorted (y, x) so the saved JSON is byte-stable.
 */
import { makeCell, type PaletteEntry, type TileClip } from "@smap/core";

/** One filled slot. */
export interface PaletteSlot {
  readonly x: number;
  readonly y: number;
  readonly tilesetId: string;
  readonly tileId: number;
  /** Flip / rotate flags (core cell flag bits, already shifted); omitted when 0. */
  readonly flags?: number;
}

/** Shape of core's `Collection` (structural, so the model does not depend on its exact export). */
export interface PaletteData {
  readonly id: string;
  readonly name: string;
  readonly columns: number;
  readonly cells: readonly PaletteSlot[];
}

/** A tile carried by a drag / clipboard, at offset (`dx`, `dy`) from the block's top-left. */
export interface PaletteItem {
  readonly dx: number;
  readonly dy: number;
  readonly tilesetId: string;
  readonly tileId: number;
  readonly flags?: number;
}

export const DEFAULT_PALETTE_COLUMNS = 8;
export const MIN_PALETTE_COLUMNS = 1;
export const MAX_PALETTE_COLUMNS = 64;
/** Empty rows shown under the last filled one (room to drop). */
export const SPARE_ROWS = 1;
/** Rows a new / empty palette shows. */
export const MIN_ROWS = 2;

/** Slot index in reading order. */
export const slotIndex = (columns: number, x: number, y: number): number => y * columns + x;

function sortCells(cells: Iterable<PaletteSlot>): PaletteSlot[] {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
}

function slot(x: number, y: number, item: Pick<PaletteItem, "tilesetId" | "tileId" | "flags">): PaletteSlot {
  return item.flags ? { x, y, tilesetId: item.tilesetId, tileId: item.tileId, flags: item.flags } : { x, y, tilesetId: item.tilesetId, tileId: item.tileId };
}

/** Rows the grid shows: the filled rows plus a spare one (at least {@link MIN_ROWS}). */
export function paletteRows(p: Pick<PaletteData, "cells">): number {
  let last = -1;
  for (const c of p.cells) last = Math.max(last, c.y);
  return Math.max(MIN_ROWS, last + 1 + SPARE_ROWS);
}

/** The slot at (`x`, `y`), or undefined when it is empty. */
export function slotAt(p: Pick<PaletteData, "cells">, x: number, y: number): PaletteSlot | undefined {
  return p.cells.find((c) => c.x === x && c.y === y);
}

const key = (x: number, y: number) => `${x},${y}`;

/** Items of the filled slots among `cells` (ids in reading order of the palette's grid), relative to their bounding box. */
export function itemsOfSlots(p: PaletteData, ids: readonly number[]): PaletteItem[] {
  const wanted = new Set(ids);
  const picked = p.cells.filter((c) => wanted.has(slotIndex(p.columns, c.x, c.y)));
  if (picked.length === 0) return [];
  const x0 = Math.min(...picked.map((c) => c.x));
  const y0 = Math.min(...picked.map((c) => c.y));
  return picked.map((c) => ({ dx: c.x - x0, dy: c.y - y0, tilesetId: c.tilesetId, tileId: c.tileId, ...(c.flags ? { flags: c.flags } : {}) }));
}

/** Items of tileset tiles `ids` (sorted ids of a grid with `columns`), keeping their layout; `skip` (e.g. transparent tiles) left out. */
export function itemsOfTiles(tilesetId: string, columns: number, ids: readonly number[], skip: ReadonlySet<number> = new Set()): PaletteItem[] {
  const kept = ids.length > 1 ? ids.filter((id) => !skip.has(id)) : [...ids];
  if (kept.length === 0) return [];
  const col = (id: number) => id % columns;
  const row = (id: number) => Math.floor(id / columns);
  const x0 = Math.min(...kept.map(col));
  const y0 = Math.min(...kept.map(row));
  return kept.map((id) => ({ dx: col(id) - x0, dy: row(id) - y0, tilesetId, tileId: id }));
}

/** Writes `items` with their top-left at (`x`, `y`); occupied slots are overwritten, items right of the last column are dropped. */
export function placeItems(p: PaletteData, items: readonly PaletteItem[], x: number, y: number): PaletteData {
  const map = new Map(p.cells.map((c) => [key(c.x, c.y), c]));
  for (const it of items) {
    const cx = x + it.dx;
    const cy = y + it.dy;
    if (cx < 0 || cy < 0 || cx >= p.columns) continue;
    map.set(key(cx, cy), slot(cx, cy, it));
  }
  return { ...p, cells: sortCells(map.values()) };
}

/** Puts `items` into the first empty slots in reading order (layout is not kept): a drop on the palette's chip, or a paste without a target slot. */
export function appendItems(p: PaletteData, items: readonly PaletteItem[]): PaletteData {
  const taken = new Set(p.cells.map((c) => slotIndex(p.columns, c.x, c.y)));
  const order = [...items].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
  const added: PaletteSlot[] = [];
  let i = 0;
  for (const it of order) {
    while (taken.has(i)) i++;
    added.push(slot(i % p.columns, Math.floor(i / p.columns), it));
    taken.add(i);
  }
  return { ...p, cells: sortCells([...p.cells, ...added]) };
}

/** Empties the slots `ids` (reading-order indices). */
export function clearSlots(p: PaletteData, ids: readonly number[]): PaletteData {
  const drop = new Set(ids);
  const cells = p.cells.filter((c) => !drop.has(slotIndex(p.columns, c.x, c.y)));
  return cells.length === p.cells.length ? p : { ...p, cells };
}

/** Where dragged tiles came from. */
export type DragSource =
  | { readonly kind: "tileset"; readonly tilesetId: string }
  /** `ids`: the dragged slots (reading-order indices of that palette). */
  | { readonly kind: "palette"; readonly paletteId: string; readonly ids: readonly number[] };

/**
 * A drop of `items` on palette `target` at slot (`x`, `y`) (null = append).
 * Copy by default; `move` (Shift) also empties the source slots when they
 * are in a palette (tileset tiles cannot move). Returns the palettes that
 * changed (target last, so a move inside one palette is one entry).
 */
export function dropOnPalette(
  palettes: readonly PaletteData[],
  targetId: string,
  items: readonly PaletteItem[],
  at: { x: number; y: number } | null,
  source: DragSource,
  move: boolean,
): PaletteData[] {
  const target = palettes.find((p) => p.id === targetId);
  if (!target || items.length === 0) return [];
  const out: PaletteData[] = [];
  let base = target;
  if (move && source.kind === "palette") {
    if (source.paletteId === targetId) base = clearSlots(target, source.ids);
    else {
      const from = palettes.find((p) => p.id === source.paletteId);
      if (from) {
        const cleared = clearSlots(from, source.ids);
        if (cleared !== from) out.push(cleared);
      }
    }
  }
  const next = at ? placeItems(base, items, at.x, at.y) : appendItems(base, items);
  if (!samePalette(next, target)) out.push(next);
  return out;
}

/** True when both palettes hold the same slots, name and columns. */
export function samePalette(a: PaletteData, b: PaletteData): boolean {
  if (a.name !== b.name || a.columns !== b.columns || a.cells.length !== b.cells.length) return false;
  return a.cells.every((c, i) => {
    const d = b.cells[i]!;
    return c.x === d.x && c.y === d.y && c.tilesetId === d.tilesetId && c.tileId === d.tileId && (c.flags ?? 0) === (d.flags ?? 0);
  });
}

/**
 * Changes the column count, keeping the slots in reading order (a 4-wide
 * row of 8 becomes two rows). Clamped to [{@link MIN_PALETTE_COLUMNS}, {@link MAX_PALETTE_COLUMNS}].
 */
export function setPaletteColumns(p: PaletteData, columns: number): PaletteData {
  const cols = Math.min(MAX_PALETTE_COLUMNS, Math.max(MIN_PALETTE_COLUMNS, Math.round(columns)));
  if (cols === p.columns) return p;
  const cells = sortCells(p.cells);
  // Reflow by reading order of the old grid, gaps included, so a layout survives a widen / narrow round trip when it fits.
  const moved = cells.map((c) => {
    const i = slotIndex(p.columns, c.x, c.y);
    return { ...c, x: i % cols, y: Math.floor(i / cols) };
  });
  return { ...p, columns: cols, cells: sortCells(moved) };
}

/**
 * The stamp of the selected slots `ids` (one tile layer `layerId`, layout
 * kept, holes empty). Null when no selected slot is filled. Slots whose
 * tileset `exists` says is gone are left out.
 */
export function paletteClip(p: PaletteData, ids: readonly number[], layerId = "tiles", exists: (tilesetId: string) => boolean = () => true): TileClip | null {
  const items = itemsOfSlots(p, ids).filter((it) => exists(it.tilesetId));
  return clipOfItems(items, layerId, p.name);
}

/** A one-layer clip of `items` (layout kept), or null when empty. */
export function clipOfItems(items: readonly PaletteItem[], layerId = "tiles", name = ""): TileClip | null {
  if (items.length === 0) return null;
  const x0 = Math.min(...items.map((i) => i.dx));
  const y0 = Math.min(...items.map((i) => i.dy));
  const width = Math.max(...items.map((i) => i.dx)) - x0 + 1;
  const height = Math.max(...items.map((i) => i.dy)) - y0 + 1;
  const cells = new Uint32Array(width * height);
  const palette: PaletteEntry[] = [];
  const local = new Map<string, number>();
  const ordered = [...items].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
  for (const it of ordered) {
    const k = `${it.tilesetId}\u0000${it.tileId}`;
    let index = local.get(k);
    if (index === undefined) {
      palette.push(Object.freeze({ tilesetId: it.tilesetId, tileId: it.tileId }));
      index = palette.length;
      local.set(k, index);
    }
    cells[(it.dy - y0) * width + (it.dx - x0)] = makeCell(index, it.flags ?? 0);
  }
  return Object.freeze({ width, height, palette: Object.freeze(palette), layers: Object.freeze([Object.freeze({ layerId, name, cells })]) });
}

/** A palette name not used yet: "Palet", "Palet 2", … */
export function uniquePaletteName(palettes: readonly Pick<PaletteData, "name">[], base: string): string {
  const taken = new Set(palettes.map((p) => p.name.toLocaleLowerCase()));
  if (!taken.has(base.toLocaleLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name.toLocaleLowerCase())) return name;
  }
}

/** A palette id not used yet ("palette-1", …). */
export function uniquePaletteId(palettes: readonly Pick<PaletteData, "id">[]): string {
  const taken = new Set(palettes.map((p) => p.id));
  for (let n = 1; ; n++) {
    const id = `palette-${n}`;
    if (!taken.has(id)) return id;
  }
}
