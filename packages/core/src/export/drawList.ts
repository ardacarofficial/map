/**
 * What to draw, in order, to composite the map into one image (PNG export).
 * Core has no canvas; the editor draws these items onto a 2D canvas.
 */
import type { MapDocument } from "../document";
import { tileRect, type TileRect, type Tileset } from "../tileset";
import { EXPORT_FLIP_H, EXPORT_FLIP_V, exportedLayers, exportedTilesets, exportWarnings, layerCells } from "./common";

/** One tile to draw. Coordinates in pixels, y down, origin top-left of the map. */
export interface DrawItem {
  readonly tileset: Tileset;
  /** Source rectangle in the tileset image. */
  readonly src: TileRect;
  /**
   * Destination rectangle in the map image. A tile larger than the map's
   * cell is anchored bottom-left of its cell (Tiled's rule).
   */
  readonly dest: TileRect;
  readonly flipH: boolean;
  readonly flipV: boolean;
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
  readonly warnings?: readonly string[];
}

/** Draw list of `doc` (hidden layers, grid layers and empty cells left out). */
export function layerDrawList(doc: MapDocument): DrawList {
  const { width, height, tileWidth, tileHeight } = doc.map;
  const images = exportedTilesets(doc);
  const layers: DrawLayer[] = [];
  for (const layer of exportedLayers(doc)) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const items = layerCells(doc, layer, images).map((c): DrawItem => {
      const tileset = images[c.tilesetIndex]!.tileset;
      return {
        tileset,
        src: tileRect(tileset, c.tileId),
        dest: {
          x: c.x * tileWidth,
          y: (c.y + 1) * tileHeight - tileset.tileHeight,
          width: tileset.tileWidth,
          height: tileset.tileHeight,
        },
        flipH: (c.flags & EXPORT_FLIP_H) !== 0,
        flipV: (c.flags & EXPORT_FLIP_V) !== 0,
      };
    });
    layers.push({ layerId: layer.id, opacity: layer.opacity, items });
  }
  return { width: width * tileWidth, height: height * tileHeight, layers, warnings: exportWarnings(doc) };
}
