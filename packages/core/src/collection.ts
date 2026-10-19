/**
 * Collections ("paletler", round 4): the user's own tile sections. A
 * collection is a small grid of **references** to tileset tiles — no pixels
 * of its own — that the user arranges freely (copy tiles in from any
 * tileset, move them around) and then picks from like from a tileset.
 *
 * Collections are **project-level data**, like tilesets, entity types and
 * random sets: saved in `project.smap` (`collections`), carried by every
 * open level's document (`document.collections`), changed with the undoable
 * `setCollection` / `removeCollection` ops (see `randomSet.ts` for the
 * cross-level sync expectation). Removing a tileset drops its tiles from
 * every collection in the same undo step; tileset grid edits remap them.
 * Exporters ignore collections.
 */
import { CELL_FLAG_MASK, makeCell } from "./cell";
import type { ClipLayer, TileClip } from "./clip";
import type { PaletteEntry } from "./palette";

/** One cell of a collection: a tileset tile (with optional flip bits) at (`x`, `y`). */
export interface CollectionCell {
  /** Column, `0 ≤ x < columns`. */
  readonly x: number;
  /** Row, `≥ 0` (collections grow downwards). */
  readonly y: number;
  readonly tilesetId: string;
  readonly tileId: number;
  /** Cell flip bits (`FLIP_H | FLIP_V | FLIP_D`); default 0. */
  readonly flags?: number;
}

/** A collection. `cells` are sorted by `y`, then `x`; a position holds at most one cell. */
export interface Collection {
  /** Unique within the project; any non-empty string (≤ 128 chars). */
  readonly id: string;
  readonly name: string;
  /** Display width in cells, `[1, MAX_COLLECTION_COLUMNS]`. */
  readonly columns: number;
  /** Explicit persisted height. Omitted only by pre-v6 API callers; normalization fills it. */
  readonly rows?: number;
  readonly cells: readonly CollectionCell[];
}

/** Widest collection. */
export const MAX_COLLECTION_COLUMNS = 256;
export const MAX_COLLECTION_ROWS = 256;
export const MAX_COLLECTION_CAPACITY = 65536;
/** Most cells in one collection. */
export const MAX_COLLECTION_CELLS = 65536;

/** Why `collection` is not valid, or `null`. Order of `cells` does not matter here. */
export function collectionProblem(collection: Collection, allowLegacyOversize = false): string | null {
  if (typeof collection !== "object" || collection === null) return "collection must be an object";
  const { id, name, columns, cells } = collection;
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return "collection id must be a non-empty string of at most 128 characters";
  if (typeof name !== "string") return `collection "${id}": name must be a string`;
  if (!Number.isInteger(columns) || columns < 1 || columns > MAX_COLLECTION_COLUMNS) {
    return `collection "${id}": columns must be an integer in [1, ${MAX_COLLECTION_COLUMNS}]`;
  }
  if (!Array.isArray(cells)) return `collection "${id}": cells must be an array`;
  if (cells.length > MAX_COLLECTION_CELLS) return `collection "${id}": more than ${MAX_COLLECTION_CELLS} cells`;
  const rows = collection.rows === undefined ? Math.max(2, collectionRows(collection) + 1) : collection.rows;
  const legacy = allowLegacyOversize && rows <= MAX_COLLECTION_CELLS + 2;
  if (!Number.isInteger(rows) || rows < 1 || (!legacy && rows > MAX_COLLECTION_ROWS)) return `collection "${id}": rows must be an integer in [1, ${MAX_COLLECTION_ROWS}]`;
  if (!legacy && columns * rows > MAX_COLLECTION_CAPACITY) return `collection "${id}": capacity exceeds ${MAX_COLLECTION_CAPACITY}`;
  const seen = new Set<number>();
  for (const [i, c] of cells.entries()) {
    const at = `collection "${id}" cell ${i}`;
    if (typeof c !== "object" || c === null) return `${at}: must be an object`;
    if (!Number.isInteger(c.x) || c.x < 0 || c.x >= columns) return `${at}: x must be an integer in [0, ${columns - 1}]`;
    if (!Number.isInteger(c.y) || c.y < 0 || c.y > MAX_COLLECTION_CELLS) return `${at}: y must be an integer ≥ 0`;
    if (c.y >= rows) return `${at}: row outside collection bounds`;
    if (typeof c.tilesetId !== "string" || c.tilesetId.length === 0) return `${at}: tilesetId must be a non-empty string`;
    if (!Number.isInteger(c.tileId) || c.tileId < 0) return `${at}: tileId must be an integer ≥ 0`;
    const flags = c.flags ?? 0;
    if (!Number.isInteger(flags) || flags < 0 || (flags & ~CELL_FLAG_MASK) !== 0) return `${at}: flags may only hold flip bits`;
    const key = c.y * MAX_COLLECTION_COLUMNS + c.x;
    if (seen.has(key)) return `${at}: two cells at (${c.x}, ${c.y})`;
    seen.add(key);
  }
  return null;
}

