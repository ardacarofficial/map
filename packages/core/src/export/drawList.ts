/**
 * What to draw, in order, to composite the map into one image (PNG export).
 * Core has no canvas; the editor draws these items onto a 2D canvas.
 */
import { cellFlags, cellPaletteIndex, FLIP_D, FLIP_H, FLIP_V } from "../cell";
import { chunkKey, CHUNK_SIZE } from "../chunk";
import { isValidTileId } from "../tileset";
import type { MapDocument } from "../document";
import { tileRect, type TileRect, type Tileset } from "../tileset";
import {
  EXPORT_FLIP_D,
  EXPORT_FLIP_H,
  EXPORT_FLIP_V,
  exportedLayers,
  exportedTilesets,
  exportWarnings,
  layerCells,
  type ExportLayerOptions,
  type ExportWarning,
} from "./common";

/**
 * One tile to draw. Coordinates in pixels, y down, origin top-left of the map.
 *
 * Orientation (Tiled's rule): the source tile is first transposed when
 * `flipD` (pixel `(u, v)` → `(v, u)`, so a `w × h` tile becomes `h × w`),
 * then mirrored horizontally (`flipH`) and vertically (`flipV`) inside the
 * destination rectangle. In source-pixel terms, for `W × H` = `dest` size:
 *
 * ```text
 * (u, v) → D ? (v, u) : (u, v) → x' = H ? W-1-x : x,  y' = V ? H-1-y : y
 * ```
 *
 * 90° clockwise = D+H, 180° = H+V, 90° counter-clockwise = D+V.
 */
export interface DrawItem {
  readonly tileset: Tileset;
  /** Source rectangle in the tileset image. */
  readonly src: TileRect;
  /**
   * Destination rectangle in the map image: the tile's size, transposed when
   * `flipD`. A tile larger than the map's cell is anchored bottom-left of its
   * cell (Tiled's rule).
   */
  readonly dest: TileRect;
  readonly flipH: boolean;
  readonly flipV: boolean;
  /** Diagonal flip (x/y swap), applied before `flipH` / `flipV`. */
  readonly flipD: boolean;
}

/** One visible layer's items; draw them with `globalAlpha = opacity`. */
export interface DrawLayer {
  readonly layerId: string;
  readonly opacity: number;
  readonly items: readonly DrawItem[];
}

export interface DrawList {
  /** Image size in pixels. */
  readonly width: number;
  readonly height: number;
  /** Visible tile layers with opacity > 0, bottom to top. */
  readonly layers: readonly DrawLayer[];
  /** Cells left out (missing tileset, tile id outside the image); see `exportWarnings`. */
  readonly warnings?: readonly ExportWarning[];
}

/**
 * Draw list of `doc` (hidden layers, grid layers and empty cells left out).
 * With `options.layers`, only those tile layers (still only the visible ones).
 */
export function layerDrawList(
  doc: MapDocument,
  options: ExportLayerOptions = {},
): DrawList {
  const { width, height, tileWidth, tileHeight } = doc.map;
  const images = exportedTilesets(doc, options.layers);
  const layers: DrawLayer[] = [];
  for (const layer of exportedLayers(doc, options.layers)) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const items = layerCells(doc, layer, images).map((c): DrawItem => {
      const tileset = images[c.tilesetIndex]!.tileset;
      const flipD = (c.flags & EXPORT_FLIP_D) !== 0;
      const w = flipD ? tileset.tileHeight : tileset.tileWidth;
      const h = flipD ? tileset.tileWidth : tileset.tileHeight;
      return {
        tileset,
        src: tileRect(tileset, c.tileId),
        dest: {
          x: c.x * tileWidth,
          y: (c.y + 1) * tileHeight - h,
          width: w,
          height: h,
        },
        flipH: (c.flags & EXPORT_FLIP_H) !== 0,
        flipV: (c.flags & EXPORT_FLIP_V) !== 0,
        flipD,
      };
    });
    layers.push({ layerId: layer.id, opacity: layer.opacity, items });
  }
  return {
    width: width * tileWidth,
    height: height * tileHeight,
    layers,
    warnings: exportWarnings(doc, options.layers),
  };
}

/** Regional draw list in crop-local pixels. Only intersecting sparse chunks are
 * inspected, including the halo required by oversized/transposed tile artwork. */
