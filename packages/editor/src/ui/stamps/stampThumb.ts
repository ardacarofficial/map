/**
 * Stamp thumbnails: a stamp's tile layers composited into a small canvas.
 * Reuses the PNG export's compositing (`compositeOps` / `replayOps`), so
 * flips, rotations (FLIP_D) and oversized tiles look the same as in an exported image.
 * Grid layers (terrain / collision) carry no pixels and are not drawn.
 */
import { cellFlags, cellPaletteIndex, FLIP_D, FLIP_H, FLIP_V, tileRect, type DrawLayer, type DrawList, type Stamp, type TileClip, type Tileset } from "@smap/core";

import { compositeOps, type CanvasOp } from "../../export/pngComposite";
import { replayOps } from "../../export/pngRender";

/** Draw list of a stamp's tile layers in its own pixel space (cell = `tileWidth × tileHeight`). */
export function stampDrawList(
  stamp: TileClip,
  tileWidth: number,
  tileHeight: number,
  tileset: (id: string) => Tileset | undefined,
): DrawList {
  const layers: DrawLayer[] = [];
  for (const layer of stamp.layers) {
    if (layer.grid) continue;
    const items: DrawLayer["items"][number][] = [];
    for (let i = 0; i < layer.cells.length; i++) {
      const cell = layer.cells[i]!;
      if (cell === 0) continue;
      const entry = stamp.palette[cellPaletteIndex(cell) - 1];
      const ts = entry ? tileset(entry.tilesetId) : undefined;
      if (!entry || !ts) continue;
      const src = tileRect(ts, entry.tileId);
      const cx = i % stamp.width;
      const cy = Math.floor(i / stamp.width);
      const flags = cellFlags(cell);
      // Rotated tiles (FLIP_D): the source is transposed first, so the destination is `h × w` (as in export).
      const flipD = (flags & FLIP_D) !== 0;
      const w = flipD ? src.height : src.width;
      const h = flipD ? src.width : src.height;
      items.push({
        tileset: ts,
        src,
        // Oversized tiles sit on the bottom-left of their cell (Tiled's rule, as in export).
        dest: { x: cx * tileWidth, y: (cy + 1) * tileHeight - h, width: w, height: h },
        flipH: (flags & FLIP_H) !== 0,
        flipV: (flags & FLIP_V) !== 0,
        flipD,
      });
    }
    layers.push({ layerId: layer.layerId, opacity: 1, items });
  }
  return { width: stamp.width * tileWidth, height: stamp.height * tileHeight, layers };
}

/**
 * Scale that fits a `width × height` image into a `boxW × boxH` box: whole
 * multiples when it is smaller (crisp pixels, at most `maxScale`), a plain
 * fraction when it must shrink.
 */
export function thumbScale(width: number, height: number, boxW: number, boxH: number, maxScale = 4): number {
  if (width <= 0 || height <= 0) return 1;
  const fit = Math.min(boxW / width, boxH / height);
  return fit >= 1 ? Math.min(maxScale, Math.floor(fit)) : fit;
}

/** Number of tile and grid layers in a stamp. */
export function stampLayerCounts(stamp: Stamp): { tile: number; grid: number } {
  let grid = 0;
  for (const l of stamp.layers) if (l.grid) grid++;
  return { tile: stamp.layers.length - grid, grid };
}

interface CachedThumb {
  key: string;
  canvas: HTMLCanvasElement;
}

const cache = new WeakMap<TileClip, CachedThumb>();

/**
 * The thumbnail of `stamp` at device resolution, cached per stamp object.
 * `key` must change when anything it depends on changes (tileset images,
 * box size); a cached thumbnail with another key is redrawn.
 */
export function stampThumbnail(
  stamp: TileClip,
  key: string,
  box: { width: number; height: number },
  tileWidth: number,
  tileHeight: number,
  tileset: (id: string) => Tileset | undefined,
  image: (tilesetId: string) => CanvasImageSource | undefined,
): HTMLCanvasElement {
  const hit = cache.get(stamp);
  if (hit && hit.key === key) return hit.canvas;
  const list = stampDrawList(stamp, tileWidth, tileHeight, tileset);
  const scale = thumbScale(list.width, list.height, box.width, box.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(list.width * scale));
  canvas.height = Math.max(1, Math.round(list.height * scale));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const ops: CanvasOp[] = compositeOps(list, scale);
    replayOps(ctx, ops, image);
  }
  cache.set(stamp, { key, canvas });
  return canvas;
}
