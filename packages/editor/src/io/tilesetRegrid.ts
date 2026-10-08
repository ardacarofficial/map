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
  makeCell,
  tilesetGridRemap,
  tilesetImageExtent,
  type ClipLayer,
  type MapStore,
  type PaletteEntry,
  type Stamp,
  type TileGrid,
  type Tileset,
} from "@smap/core";

import type { ProjectFileSystem } from "./fs";
import type { LevelWorkspace } from "./levelWorkspace";

/** How tiles that land outside the new grid are treated (see the core ops). */
export type RegridMode = "grid" | "image";

const GRID_KEYS = ["tileWidth", "tileHeight", "margin", "spacing", "columns", "rows"] as const;

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

export interface StampRemap {
  stamp: Stamp;
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
export function remapStamp(stamp: Stamp, tilesetId: string, before: TileGrid, after: TileGrid, mode: RegridMode = regridMode(before, after)): StampRemap {
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
    stamp: Object.freeze({ ...stamp, palette: Object.freeze(palette), layers: Object.freeze(layers) }),
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
    if (level.id === ws.activeId) continue;
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
  /** Cells cleared in those levels (only when remapped, not by undo / redo). */
  clearedCells: number;
}

/**
 * Brings every cached non-active level to the active level's tileset grids
 * (see the module doc). Changed levels are marked dirty.
 */
export function syncLevelGrids(ws: LevelWorkspace): LevelSync {
  const active = ws.active.store.document;
  const out: LevelSync = { levels: [], clearedCells: 0 };
  for (const id of ws.cachedIds()) {
    if (id === ws.activeId) continue;
    const entry = ws.entry(id)!;
    let touched = false;
    for (const want of active.tilesets) {
      const have = entry.store.document.getTileset(want.id);
      if (!have || sameGrid(have, want)) continue;
      touched = true;
      out.clearedCells += followGrid(entry.store, want);
    }
    if (touched) {
      ws.markDirty(id);
      out.levels.push(id);
    }
  }
  return out;
}

/** Moves `store`'s copy of `want` to its grid; returns the cells cleared. */
function followGrid(store: MapStore, want: Tileset): number {
  const matches = () => {
    const ts = store.document.getTileset(want.id);
    return !!ts && sameGrid(ts, want);
  };
  if (store.inTransaction) store.commit();
  // The level's own history first: mirrors an undo / redo byte for byte.
  if (store.canUndo) {
    store.undo();
    if (matches()) return 0;
    store.redo();
  }
  if (store.canRedo) {
    store.redo();
    if (matches()) return 0;
    store.undo();
  }
  const have = store.document.getTileset(want.id)!;
  const extent = tilesetImageExtent(want);
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
  return result.clearedCells;
}
