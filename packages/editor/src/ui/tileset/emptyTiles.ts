import { alphaFromRgba, emptyTileIds, type Tileset } from "@smap/core";
import { useMemo } from "react";

const NONE: ReadonlySet<number> = new Set();
const cache = new WeakMap<ImageBitmap, Map<string, ReadonlySet<number>>>();

/**
 * Fully transparent tiles of `tileset` in `bitmap` (core `emptyTileIds`),
 * cached per image and grid. The panel dims them and multi-tile picks skip them.
 */
export function emptyTilesOf(tileset: Tileset, bitmap: ImageBitmap): ReadonlySet<number> {
  const key = `${tileset.tileWidth}x${tileset.tileHeight}:${tileset.margin}:${tileset.spacing}:${tileset.columns}x${tileset.rows}`;
  let byGrid = cache.get(bitmap);
  const hit = byGrid?.get(key);
  if (hit) return hit;
  let result: ReadonlySet<number> = NONE;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx && bitmap.width > 0 && bitmap.height > 0) {
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      result = emptyTileIds(tileset, { width: bitmap.width, height: bitmap.height, alpha: alphaFromRgba(data, bitmap.width, bitmap.height) });
    }
  } catch (error) {
    // A closed bitmap or a tainted canvas: treat every tile as non-empty.
    console.warn("[tileset] cannot scan transparent tiles", error);
  }
  if (!byGrid) {
    byGrid = new Map();
    cache.set(bitmap, byGrid);
  }
  byGrid.set(key, result);
  return result;
}

export function useEmptyTiles(tileset: Tileset, bitmap: ImageBitmap | undefined): ReadonlySet<number> {
  const { tileWidth, tileHeight, margin, spacing, columns, rows } = tileset;
  return useMemo(
    () => (bitmap ? emptyTilesOf({ ...tileset, tileWidth, tileHeight, margin, spacing, columns, rows }, bitmap) : NONE),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the grid matters, not solid / terrain metadata
    [bitmap, tileWidth, tileHeight, margin, spacing, columns, rows],
  );
}
