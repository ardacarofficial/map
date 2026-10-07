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
 * - Entity layers (v0.6) become object layers (`objectgroup`), in layer
 *   order between the tile layers. Each entity is a rectangle object:
 *   `x`, `y` = its top-left pixel, `width` / `height` its size, `name` =
 *   its id, `type` (Tiled 1.10 writes the class as `type`) = its type name,
 *   and one custom property per field of its type. Field mapping: string /
 *   enum / levelRef → `string` (levelRef = level id, `""` when unset),
 *   int → `int`, float → `float`, bool → `bool`, point → `string` `"x,y"`
 *   (pixels, `""` when unset). Every entity also gets the string property
 *   `typeId`. Object ids are 1, 2, … in layer and entity order.
 */
import { CELL_INDEX_MASK } from "../cell";
import type { MapDocument } from "../document";
import { entitySize, resolveEntityFields, type ResolvedEntityField } from "../entity";
import { isEntityLayer, isGridLayer, isTileLayer } from "../layer";
import { tileCount, type Tileset } from "../tileset";
import { exportBaseName, type ExportWarning, exportedTilesets, exportWarnings, layerCells, tilesetImageSize, type ExportImage } from "./common";
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
  readonly warnings: readonly ExportWarning[];
}

/** A resolved entity field as a Tiled custom property. */
function tmjProperty(field: ResolvedEntityField): { name: string; type: string; value: string | number | boolean } {
  const v = field.value;
  switch (field.type) {
    case "int":
      return { name: field.name, type: "int", value: typeof v === "number" ? v : 0 };
    case "float":
      return { name: field.name, type: "float", value: typeof v === "number" ? v : 0 };
    case "bool":
      return { name: field.name, type: "bool", value: v === true };
    case "point":
      return { name: field.name, type: "string", value: typeof v === "object" && v !== null ? `${v.x},${v.y}` : "" };
    default:
      return { name: field.name, type: "string", value: typeof v === "string" ? v : "" };
  }
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

  const written = doc.layers.filter((layer) => isTileLayer(layer) || isEntityLayer(layer));
  let nextObjectId = 1;
  const tmjLayers = written.map((layer, i) => {
    if (isEntityLayer(layer)) {
      return {
        draworder: "topdown",
        id: i + 1,
        name: layer.name,
        objects: layer.entities.map((entity) => {
          const type = doc.getEntityType(entity.typeId);
          const size = entitySize(entity, doc.map);
          return {
            height: size.height,
            id: nextObjectId++,
            name: entity.id,
            properties: [
              { name: "typeId", type: "string", value: entity.typeId },
              ...resolveEntityFields(entity, type).map(tmjProperty),
            ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
            rotation: 0,
            type: type ? type.name : entity.typeId,
            visible: true,
            width: size.width,
            x: entity.x,
            y: entity.y,
          };
        }),
        opacity: layer.opacity,
        type: "objectgroup",
        visible: layer.visible,
        x: 0,
        y: 0,
      };
    }
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

  const warnings: ExportWarning[] = [];
  const exceptionLayers = doc.layers.filter((l) => isGridLayer(l) && l.role === "collision" && l.chunkCount > 0);
  if (exceptionLayers.length > 0) {
    const layers = exceptionLayers.map((l) => l.name);
    warnings.push({
      code: "collisionExceptions",
      layers,
      message: `Collision exceptions (${layers.join(", ")}) are not exported to TMJ; only the "solid" tile property is.`,
    });
  }
  // Cells of missing tilesets / out-of-range tile ids are skipped by layerCells; report them.
  warnings.push(...exportWarnings(doc));

  const text = writeJson({
    compressionlevel: -1,
    height,
    infinite: false,
    layers: tmjLayers,
    nextlayerid: written.length + 1,
    nextobjectid: nextObjectId,
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
