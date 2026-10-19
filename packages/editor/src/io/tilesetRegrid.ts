/**
 * Project-wide tileset grid edits (tile size / margin / spacing, or a new
 * image size). Core's `updateTilesetGrid` / `replaceTilesetImage` remap the
 * palette of ONE document; tilesets are project data, so every level and
 * every saved stamp must follow, or the other levels would show the wrong
 * pixels once they pick up the new grid.
 *
 * The rule is "follow the active level": {@link syncLevelGrids} brings every
 * cached level to the active level's grid. It prefers the level's own undo /
 * redo (byte-exact: an edit and its undo in the active level are mirrored
 * exactly), and otherwise remaps with the same core op. Stamps are remapped
 * by the same pixel rule ({@link remapStamp}). The app calls the sync after
 * every tileset change of the active level, so Ctrl+Z / Ctrl+Y of a grid
 * edit is one step for the whole project.
 *
 * Pure (no React, no stores) so it runs in tests with an in-memory folder.
 */
import {
  cellFlags,
  cellPaletteIndex,
  isTileLayer,
  isValidTileId,
  makeCell,
  tilesetGridRemap,
  tilesetImageExtent,
  type ClipLayer,
  type MapStore,
  type PaletteEntry,
  type Stamp,
  type TileClip,
  type TileGrid,
  type Tileset,
} from "@smap/core";

import type { TileSelection } from "../state/editorStore";
import { isRecentStamp, recentKey, recentOfClip, type RecentItem } from "../state/recentItems";

import type { ProjectFileSystem } from "./fs";
import type { LevelWorkspace } from "./levelWorkspace";

/** How tiles that land outside the new grid are treated (see the core ops). */
export type RegridMode = "grid" | "image";

const GRID_KEYS = ["tileWidth", "tileHeight", "margin", "spacing", "columns", "rows"] as const;

/** The grid fields of a tileset (a plain copy). */
export const gridCopy = (g: TileGrid): TileGrid => ({
  tileWidth: g.tileWidth,
  tileHeight: g.tileHeight,
  margin: g.margin,
  spacing: g.spacing,
  columns: g.columns,
  rows: g.rows,
});

/** True when both grids slice the image the same way. */
export function sameGrid(a: TileGrid, b: TileGrid): boolean {
  return GRID_KEYS.every((k) => a[k] === b[k]);
}

/** A stable text key of a grid (`"16x16+0+0:6x4"`). */
export function gridKey(g: TileGrid): string {
  return `${g.tileWidth}x${g.tileHeight}+${g.margin}+${g.spacing}:${g.columns}x${g.rows}`;
}

/** `image` when only the image size changed (same tile size, margin, spacing), else `grid`. */
export function regridMode(before: TileGrid, after: TileGrid): RegridMode {
  return before.tileWidth === after.tileWidth &&
    before.tileHeight === after.tileHeight &&
    before.margin === after.margin &&
    before.spacing === after.spacing
    ? "image"
    : "grid";
}

export interface StampRemap<T extends TileClip = Stamp> {
  stamp: T;
  /** True when the stamp changed (palette or cells). */
  changed: boolean;
  /** Tile cells cleared because their tile has no place in the new grid. */
  clearedCells: number;
}

/**
 * `stamp` with the tiles of `tilesetId` moved from grid `before` to grid
 * `after` by pixel position (core `tilesetGridRemap`, the rule of the
 * `updateTilesetGrid` op). Tiles that map nowhere are cleared; with mode
 * `image` a tile beyond the new image keeps its id instead (out of range,
 * like `replaceTilesetImage` keeps it in levels). The clip palette is
 * rebuilt so it lists only used entries, without duplicates.
 */