/** Problem with a whole list (each valid, ids unique), or `null`. */
export function collectionsProblem(collections: readonly Collection[]): string | null {
  const ids = new Set<string>();
  for (const c of collections) {
    const problem = collectionProblem(c, true);
    if (problem) return problem;
    if (ids.has(c.id)) return `duplicate collection id "${c.id}"`;
    ids.add(c.id);
  }
  return null;
}

/** Canonical frozen copy: cells sorted by `y`, then `x`, fixed key order, `flags` 0 left out. Does not validate. */
export function normalizeCollection(collection: Collection): Collection {
  const cells = [...collection.cells]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((c): CollectionCell => {
      const flags = (c.flags ?? 0) >>> 0;
      return Object.freeze({ x: c.x, y: c.y, tilesetId: c.tilesetId, tileId: c.tileId, ...(flags !== 0 ? { flags } : {}) });
    });
  return Object.freeze({ id: collection.id, name: collection.name, columns: collection.columns, rows: collection.rows === undefined ? Math.max(2, collectionRows(collection) + 1) : collection.rows, cells: Object.freeze(cells) });
}

/** Number of rows in use (`max y + 1`, 0 when empty). */
export function collectionRows(collection: Collection): number {
  let rows = 0;
  for (const c of collection.cells) rows = Math.max(rows, c.y + 1);
  return rows;
}

/** The cell at (`x`, `y`), or `undefined`. */
export function collectionCellAt(collection: Collection, x: number, y: number): CollectionCell | undefined {
  return collection.cells.find((c) => c.x === x && c.y === y);
}

/** A rectangle of collection cells: top-left (`x`, `y`) and size `w` × `h`. */
export interface CollectionRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CollectionClipOptions {
  /** Layer id of the single clip layer. Defaults to `"tiles"`. */
  readonly layerId?: string;
}

/**
 * A one-layer clip from part of a collection (`rect`, or a list of
 * positions): the selected cells keep their relative layout inside their
 * bounding box and their flip bits; holes and empty positions stay empty.
 * The clip palette lists tiles row-major in first-use order. `null` when
 * nothing is selected.
 */
export function collectionClip(
  collection: Collection,
  selection: CollectionRect | readonly { readonly x: number; readonly y: number }[],
  options: CollectionClipOptions = {},
): TileClip | null {
  const wanted = new Set<string>();
  if (Array.isArray(selection)) {
    for (const p of selection as readonly { x: number; y: number }[]) wanted.add(`${p.x},${p.y}`);
  } else {
    const r = selection as CollectionRect;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) wanted.add(`${x},${y}`);
  }
  const picked = collection.cells.filter((c) => wanted.has(`${c.x},${c.y}`));
  if (picked.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of picked) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const data = new Uint32Array(width * height);
  const palette: PaletteEntry[] = [];
  const local = new Map<string, number>();
  for (const c of [...picked].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const key = `${c.tileId}:${c.tilesetId}`;
    let index = local.get(key);
    if (index === undefined) {
      palette.push(Object.freeze({ tilesetId: c.tilesetId, tileId: c.tileId }));
      index = palette.length;
      local.set(key, index);
    }
    data[(c.y - minY) * width + (c.x - minX)] = makeCell(index, c.flags ?? 0);
  }
  const layer: ClipLayer = Object.freeze({ layerId: options.layerId ?? "tiles", name: collection.name, cells: data });
  return Object.freeze({ width, height, palette: Object.freeze(palette), layers: Object.freeze([layer]) });
}

/**
 * The collections with cells of `tilesetId` remapped through `remap`
 * (`null` = the tile is gone → the cell is dropped; the collection itself
 * stays, possibly empty). Returns the input array itself when nothing
 * changes. Used by `removeTileset` (every tile gone) and tileset grid edits.
 */
export function remapCollectionsForTileset(
  collections: readonly Collection[],
  tilesetId: string,
  remap: (tileId: number) => number | null,
): readonly Collection[] {
  let changed = false;
  const out = collections.map((collection) => {
    let mine = false;
    const cells: CollectionCell[] = [];
    for (const c of collection.cells) {
      if (c.tilesetId !== tilesetId) {
        cells.push(c);
        continue;
      }
      const to = remap(c.tileId);
      if (to === c.tileId) {
        cells.push(c);
        continue;
      }
      mine = true;
      if (to !== null) cells.push({ ...c, tileId: to });
    }
    if (!mine) return collection;
    changed = true;
    return normalizeCollection({ ...collection, cells });
  });
  return changed ? out : collections;
}
