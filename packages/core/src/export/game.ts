/**
 * Game JSON export ("smapExport" format, see FORMAT.md next to this file).
 *
 * The engine-facing format, separate from the editor's save format: no
 * palette, no chunks, no editor state. The Unity importer reads exactly this
 * text from a `<level>.smapmap` file.
 */
import type { MapDocument } from "../document";
import { deriveCollision } from "../collision";
import { exportBaseName, exportedLayers, exportedTilesets, layerCells, type ExportImage } from "./common";
import { Rows, writeJson } from "./json";
import { encodeRle } from "./rle";

/** Value of the `smapExport` version field. Bumped only on breaking changes. */
export const GAME_EXPORT_VERSION = 1;
/** File extension of the Unity map file (game JSON content). */
export const UNITY_MAP_EXTENSION = ".smapmap";
/** Numbers per row of a layer's `cells` array: `x, y, tileset, tileId, flags`. */
export const GAME_CELL_STRIDE = 5;

/** Result of an export: the map file plus the tileset PNGs to copy next to it. */
export interface ExportResult {
  /** File name of the map, e.g. `"main.smapmap"`. */
  readonly fileName: string;
  readonly text: string;
  /** Tileset images referenced by the map; copy `sourcePath` → `fileName` into the same folder. */
  readonly images: readonly ExportImage[];
}

/** Game JSON text of `doc` (deterministic: same document, same bytes). */
export function exportGameJson(doc: MapDocument): string {
  return buildGameJson(doc, exportedTilesets(doc));
}

/**
 * The Unity map file: game JSON under `<level>.smapmap`. The editor writes it
 * and the listed PNGs into one folder under the Unity project's `Assets/`.
 */
export function exportUnityMap(doc: MapDocument, levelName: string): ExportResult {
  const images = exportedTilesets(doc);
  return { fileName: exportBaseName(levelName) + UNITY_MAP_EXTENSION, text: buildGameJson(doc, images), images };
}

function buildGameJson(doc: MapDocument, images: readonly ExportImage[]): string {
  const { width, height, tileWidth, tileHeight } = doc.map;
  const collision = deriveCollision(doc);
  return writeJson({
    smapExport: GAME_EXPORT_VERSION,
    width,
    height,
    tileWidth,
    tileHeight,
    yUp: false,
    tilesets: images.map(({ tileset, fileName }) => ({
      name: tileset.name,
      image: fileName,
      tileWidth: tileset.tileWidth,
      tileHeight: tileset.tileHeight,
      columns: tileset.columns,
      rows: tileset.rows,
      margin: tileset.margin,
      spacing: tileset.spacing,
    })),
    layers: exportedLayers(doc).map((layer) => {
      const values: number[] = [];
      for (const c of layerCells(doc, layer, images)) values.push(c.x, c.y, c.tilesetIndex, c.tileId, c.flags);
      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        cells: new Rows(values, GAME_CELL_STRIDE),
      };
    }),
    collision: { solid: new Rows(encodeRle(collision.data), 16) },
  });
}
