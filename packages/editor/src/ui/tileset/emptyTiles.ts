import type { TilesetBitmap } from "../../state/tilesetImages";
import { emptyTileIds, type Tileset } from "@smap/core";
import { useMemo } from "react";

import { readAlpha } from "../tilesetImport/imageAlpha";

const NONE: ReadonlySet<number> = new Set();
const cache = new WeakMap<TilesetBitmap, Map<string, ReadonlySet<number>>>();

/**
 * Fully transparent tiles of `tileset` in `bitmap` (core `emptyTileIds`),
 * cached per image and grid. The panel dims them and multi-tile picks skip them.
 */
export function emptyTilesOf(tileset: Tileset, bitmap: TilesetBitmap): ReadonlySet<number> {
  const key = `${tileset.tileWidth}x${tileset.tileHeight}:${tileset.margin}:${tileset.spacing}:${tileset.columns}x${tileset.rows}`;
  let byGrid = cache.get(bitmap);
  const hit = byGrid?.get(key);
  if (hit) return hit;
  let result: ReadonlySet<number> = NONE;
  // Same reader (and size cap) as the import card: a huge sheet is not scanned on the main thread.
  const alpha = readAlpha(bitmap);
  if (alpha) {
    try {
      result = emptyTileIds(tileset, { width: bitmap.width, height: bitmap.height, alpha });
    } catch (error) {
      console.warn("[tileset] cannot scan transparent tiles", error);
    }
  }
  if (!byGrid) {
    byGrid = new Map();
    cache.set(bitmap, byGrid);
  }
  byGrid.set(key, result);
  return result;
}

export function useEmptyTiles(tileset: Tileset, bitmap: TilesetBitmap | undefined): ReadonlySet<number> {
  const { tileWidth, tileHeight, margin, spacing, columns, rows } = tileset;
  return useMemo(
    () => (bitmap ? emptyTilesOf({ ...tileset, tileWidth, tileHeight, margin, spacing, columns, rows }, bitmap) : NONE),

    // eslint-disable-next-line react-hooks/exhaustive-deps -- only grid dimensions affect transparent tile detection
    [bitmap, tileWidth, tileHeight, margin, spacing, columns, rows],
  );
}
