/**
 * Tiled JSON map (TMJ) export: orthogonal, right-down, finite, tile layers
 * as plain GID arrays, tilesets embedded.
 *
 * - GID = tileset `firstgid` + tileId, OR-ed with the cell's flip bits. Our
 *   cell flag layout is Tiled's (H 0x80000000, V 0x40000000, D 0x20000000),
 *   so the flag bits are copied as they are.
 * - Collision: solid tiles get the tile property `solid: true` (bool). The
 *   exceptions painted on collision grid layers have no Tiled equivalent
 *   without objects; they are not exported and a warning says so.
 * - Grid layers are skipped (their derived tile layers carry the visuals).
 */
import { cellPaletteIndex, CELL_INDEX_MASK } from "../cell";
import type { MapDocument } from "../document";
import { isGridLayer } from "../layer";
import { tileCount, type Tileset } from "../tileset";
import { exportBaseName, exportedLayers, exportedTilesets, layerCells, tilesetImageSize, type ExportImage } from "./common";
import type { ExportResult } from "./game";
import { Rows, writeJson } from "./json";

/** Tiled format version written to `version`. */
export const TMJ_VERSION = "1.10";
/** Tiled version written to `tiledversion`. */
export const TMJ_TILED_VERSION = "1.10.2";

export interface TmjOptions {
  /**
   * Image path written into each tileset, relative to the TMJ file.
   * Defaults to the export image file name (PNG copied next to the TMJ).
   */
  readonly imagePath?: (image: ExportImage) => string;
}

export interface TmjResult extends ExportResult {
  /** Things the TMJ cannot carry (e.g. collision exceptions). */
  readonly warnings: readonly string[];
}

/** `firstgid` of each tileset: 1, then the previous `firstgid` + its tile count. */
export function tmjFirstGids(tilesets: readonly Tileset[]): number[] {
  let next = 1;
  return tilesets.map((tileset) => {
    const first = next;
    next += tileCount(tileset);
    return first;
  });
}

/** TMJ export of `doc` as `<level>.tmj` (deterministic). */
export function exportTmj(doc: MapDocument, levelName: string, options: TmjOptions = {}): TmjResult {
  const { width, height, tileWidth, tileHeight } = doc.map;
  const images = exportedTilesets(doc);
  const firstGids = tmjFirstGids(images.map((image) => image.tileset));
  const layers = exportedLayers(doc);

  const tmjLayers = layers.map((layer, i) => {
    const data = new Array<number>(width * height).fill(0);
    for (const c of layerCells(doc, layer, images)) {
      data[c.y * width + c.x] = (((firstGids[c.tilesetIndex]! + c.tileId) & CELL_INDEX_MASK) | c.cellFlags) >>> 0;
    }
    return {
      data: new Rows(data, width),
      height,
      id: i + 1,
      name: layer.name,
      opacity: layer.opacity,
      type: "tilelayer",
      visible: layer.visible,
      width,
      x: 0,
      y: 0,
    };
  });

  const tilesets = images.map((image, i) => {
    const { tileset } = image;
    const size = tilesetImageSize(tileset);
    const solid = tileset.solidTiles ?? [];
    return {
      columns: tileset.columns,
      firstgid: firstGids[i]!,
      image: options.imagePath ? options.imagePath(image) : image.fileName,
      imageheight: size.height,
      imagewidth: size.width,
      margin: tileset.margin,
      name: tileset.name,
      spacing: tileset.spacing,
      tilecount: tileCount(tileset),
      tileheight: tileset.tileHeight,
      tilewidth: tileset.tileWidth,
      ...(solid.length > 0
        ? { tiles: solid.map((id) => ({ id, properties: [{ name: "solid", type: "bool", value: true }] })) }
        : {}),
    };
  });

  const warnings: string[] = [];
  const exceptionLayers = doc.layers.filter((l) => isGridLayer(l) && l.role === "collision" && l.chunkCount > 0);
  if (exceptionLayers.length > 0) {
    warnings.push(
      `Collision exceptions (${exceptionLayers.map((l) => l.name).join(", ")}) are not exported to TMJ; only the "solid" tile property is.`,
    );
  }
  // Palette entries pointing at tilesets that no longer exist are dropped silently by layerCells; report them.
  const missing = new Set<string>();
  for (const layer of layers) {
    for (const chunk of layer.chunks()) {
      for (const cell of chunk.data) {
        const entry = cell === 0 ? undefined : doc.palette.get(cellPaletteIndex(cell));
        if (entry && !doc.getTileset(entry.tilesetId)) missing.add(entry.tilesetId);
      }
    }
  }
  if (missing.size > 0) warnings.push(`Cells of missing tilesets were skipped: ${[...missing].sort().join(", ")}.`);

  const text = writeJson({
    compressionlevel: -1,
    height,
    infinite: false,
    layers: tmjLayers,
    nextlayerid: layers.length + 1,
    nextobjectid: 1,
    orientation: "orthogonal",
    renderorder: "right-down",
    tiledversion: TMJ_TILED_VERSION,
    tileheight: tileHeight,
    tilesets,
    tilewidth: tileWidth,
    type: "map",
    version: TMJ_VERSION,
    width,
  });
  return { fileName: exportBaseName(levelName) + ".tmj", text, images, warnings };
}