export function remapStamp<T extends TileClip = Stamp>(
  stamp: T,
  tilesetId: string,
  before: TileGrid,
  after: TileGrid,
  mode: RegridMode = regridMode(before, after),
): StampRemap<T> {
  if (!stamp.palette.some((e) => e.tilesetId === tilesetId) || sameGrid(before, after)) {
    return { stamp, changed: false, clearedCells: 0 };
  }
  const remap = tilesetGridRemap(before, after);
  const newCount = after.columns * after.rows;
  // Old clip index (1-based) → the entry it becomes (null = cleared).
  const target: (PaletteEntry | null)[] = stamp.palette.map((entry) => {
    if (entry.tilesetId !== tilesetId) return entry;
    const to = remap(entry.tileId);
    if (to !== null) return to === entry.tileId ? entry : Object.freeze({ tilesetId, tileId: to });
    return mode === "image" && entry.tileId >= newCount ? entry : null;
  });
  const palette: PaletteEntry[] = [];
  const indexOf = new Map<string, number>();
  const newIndex = new Map<number, number>();
  let changed = false;
  let clearedCells = 0;
  const layers = stamp.layers.map((layer): ClipLayer => {
    if (layer.grid) return layer;
    const cells = new Uint32Array(layer.cells.length);
    for (let i = 0; i < cells.length; i++) {
      const cell = layer.cells[i]!;
      if (cell === 0) continue;
      const old = cellPaletteIndex(cell);
      let local = newIndex.get(old);
      if (local === undefined) {
        const entry = target[old - 1];
        if (!entry) {
          local = 0;
        } else {
          const key = `${entry.tilesetId}\u0000${entry.tileId}`;
          local = indexOf.get(key) ?? 0;
          if (local === 0) {
            palette.push(entry);
            local = palette.length;
            indexOf.set(key, local);
          }
        }
        newIndex.set(old, local);
      }
      if (local === 0) {
        clearedCells++;
        changed = true;
        continue;
      }
      if (local !== old) changed = true;
      cells[i] = makeCell(local, cellFlags(cell));
    }
    return Object.freeze({ ...layer, cells });
  });
  if (!changed && palette.length === stamp.palette.length && palette.every((e, i) => e === stamp.palette[i])) {
    return { stamp, changed: false, clearedCells: 0 };
  }
  return {
    stamp: Object.freeze({ ...stamp, palette: Object.freeze(palette), layers: Object.freeze(layers) }) as T,
    changed: true,
    clearedCells,
  };
}

export interface StampsRemap {
  stamps: Stamp[];
  /** Ids of the stamps that changed. */
  changed: string[];
  clearedCells: number;
}

/** {@link remapStamp} over a library; unchanged stamps keep their identity. */
export function remapStamps(stamps: readonly Stamp[], tilesetId: string, before: TileGrid, after: TileGrid): StampsRemap {
  const mode = regridMode(before, after);
  const changed: string[] = [];
  let clearedCells = 0;
  const out = stamps.map((stamp) => {
    const r = remapStamp(stamp, tilesetId, before, after, mode);
    if (r.changed) changed.push(stamp.id);
    clearedCells += r.clearedCells;
    return r.stamp;
  });
  return { stamps: out, changed, clearedCells };
}

/** A canonical text of a stamp (typed arrays as plain lists), to tell whether it changed. */
export function stampKey(stamp: TileClip): string {
  return JSON.stringify({ ...stamp, layers: stamp.layers.map((l) => ({ ...l, cells: Array.from(l.cells) })) });
}

/** What one grid change did to the stamp library: each changed stamp before and after. */
export interface StampRegrid {
  readonly tilesetId: string;
  readonly from: TileGrid;
  readonly to: TileGrid;
  readonly stamps: readonly { readonly id: string; readonly before: Stamp; readonly afterKey: string }[];
}

export interface StampGridSync {
  stamps: Stamp[];
  /** Stamps that changed. */
  changed: number;
  /** Stamps the reverted change had changed but that were edited since: remapped instead of restored. */
  kept: number;
  /** The record of this change (append it to the list), or `null` when nothing changed. */
  record: StampRegrid | null;
}

/**
 * The stamp library moved from grid `have` to grid `want` of `tilesetId`.
 * When `records` holds the change that led from `want` to `have` (an undo
 * or redo of a grid edit), every stamp it changed and that is still exactly
 * as it left it gets its earlier version back (lossless); stamps edited or
 * added since are remapped by pixel position like the edit itself.
 */
