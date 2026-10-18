
import { deriveCollision } from "../collision";
import { CELL_INDEX_MASK } from "../cell";
import type { MapDocument } from "../document";
import { entitySize, resolveEntityFields, type ResolvedEntityField } from "../entity";
import { isEntityLayer, isGridLayer, isTileLayer } from "../layer";
import { tileCount, type Tileset } from "../tileset";
import {
  exportBaseName,
  type ExportLayerOptions,
  type ExportWarning,
  exportedTilesets,
  exportWarnings,
  layerCells,
  tilesetImageSize,
  type ExportImage,
} from "./common";
import type { ExportResult } from "./game";
import { Rows, writeJson } from "./json";

/** Tiled format version written to `version`. */
export const TMJ_VERSION = "1.10";
/** Tiled version written to `tiledversion`. */
export const TMJ_TILED_VERSION = "1.10.2";

export interface TmjOptions extends ExportLayerOptions {
  /**
   * Image path written into each tileset, relative to the TMJ file.
   * Defaults to the export image file name (PNG copied next to the TMJ).
   */
  readonly imagePath?: (image: ExportImage) => string;
}

export interface TmjResult extends ExportResult {

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
  const images = exportedTilesets(doc, options.layers);
  const firstGids = tmjFirstGids(images.map((image) => image.tileset));

  const only = options.layers ? new Set(options.layers) : null;
  const written = doc.layers.filter((layer) => (isTileLayer(layer) && (!only || only.has(layer.id))) || isEntityLayer(layer));
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

    };
  });

  const warnings = exportWarnings(doc, options.layers);
  const collision = collisionRectangles(doc);
  const names = new Set(written.map(l => l.name));
  let collisionName = "Collision";
  for (let n = 2; names.has(collisionName); n++) collisionName = `Collision ${n}`;
  const collisionLayer = {
    draworder: "topdown", id: written.length + 1, name: collisionName,
    objects: collision.map(r => ({ height: r.height * tileHeight, id: nextObjectId++, name: "", rotation: 0, type: "", visible: false, width: r.width * tileWidth, x: r.x * tileWidth, y: r.y * tileHeight })),
    opacity: 1, properties: [{ name: "smapRole", type: "string", value: "collision" }], type: "objectgroup", visible: false, x: 0, y: 0,
  };
  const layers = doc.layers.some(isGridLayer) ? [...tmjLayers, collisionLayer] : tmjLayers;

  const text = writeJson({
    compressionlevel: -1,
    height,
    infinite: false,
    layers,
    nextlayerid: layers.length + 1,
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

/** Identical horizontal runs merge across adjacent rows; creation order is deterministic y/x. */
function collisionRectangles(doc: MapDocument): { x: number; y: number; width: number; height: number }[] {
  const { width, height, data } = deriveCollision(doc);
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  let previous = new Map<string, typeof rects[number]>();
  for (let y = 0; y < height; y++) {
    const current = new Map<string, typeof rects[number]>();
    for (let x = 0; x < width;) {
      if (!data[y * width + x]) { x++; continue; }
      const start = x; while (x < width && data[y * width + x]) x++;
      const key = `${start},${x - start}`, old = previous.get(key);
      if (old) { old.height++; current.set(key, old); }
      else { const rect = { x: start, y, width: x - start, height: 1 }; rects.push(rect); current.set(key, rect); }
    }
    previous = current;
  }
  return rects;
}