export function regionDrawList(
  doc: MapDocument,
  region: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  options: ExportLayerOptions = {},
): DrawList {
  const { x, y, width, height } = region;
  if (
    ![x, y, width, height].every(Number.isSafeInteger) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > doc.map.width ||
    y + height > doc.map.height
  )
    throw new RangeError("draw region outside map");
  const tw = doc.map.tileWidth,
    th = doc.map.tileHeight;
  const px = x * tw,
    py = y * th,
    w = width * tw,
    h = height * th;
  // D swaps width/height. Anchoring is bottom-left, so the necessary halo
  // extends left and below the requested cell rectangle.
  const largest = doc.tilesets.reduce(
    (n, t) => Math.max(n, t.tileWidth, t.tileHeight),
    1,
  );
  const x0 = Math.max(0, Math.floor((px - largest) / tw) + 1),
    x1 = x + width;
  const y0 = y,
    y1 = Math.min(doc.map.height, Math.ceil((py + h + largest) / th) - 1);
  const missing = new Set<string>(),
    invalid = new Map<string, Set<number>>();
  const layers: DrawLayer[] = [];
  for (const layer of exportedLayers(doc, options.layers)) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const items: { x: number; y: number; item: DrawItem }[] = [];
    for (let cy = y0 >> 5; cy <= (y1 - 1) >> 5; cy++)
      for (let cx = x0 >> 5; cx <= (x1 - 1) >> 5; cx++) {
        const chunk = layer.getChunkByKey(chunkKey(cx, cy));
        if (!chunk) continue;
        for (
          let ly = Math.max(y0, cy * CHUNK_SIZE);
          ly < Math.min(y1, (cy + 1) * CHUNK_SIZE);
          ly++
        )
          for (
            let lx = Math.max(x0, cx * CHUNK_SIZE);
            lx < Math.min(x1, (cx + 1) * CHUNK_SIZE);
            lx++
          ) {
            const cell =
              chunk.data[
                (ly - cy * CHUNK_SIZE) * CHUNK_SIZE + lx - cx * CHUNK_SIZE
              ]!;
            if (!cell) continue;
            const entry = doc.palette.get(cellPaletteIndex(cell));
            if (!entry) continue;
            const tileset = doc.getTileset(entry.tilesetId);
            if (!tileset) {
              missing.add(entry.tilesetId);
              continue;
            }
            if (!isValidTileId(tileset, entry.tileId)) {
              let ids = invalid.get(tileset.id);
              if (!ids) invalid.set(tileset.id, (ids = new Set()));
              ids.add(entry.tileId);
              continue;
            }
            const flags = cellFlags(cell),
              flipD = (flags & FLIP_D) !== 0;
            const dw = flipD ? tileset.tileHeight : tileset.tileWidth,
              dh = flipD ? tileset.tileWidth : tileset.tileHeight;
            const dx = lx * tw - px,
              dy = (ly + 1) * th - dh - py;
            if (dx >= w || dy >= h || dx + dw <= 0 || dy + dh <= 0) continue;
            items.push({
              x: lx,
              y: ly,
              item: {
                tileset,
                src: tileRect(tileset, entry.tileId),
                dest: { x: dx, y: dy, width: dw, height: dh },
                flipD,
                flipH: (flags & FLIP_H) !== 0,
                flipV: (flags & FLIP_V) !== 0,
              },
            });
          }
      }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    layers.push({
      layerId: layer.id,
      opacity: layer.opacity,
      items: items.map((i) => i.item),
    });
  }
  const warnings: ExportWarning[] = [];
  if (missing.size) {
    const tilesets = [...missing].sort();
    warnings.push({
      code: "missingTilesets",
      tilesets,
      message: `Cells of missing tilesets were skipped: ${tilesets.join(", ")}.`,
    });
  }
  for (const tileset of [...invalid.keys()].sort()) {
    const tileIds = [...invalid.get(tileset)!].sort((a, b) => a - b);
    warnings.push({
      code: "tileIdsOutOfRange",
      tileset,
      tileIds,
      message: `Cells with tile ids outside tileset "${tileset}" were skipped: ${tileIds.join(", ")}.`,
    });
  }
  return { width: w, height: h, layers, warnings };
}