export function syncStampGrid(
  stamps: readonly Stamp[],
  tilesetId: string,
  have: TileGrid,
  want: TileGrid,
  records: readonly StampRegrid[],
): StampGridSync {
  const out: StampGridSync = { stamps: [...stamps], changed: 0, kept: 0, record: null };
  if (sameGrid(have, want)) return out;
  const revert = [...records].reverse().find((r) => r.tilesetId === tilesetId && sameGrid(r.to, have) && sameGrid(r.from, want));
  const mode = regridMode(have, want);
  const changes: { id: string; before: Stamp; afterKey: string }[] = [];
  out.stamps = stamps.map((stamp) => {
    const saved = revert?.stamps.find((s) => s.id === stamp.id);
    let next: Stamp;
    if (saved && stampKey(stamp) === saved.afterKey) {
      next = saved.before;
    } else {
      if (saved) out.kept++;
      next = remapStamp(stamp, tilesetId, have, want, mode).stamp;
    }
    if (next !== stamp) changes.push({ id: stamp.id, before: stamp, afterKey: stampKey(next) });
    return next;
  });
  out.changed = changes.length;
  if (changes.length > 0) out.record = { tilesetId, from: gridCopy(have), to: gridCopy(want), stamps: changes };
  return out;
}

/** The brush state that names tiles of a tileset by id (editor store fields). */
export interface BrushRefs {
  selection: TileSelection | null;
  randomSet: readonly { tilesetId: string; tileId: number; weight?: number }[];
  stamp: TileClip | null;
  recentTiles: readonly RecentItem[];
}

/**
 * The brush, random set, brush stamp and recent strip with the tiles of
 * `tilesetId` moved from grid `before` to grid `after` (the same pixel rule
 * as the levels and stamps), so that after a grid edit (or its undo) the
 * brush keeps painting the pixels the user picked. Tiles that map nowhere
 * are dropped (a selection becomes null, a stamp loses those cells and
 * becomes null when nothing is left). A saved stamp on the brush is
 * replaced by the library's copy with the same id when `library` has one.
 * Returns only the fields that changed.
 */
export function remapBrush(
  refs: BrushRefs,
  tilesetId: string,
  before: TileGrid,
  after: TileGrid,
  library: readonly Stamp[] = [],
): Partial<BrushRefs> {
  if (sameGrid(before, after)) return {};
  const remap = tilesetGridRemap(before, after);
  const count = after.columns * after.rows;
  const tileTo = (tileId: number): number | null => {
    const to = remap(tileId);
    return to !== null && to < count ? to : null;
  };
  const clipTo = (clip: TileClip): TileClip | null => {
    const id = (clip as Partial<Stamp>).id;
    const saved = typeof id === "string" ? library.find((s) => s.id === id) : undefined;
    if (saved) return saved;
    const r = remapStamp(clip, tilesetId, before, after, "grid");
    if (!r.changed) return clip;
    return recentOfClip(r.stamp) === null && !r.stamp.layers.some((l) => l.grid) ? null : r.stamp;
  };
  const out: Partial<BrushRefs> = {};
  const sel = refs.selection;
  if (sel && sel.tilesetId === tilesetId) {
    const to = tileTo(sel.tileId);
    out.selection = to === null ? null : { tilesetId, tileId: to };
  }
  if (refs.randomSet.some((r) => r.tilesetId === tilesetId)) {
    const next: BrushRefs["randomSet"][number][] = [];
    for (const r of refs.randomSet) {
      if (r.tilesetId !== tilesetId) next.push(r);
      else {
        const to = tileTo(r.tileId);
        if (to !== null && !next.some((n) => n.tilesetId === tilesetId && n.tileId === to)) next.push({ ...r, tileId: to });
      }
    }
    out.randomSet = next;
  }
  if (refs.stamp) {
    const next = clipTo(refs.stamp);
    if (next !== refs.stamp) out.stamp = next;
  }
  let recentChanged = false;
  const recent: RecentItem[] = [];
  const keys = new Set<string>();
  for (const item of refs.recentTiles) {
    let next: RecentItem | null = item;
    if (isRecentStamp(item)) {
      const clip = clipTo(item.stamp);
      next = clip === item.stamp ? item : clip ? recentOfClip(clip) : null;
    } else if (item.tilesetId === tilesetId) {
      const to = tileTo(item.tileId);
      next = to === null ? null : to === item.tileId ? item : { tilesetId, tileId: to };
    }
    if (next !== item) recentChanged = true;
    if (!next) continue;
    const key = recentKey(next);
    if (keys.has(key)) {
      recentChanged = true;
      continue;
    }
    keys.add(key);
    recent.push(next);
  }
  if (recentChanged) out.recentTiles = recent;
  return out;
}

