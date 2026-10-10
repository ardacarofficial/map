/**
 * What to draw, in order, to composite the map into one image (PNG export).
 * Core has no canvas; the editor draws these items onto a 2D canvas.
 */
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
export function layerDrawList(doc: MapDocument, options: ExportLayerOptions = {}): DrawList {
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
        dest: { x: c.x * tileWidth, y: (c.y + 1) * tileHeight - h, width: w, height: h },
        flipH: (c.flags & EXPORT_FLIP_H) !== 0,
        flipV: (c.flags & EXPORT_FLIP_V) !== 0,
        flipD,
      };
    });
    layers.push({ layerId: layer.id, opacity: layer.opacity, items });
  }
  return { width: width * tileWidth, height: height * tileHeight, layers, warnings: exportWarnings(doc, options.layers) };
}