/** True when a stamp uses a tile of `tilesetId`. */
export function stampUsesTileset(stamp: Stamp, tilesetId: string): boolean {
  return stamp.palette.some((e) => e.tilesetId === tilesetId);
}

/**
 * Loads every level of the project into memory and pins it, so that a grid
 * edit can be applied to all of them and follow undo / redo for the rest of
 * the session. Returns the names of levels that could not be read.
 * Call it BEFORE the active level changes its grid (levels read from disk
 * are parsed with the active level's tilesets).
 */
export async function loadAllLevels(ws: LevelWorkspace, fs: ProjectFileSystem | null): Promise<string[]> {
  const failed: string[] = [];
  for (const level of ws.levels) {
    if (level.id === ws.activeId) { ws.pin(level.id); continue; }
    try {
      await ws.load(level.id, fs);
      ws.pin(level.id);
    } catch {
      // A level that is not on disk yet is always cached; anything else is unreadable.
      if (!ws.entry(level.id)) failed.push(level.name);
    }
  }
  return failed;
}

export interface LevelSync {
  /** Ids of levels whose grid was brought to the active level's. */
  levels: string[];
  /** Cells cleared in those levels (tiles with no place in the new grid). */
  clearedCells: number;
  /** Cells an earlier grid edit cleared (or changed) that came back exactly. */
  restoredCells: number;
  /**
   * Cells an earlier grid edit changed that were painted again since: an
   * undo of that edit leaves them as they are (the new paint wins).
   */
  keptCells: number;
}

/** A cell a grid edit changed in a level: raw values plus the tile it held before. */
interface RegridCell {
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  /** Raw cell after the edit ("untouched since" = still this value). */
  readonly after: number;
  /** What the cell showed before the edit (`null` = empty). */
  readonly before: { readonly tilesetId: string; readonly tileId: number; readonly flags: number } | null;
}

/**
 * What one grid change did to one level, recorded right after it: the
 * exact cell patch (before as tiles, after as raw values), the tileset on
 * both sides, and the level's own history step for it. Lets the change be
 * reverted later without loss although the level was edited in between
 * (see {@link followGrid}).
 */
interface LevelRegrid {
  readonly tilesetId: string;
  readonly from: TileGrid;
  readonly to: TileGrid;
  readonly cells: readonly RegridCell[];
  /** The level's history step that made the change (`HistoryEntry.id`), if any. */
  readonly entryId: number | undefined;
}

/** Recorded grid changes per level store (newest last). */
const levelRecords = new WeakMap<MapStore, LevelRegrid[]>();
/** Records kept per store (each grid edit adds one). */
const MAX_RECORDS = 64;

/**
 * Records the grid change of `tilesetId` that `store` just committed as its
 * top history step (`before` = the tileset before it). Called for the
 * active level's own edit and for every level that followed it, so that
 * whichever level is open later, the others can revert it losslessly.
 */
export function recordRegrid(store: MapStore, tilesetId: string, before: TileGrid): void {
  const after = store.document.getTileset(tilesetId);
  if (!after || sameGrid(before, after)) return;
  const entry = store.peekUndo();
  const doc = store.document;
  const cells: RegridCell[] = [];
  if (entry) {
    // Palette indices the step rewrote: the tile they named before it.
    const rewritten = new Map<number, PaletteEntry>();
    for (const change of entry.changes) {
      if (change.kind === "palette") for (const e of change.entries) if (!rewritten.has(e.index)) rewritten.set(e.index, e.before);
    }
    for (const patch of entry.patches) {
      if (!isTileLayer(doc.getLayer(patch.layerId))) continue;
      for (const c of patch.cells) {
        let tile: RegridCell["before"] = null;
        if (c.before !== 0) {
          const index = cellPaletteIndex(c.before);
          const named = rewritten.get(index) ?? doc.palette.get(index);
          if (named) tile = { tilesetId: named.tilesetId, tileId: named.tileId, flags: cellFlags(c.before) };
        }
        cells.push({ layerId: patch.layerId, x: c.x, y: c.y, after: c.after, before: tile });
      }
    }
  }
  const list = levelRecords.get(store) ?? [];
  list.push({ tilesetId, from: gridCopy(before), to: gridCopy(after), cells, entryId: entry?.id });
  if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS);
  levelRecords.set(store, list);
}

/**
 * Brings every cached non-active level to the active level's tileset grids
 * (see the module doc). Changed levels are marked dirty.
 */
export function syncLevelGrids(ws: LevelWorkspace): LevelSync {
  const active = ws.active.store.document;
  const out: LevelSync = { levels: [], clearedCells: 0, restoredCells: 0, keptCells: 0 };
  for (const id of ws.cachedIds()) {
    if (id === ws.activeId) continue;
    const entry = ws.entry(id)!;
    let touched = false;
    for (const want of active.tilesets) {
      const have = entry.store.document.getTileset(want.id);
      if (!have || sameGrid(have, want)) continue;
      touched = true;
      const r = followGrid(entry.store, want, !ws.history.collecting);
      out.clearedCells += r.cleared;
      out.restoredCells += r.restored;
      out.keptCells += r.kept;
    }
    if (touched) {
      ws.markDirty(id);
      out.levels.push(id);
    }
  }
  return out;
}

interface FollowResult {
  cleared: number;
  restored: number;
  kept: number;
}

function followGrid(store: MapStore, want: Tileset, reuseHistory: boolean): FollowResult {
  const out: FollowResult = { cleared: 0, restored: 0, kept: 0 };
  const records = levelRecords.get(store) ?? [];
  const current = () => store.document.getTileset(want.id)!;
  const matches = () => sameGrid(current(), want);
  if (store.inTransaction) store.commit();
  const have = gridCopy(current());

  // 1. The level's own step for this very change.
  const top = store.peekUndo();
  if (reuseHistory && top && records.some((r) => r.entryId === top.id && r.tilesetId === want.id && sameGrid(r.to, have) && sameGrid(r.from, want))) {
    store.undo();
    if (matches()) return out;
    store.redo();
  }
  const next = store.peekRedo();
  if (reuseHistory && next && records.some((r) => r.entryId === next.id && r.tilesetId === want.id && sameGrid(r.from, have) && sameGrid(r.to, want))) {
    store.redo();
    if (matches()) return out;
    store.undo();
  }
  // Unrecorded history (the level made the edit itself before records existed): try its top steps.
  if (reuseHistory && store.canUndo && !records.some((r) => r.entryId === store.peekUndo()?.id)) {
    store.undo();
    if (matches()) return out;
    store.redo();
  }
  if (reuseHistory && store.canRedo && !records.some((r) => r.entryId === store.peekRedo()?.id)) {
    store.redo();
    if (matches()) return out;
    store.undo();
  }

  // 2. / 3. One undo step: the core op, then the exact cells of the change it reverts.
  const revert = [...records].reverse().find((r) => r.tilesetId === want.id && sameGrid(r.to, have) && sameGrid(r.from, want));
  const doc = store.document;
  const back: RegridCell[] = [];
  if (revert) {
    for (const cell of revert.cells) {
      const layer = doc.getLayer(cell.layerId);
      if (isTileLayer(layer) && doc.inBounds(cell.x, cell.y) && layer.getCell(cell.x, cell.y) === cell.after) back.push(cell);
      else out.kept++;
    }
  }
  const extent = tilesetImageExtent(want);
  store.beginTransaction();
  try {
    const result =
      regridMode(have, want) === "image"
        ? store.dispatch({ type: "replaceTilesetImage", tilesetId: want.id, imageWidth: extent.width, imageHeight: extent.height })
        : store.dispatch({
            type: "updateTilesetGrid",
            tilesetId: want.id,
            tileWidth: want.tileWidth,
            tileHeight: want.tileHeight,
            margin: want.margin,
            spacing: want.spacing,
            imageWidth: extent.width,
            imageHeight: extent.height,
          });
    out.cleared = result.clearedCells;
    out.restored = restoreCells(store, back);
    out.kept += back.length - out.restored;
    store.commit();
  } catch (error) {
    store.rollback();
    throw error;
  }
  recordRegrid(store, want.id, have);
  return out;
}

/** Writes each cell's `before` tile (layer by layer, unlocking a locked layer for the write); returns how many were written. */
function restoreCells(store: MapStore, cells: readonly RegridCell[]): number {
  if (cells.length === 0) return 0;
  const doc = store.document;
  const byLayer = new Map<string, { x: number; y: number; cell: number }[]>();
  let written = 0;
  for (const c of cells) {
    let value = 0;
    if (c.before) {
      const tileset = doc.getTileset(c.before.tilesetId);
      if (!tileset || !isValidTileId(tileset, c.before.tileId)) continue;
      value = makeCell(store.getOrAddPaletteIndex(c.before.tilesetId, c.before.tileId), c.before.flags);
    }
    let list = byLayer.get(c.layerId);
    if (!list) byLayer.set(c.layerId, (list = []));
    list.push({ x: c.x, y: c.y, cell: value });
  }
  for (const [layerId, list] of byLayer) {
    const layer = doc.getLayer(layerId);
    if (!isTileLayer(layer)) continue;
    const locked = layer.locked;
    if (locked) store.dispatch({ type: "setLayerProps", layerId, props: { locked: false } });
    store.dispatch({ type: "paintCells", layerId, cells: list });
    if (locked) store.dispatch({ type: "setLayerProps", layerId, props: { locked: true } });
    written += list.length;
  }
  return written;
}

// ------------------------------------------------------------------ tileset list (add / remove / name / group / order)

/**
 * The library itself is project data too: which tilesets exist, their
 * order, name and group. Every level's document holds a copy; after a
 * change in the active level (one undo step there) {@link syncLevelLists}
 * brings every cached level to the same list, the same way grid edits
 * follow: the level's own recorded step is undone / redone when it is the
 * exact mirror (byte-exact, also for a removed tileset's cleared cells),
 * otherwise the core ops apply the difference (one undo step, recorded).
 * Remove a tileset only after {@link loadAllLevels}: a level read from disk
 * later would refer to a tileset that no longer exists.
 */

/** A text key of the tileset list: ids in order with name and group (not the grid: that follows separately). */
export function tilesetListKey(tilesets: readonly Pick<Tileset, "id" | "name" | "group">[]): string {
  return JSON.stringify(tilesets.map((ts) => [ts.id, ts.name, ts.group ?? ""]));
}

/** One list change a level made (its own edit or a follow), with its history step. */
interface ListRecord {
  readonly from: string;
  readonly to: string;
  readonly entryId: number | undefined;
}

const listRecords = new WeakMap<MapStore, ListRecord[]>();

/**
 * Records that `store`'s top history step changed its tileset list from
 * `fromKey` (a {@link tilesetListKey} taken before). Called for the active
 * level's own edit and for every level that followed, so whichever level
 * is open later, the others can mirror its undo exactly.
 */
export function recordListChange(store: MapStore, fromKey: string): void {
  const to = tilesetListKey(store.document.tilesets);
  if (to === fromKey) return;
  const list = listRecords.get(store) ?? [];
  list.push({ from: fromKey, to, entryId: store.peekUndo()?.id });
  if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS);
  listRecords.set(store, list);
}

export interface ListSync {
  /** Ids of levels whose list was brought to the active level's. */
  levels: string[];
}

/** Brings every cached non-active level to the active level's tileset list (see above). Changed levels are marked dirty. */
export function syncLevelLists(ws: LevelWorkspace): ListSync {
  const want = ws.active.store.document.tilesets;
  const wantKey = tilesetListKey(want);
  const out: ListSync = { levels: [] };
  for (const id of ws.cachedIds()) {
    if (id === ws.activeId) continue;
    const entry = ws.entry(id)!;
    const listChanged = tilesetListKey(entry.store.document.tilesets) !== wantKey;
    if (listChanged) followList(entry.store, want, !ws.history.collecting);
    let provenanceChanged = false;
    for (const ts of want) {
      const have = entry.store.document.getTileset(ts.id);
      if (ts.generated && have?.generated && JSON.stringify(ts.generated) !== JSON.stringify(have.generated)) {
        entry.store.dispatch({ type: "setTilesetMeta", tilesetId: ts.id, generated: ts.generated, undoable: false });
        provenanceChanged = true;
      }
    }
    if (listChanged || provenanceChanged) {
      ws.markDirty(id);
      out.levels.push(id);
    }
  }
  return out;
}

/** Moves `store`'s tileset list to `want` (its own recorded step first, else the core ops). */
function followList(store: MapStore, want: readonly Tileset[], reuseHistory: boolean): void {
  if (store.inTransaction) store.commit();
  const wantKey = tilesetListKey(want);
  const records = listRecords.get(store) ?? [];
  const key = () => tilesetListKey(store.document.tilesets);
  const haveKey = key();
  const top = store.peekUndo();
  if (reuseHistory && top && records.some((r) => r.entryId === top.id && r.to === haveKey && r.from === wantKey)) {
    store.undo();
    if (key() === wantKey) return;
    store.redo();
  }
  const next = store.peekRedo();
  if (reuseHistory && next && records.some((r) => r.entryId === next.id && r.from === haveKey && r.to === wantKey)) {
    store.redo();
    if (key() === wantKey) return;
    store.undo();
  }
  const doc = store.document;
  const wantIds = new Set(want.map((ts) => ts.id));
  store.beginTransaction();
  try {
    for (const ts of [...doc.tilesets]) if (!wantIds.has(ts.id)) store.dispatch({ type: "removeTileset", tilesetId: ts.id });
    for (const ts of want) if (!doc.getTileset(ts.id)) store.dispatch({ type: "addTileset", tileset: ts });
    for (const ts of want) {
      const have = doc.getTileset(ts.id)!;
      if (have.name !== ts.name || (have.group ?? "") !== (ts.group ?? "")) {
        store.dispatch({ type: "setTilesetMeta", tilesetId: ts.id, name: ts.name, group: ts.group ?? null });
      }
    }
    want.forEach((ts, index) => {
      if (doc.tilesets[index]?.id !== ts.id) store.dispatch({ type: "moveTileset", tilesetId: ts.id, index });
    });
    store.commit();
  } catch (error) {
    store.rollback();
    throw error;
  }
  recordListChange(store, haveKey);
}

/**
 * The brush state without anything that names a tile of a tileset that
 * is gone (`exists` says which tilesets remain): the selection, random set
 * entries, a brush stamp or recent stamp using it, recent tiles. Returns
 * only the fields that changed.
 */
export function dropTilesetRefs(refs: BrushRefs, exists: (tilesetId: string) => boolean): Partial<BrushRefs> {
  const out: Partial<BrushRefs> = {};
  const clipOk = (clip: TileClip) => clip.palette.every((e) => exists(e.tilesetId));
  if (refs.selection && !exists(refs.selection.tilesetId)) out.selection = null;
  if (refs.randomSet.some((r) => !exists(r.tilesetId))) out.randomSet = refs.randomSet.filter((r) => exists(r.tilesetId));
  if (refs.stamp && !clipOk(refs.stamp)) out.stamp = null;
  const recent = refs.recentTiles.filter((item) => (isRecentStamp(item) ? clipOk(item.stamp) : exists(item.tilesetId)));
  if (recent.length !== refs.recentTiles.length) out.recentTiles = recent;
  return out;
}

/** A tile reference held outside the documents (the palette clipboard, a drag): only tileset + tile id matter here. */
export interface TileRef {
  readonly tilesetId: string;
  readonly tileId: number;
}

/**
 * Palette references after a grid edit of `tilesetId` (`before` → `after`,
 * same pixel rule as levels and stamps): moved tiles get their new id,
 * tiles that map nowhere are dropped. Returns `refs` itself when nothing
 * changes. Core remaps the documents' collections and random sets inside
 * the grid op; this is for copies the editor keeps (the palette clipboard).
 */
export function remapTileRefs<T extends TileRef>(refs: readonly T[], tilesetId: string, before: TileGrid, after: TileGrid): readonly T[] {
  if (sameGrid(before, after) || !refs.some((r) => r.tilesetId === tilesetId)) return refs;
  const remap = tilesetGridRemap(before, after);
  const count = after.columns * after.rows;
  let changed = false;
  const out: T[] = [];
  for (const r of refs) {
    if (r.tilesetId !== tilesetId) {
      out.push(r);
      continue;
    }
    const to = remap(r.tileId);
    if (to === r.tileId) out.push(r);
    else {
      changed = true;
      if (to !== null && to < count) out.push({ ...r, tileId: to });
    }
  }
  return changed ? out : refs;
}

/** `refs` without tiles of tilesets that are gone (`refs` itself when nothing is dropped). */
export function dropTileRefs<T extends TileRef>(refs: readonly T[], exists: (tilesetId: string) => boolean): readonly T[] {
  return refs.every((r) => exists(r.tilesetId)) ? refs : refs.filter((r) => exists(r.tilesetId));
}
