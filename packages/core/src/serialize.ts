import { migrateV5 } from "./migrations/v5";
/** Deterministic project/level/stamp/clip JSON. Legacy conversion is raw and never derives cells. */
import { migrateV4, retainLegacyRoadFamilies } from "./migrations/v4";
import { decodeUint32LE, encodeUint32LE } from "./base64";
import { CELL_INDEX_MASK, cellPaletteIndex, isValidCell } from "./cell";
import type { ClipLayer, TileClip } from "./clip";
import {
  entityProblem,
  emptyFieldRecord,
  entityTypesProblem,
  isEntityFieldType,
  isEntityFieldValue,
  normalizeEntity,
  SPAWN_TYPE_ID,
  type Entity,
  type EntityFieldDef,
  type EntityFieldValue,
  type EntityType,
} from "./entity";
import { normalizeProject, type Project, type ProjectData } from "./project";
import { normalizeStampMeta, normalizeStampNineSlice, stampIdProblem, stampMetaProblem, stampNineSliceProblem, type Stamp, type StampMeta, type StampNineSlice } from "./stamp";
import { collectionsProblem, normalizeCollection, type Collection } from "./collection";
import { normalizeRandomSet, randomSetsProblem, type RandomSet } from "./randomSet";
import { projectSettingsJson, type ProjectSettingsInput } from "./projectSettings";
import { CHUNK_AREA, CHUNK_SHIFT, CHUNK_SIZE } from "./chunk";
import { DOCUMENT_FORMAT_VERSION, MAX_MAP_SIZE, MapDocument, isValidSeed, mapInfoProblem, mapPropsFrom, type MapInfo } from "./document";
import {
  EntityLayer,
  GridLayer,
  MAX_GRID_VALUE,
  TileLayer,
  isEntityLayer,
  isGridLayer,
  isGridRole,
  layerPropsProblem,
  type LayerProps,
} from "./layer";
import { isValidTileId, normalizeTileset, relativePathProblem, tileCount, tilesetProblem, type Tileset } from "./tileset";

/** `format` field of a project file. */
export const PROJECT_FORMAT = "smap-project";
/** `format` field of a level file. */
export const LEVEL_FORMAT = "smap-level";
/** `format` field of a serialized clip (system clipboard). */
export const CLIP_FORMAT = "smap-clip";
/** `format` field of a stamp file (`stamps/<id>.json`). */
export const STAMP_FORMAT = "smap-stamp";
/** Conventional project file name. */
export const PROJECT_FILE_NAME = "project.smap";

export type { LevelRef, ProjectData } from "./project";

/** Thrown by `parseProject` / `parseLevel`. `path` points at the offending value, e.g. `layers[0].chunks[2].data`. */
export class FormatError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = "FormatError";
    this.path = path;
  }
}

// ------------------------------------------------------------------ writing

/**
 * Project file text. Missing level ids are derived from the path and
 * missing world positions written as `{ x: 0, y: 0 }` (see `normalizeProject`).
 * @throws Error on duplicate level ids / paths or invalid entity types.
 */
export function serializeProject(project: ProjectData): string {
  const p = normalizeProject(project);
  const problem = entityTypesProblem(p.entityTypes);
  if (problem) throw new Error(`serializeProject: ${problem}`);
  return toJson({
    format: PROJECT_FORMAT,
    documentFormatVersion: DOCUMENT_FORMAT_VERSION,
    name: p.name,
    levels: p.levels.map((level) => ({ id: level.id, name: level.name, path: level.path, world: { x: level.world.x, y: level.world.y } })),
    tilesets: p.tilesets.map(tilesetJson),
    ...(p.generatedRecipes?.length ? { generatedRecipes: p.generatedRecipes.map(s => JSON.parse(serializeStamp(s))) } : {}),
    ...(p.entityTypes.length > 0 ? { entityTypes: p.entityTypes.map(entityTypeJson) } : {}),
    ...(p.randomSets.length > 0 ? { randomSets: p.randomSets } : {}),
    ...(p.collections.length > 0 ? { collections: p.collections } : {}),
    ...withSettings(p.settings),
    ...(p.retiredLevelIds.length > 0 ? { retiredLevelIds: [...p.retiredLevelIds] } : {}),
  });
}

function withSettings(settings: Project["settings"]): Record<string, unknown> {
  const json = projectSettingsJson(settings);
  return json ? { settings: json } : {};
}

/** Level file text for a document (tilesets live in the project file). */
export function serializeLevel(doc: MapDocument): string {
  return toJson({
    format: LEVEL_FORMAT,
    documentFormatVersion: DOCUMENT_FORMAT_VERSION,
    map: {
      width: doc.map.width,
      height: doc.map.height,
      tileWidth: doc.map.tileWidth,
      tileHeight: doc.map.tileHeight,
    },
    ...(doc.seed !== 0 ? { seed: doc.seed } : {}),
    ...(doc.props.background !== null ? { background: doc.props.background } : {}),
    ...(doc.props.name !== "" ? { name: doc.props.name } : {}),
    palette: doc.palette.entries().map((entry, i) => ({
      index: i + 1,
      tilesetId: entry.tilesetId,
      tileId: entry.tileId,
    })),
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      ...(isGridLayer(layer)
        ? { role: layer.role }
        : {}),
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      ...(isEntityLayer(layer)
        ? { entities: layer.entities.map(entityJson) }
        : {
            chunks: [...layer.chunks()]
              .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
              .map((chunk) => ({ cx: chunk.cx, cy: chunk.cy, data: encodeUint32LE(chunk.data) })),
          }),
    })),
  });
}

/** Stamp file text for `stamps/<id>.json` (deterministic). */
export function serializeStamp(stamp: Stamp): string {
  const problem = stampIdProblem(stamp.id);
  if (problem) throw new Error(`serializeStamp: ${problem}`);
  return toJson({
    format: STAMP_FORMAT,
    documentFormatVersion: DOCUMENT_FORMAT_VERSION,
    id: stamp.id,
    name: stamp.name,
    ...stampMetaJson(stamp),
    ...(stamp.smartDisabled ? { smartDisabled: true } : {}),
    ...(stamp.nineSlice !== undefined ? { nineSlice: normalizeStampNineSlice(stamp, stamp.nineSlice) } : {}),
    ...clipBodyJson(stamp),
  });
}

/**
 * Clip text for the system clipboard. Deterministic: same clip, same bytes.
 * Each layer's cells are little-endian `Uint32`, base64-encoded.
 */
export function serializeClip(clip: TileClip): string {
  return toJson({ format: CLIP_FORMAT, documentFormatVersion: DOCUMENT_FORMAT_VERSION, ...clipBodyJson(clip) });
}

function stampMetaJson(stamp: Stamp): Record<string, unknown> {
  const problem = stampMetaProblem(stamp);
  if (problem) throw new Error(`serializeStamp: ${problem}`);
  const meta = normalizeStampMeta(stamp);
  return { ...meta, ...(meta.tags ? { tags: [...meta.tags] } : {}) };
}

function clipBodyJson(clip: TileClip): Record<string, unknown> {
  return {
    width: clip.width,
    height: clip.height,
    palette: clip.palette.map((entry, i) => ({ index: i + 1, tilesetId: entry.tilesetId, tileId: entry.tileId })),
    layers: clip.layers.map((layer) => ({
      layerId: layer.layerId,
      name: layer.name,
      ...(layer.grid ? { grid: true, ...(layer.role ? { role: layer.role } : {}) } : {}),
      data: encodeUint32LE(layer.cells),
    })),
  };
}

function entityTypeJson(t: EntityType): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    color: t.color,
    ...(t.icon !== undefined ? { icon: t.icon } : {}),
    fields: t.fields.map((f) => ({
      name: f.name,
      type: f.type,
      default: valueJson(f.default),
      ...(f.enumValues ? { enumValues: f.enumValues } : {}),
    })),
  };
}

function entityJson(e: Entity): Record<string, unknown> {
  return {
    id: e.id,
    typeId: e.typeId,
    x: e.x,
    y: e.y,
    ...(e.width !== undefined ? { width: e.width } : {}),
    ...(e.height !== undefined ? { height: e.height } : {}),
    fields: Object.keys(e.fields)
      .sort()
      .map((name) => ({ name, value: valueJson(e.fields[name]!) })),
  };
}

function valueJson(v: EntityFieldValue): unknown {
  return typeof v === "object" && v !== null ? { x: v.x, y: v.y } : v;
}

function tilesetJson(tileset: Tileset): Record<string, unknown> {
  const t = normalizeTileset(tileset);
  return {
    id: t.id,
    name: t.name,
    ...(t.group !== undefined ? { group: t.group } : {}),
    ...(t.generated !== undefined ? { generated: t.generated } : {}),
    ...(t.roadProfile ? { roadProfile: t.roadProfile } : {}),
    imagePath: t.imagePath,
    tileWidth: t.tileWidth,
    tileHeight: t.tileHeight,
    columns: t.columns,
    rows: t.rows,
    margin: t.margin,
    spacing: t.spacing,
  };
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

// ------------------------------------------------------------------ reading

/**
 * Parses and validates `project.smap`.
 * @throws FormatError with a descriptive message on any problem, including a newer `documentFormatVersion`.
 */
export function parseProject(text: string): Project {
  const root = readRoot(text, PROJECT_FORMAT, "project");
  const name = str(root, "name", "");
  const levels = arr(root, "levels", "").map((item, i) => {
    const path = `levels[${i}]`;
    const level = obj(item, path);
    const ref = { name: str(level, "name", path), path: str(level, "path", path) };
    const problem = relativePathProblem(ref.path);
    if (problem) throw new FormatError(`${path}.path`, problem);
    let id: string | undefined;
    if (level["id"] !== undefined) {
      id = str(level, "id", path);
      if (id.length === 0) throw new FormatError(`${path}.id`, "must not be empty");
    }
    let world: { x: number; y: number } | undefined;
    if (level["world"] !== undefined) {
      const w = obj(level["world"], `${path}.world`);
      world = { x: int(w, "x", `${path}.world`), y: int(w, "y", `${path}.world`) };
    }
    return { ...(id !== undefined ? { id } : {}), ...ref, ...(world ? { world } : {}) };
  });
  assertUnique(levels.map((l) => l.path), "levels", "path");
  assertUnique(levels.filter((l) => l.id !== undefined).map((l) => l.id!), "levels", "id");
  const tilesets = arr(root, "tilesets", "").map((item, i) => readTileset(item, `tilesets[${i}]`, root["documentFormatVersion"] as number));
  assertUnique(tilesets.map((t) => t.id), "tilesets", "id");
  let entityTypes: EntityType[] = [];
  if (root["entityTypes"] !== undefined) {
    entityTypes = arr(root, "entityTypes", "").map((item, i) => readEntityType(item, `entityTypes[${i}]`));
    const problem = entityTypesProblem(entityTypes);
    if (problem) throw new FormatError("", problem);
  }
  let retiredLevelIds: string[] = [];
  if (root["retiredLevelIds"] !== undefined) {
    retiredLevelIds = arr(root, "retiredLevelIds", "").map((v, i) => {
      const id = strValue(v, `retiredLevelIds[${i}]`);
      if (id.length === 0) throw new FormatError(`retiredLevelIds[${i}]`, "must not be empty");
      return id;
    });
  }
  let randomSets: RandomSet[] = [];
  if (root["randomSets"] !== undefined) {
    randomSets = arr(root, "randomSets", "").map((item, i) => obj(item, `randomSets[${i}]`) as unknown as RandomSet);
    const problem = randomSetsProblem(randomSets);
    if (problem) throw new FormatError("randomSets", problem);
    randomSets = randomSets.map(normalizeRandomSet);
  }
  let collections: Collection[] = [];
  if (root["collections"] !== undefined) {
    collections = arr(root, "collections", "").map((item, i) => {
      const c = obj(item, `collections[${i}]`);
      if (!Array.isArray(c["cells"])) throw new FormatError(`collections[${i}].cells`, "must be an array");
      return c as unknown as Collection;
    });
    const problem = collectionsProblem(collections);
    if (problem) throw new FormatError("collections", problem);
    collections = collections.map(normalizeCollection);
  }
  let settings: ProjectSettingsInput = {};
  if (root["settings"] !== undefined) {
    settings = obj(root["settings"], "settings") as ProjectSettingsInput;
  }
  const generatedRecipes = root["generatedRecipes"] === undefined ? [] : arr(root, "generatedRecipes", "").map(r => parseStamp(toJson(r), tilesets));
  try {
    return normalizeProject({ name, levels, tilesets, entityTypes, retiredLevelIds, randomSets, collections, settings, generatedRecipes });
  } catch (error) {
    const message = (error as Error).message;
    throw new FormatError(message.startsWith("settings") ? "settings" : "levels", message);
  }
}

/** Options of {@link parseLevel}. */
export interface ParseLevelOptions {
  /**
   * Receives non-fatal findings (see {@link paletteWarnings}); the level
   * still loads. Pushed in a fixed order.
   */
  readonly warnings?: string[];
  /** Project random sets to attach (round 4; project data like `tilesets`). Default none. */
  readonly randomSets?: readonly RandomSet[];
  /** Project collections to attach (round 4; project data like `tilesets`). Default none. */
  readonly collections?: readonly Collection[];
}

/**
 * Parses and validates a level file into a new `MapDocument`.
 *
 * `tilesets` (from the project file) are attached to the document. Palette
 * entries pointing at a tileset that is not listed, or at a tile id outside
 * it (the image shrank), are kept, so a level still opens; they are
 * reported through `options.warnings`, the renderer should show those tiles
 * as missing and the exporters skip them.
 *
 * @throws FormatError with a descriptive message on any problem, including a newer `documentFormatVersion`.
 */
export function parseLevel(
  text: string,
  tilesets: readonly Tileset[] = [],
  entityTypes: readonly EntityType[] = [],
  options: ParseLevelOptions = {},
): MapDocument {
  const root = readRoot(text, LEVEL_FORMAT, "level");

  const mapObj = obj(root["map"], "map");
  const map: MapInfo = {
    width: int(mapObj, "width", "map"),
    height: int(mapObj, "height", "map"),
    tileWidth: int(mapObj, "tileWidth", "map"),
    tileHeight: int(mapObj, "tileHeight", "map"),
  };
  const mapProblem = mapInfoProblem(map);
  if (mapProblem) throw new FormatError("map", mapProblem);

  let seed = 0;
  if (root["seed"] !== undefined) {
    seed = int(root, "seed", "");
    if (!isValidSeed(seed)) throw new FormatError("seed", `must be an integer in [0, 2^32), got ${seed}`);
  }
  const doc = new MapDocument(map, seed);
  for (const tileset of tilesets) {
    if (doc.getTileset(tileset.id)) throw new FormatError("tilesets", `duplicate tileset id "${tileset.id}"`);
    doc._addTileset(tileset);
  }
  const typesProblem = entityTypesProblem(entityTypes);
  if (typesProblem) throw new FormatError("", typesProblem);
  doc._setEntityTypes(entityTypes);
  if (options.randomSets) {
    const problem = randomSetsProblem(options.randomSets);
    if (problem) throw new FormatError("randomSets", problem);
    doc._setRandomSets(options.randomSets.map(normalizeRandomSet));
  }
  if (options.collections) {
    const problem = collectionsProblem(options.collections);
    if (problem) throw new FormatError("collections", problem);
    doc._setCollections(options.collections.map(normalizeCollection));
  }
  {
    let background: string | null = null;
    let levelName = "";
    if (root["background"] !== undefined) background = str(root, "background", "");
    if (root["name"] !== undefined) levelName = str(root, "name", "");
    try {
      doc._setProps(mapPropsFrom(background, levelName));
    } catch (error) {
      throw new FormatError("background", (error as Error).message);
    }
  }

  arr(root, "palette", "").forEach((item, i) => {
    const path = `palette[${i}]`;
    const entry = obj(item, path);
    const index = int(entry, "index", path);
    if (index !== i + 1) throw new FormatError(`${path}.index`, `expected ${i + 1}, got ${index}`);
    const tilesetId = str(entry, "tilesetId", path);
    if (tilesetId.length === 0) throw new FormatError(`${path}.tilesetId`, "must not be empty");
    const tileId = int(entry, "tileId", path);
    if (tileId < 0) throw new FormatError(`${path}.tileId`, `must be ≥ 0, got ${tileId}`);
    if (doc.palette.indexOf(tilesetId, tileId) !== 0) {
      throw new FormatError(path, `duplicate palette entry for tileset "${tilesetId}" tile ${tileId}`);
    }
    doc.palette._getOrAdd(tilesetId, tileId);
  });

  const entityIds = new Set<string>();
  let spawnSeen = false;
  arr(root, "layers", "").forEach((item, i) => {
    const path = `layers[${i}]`;
    const layerObj = obj(item, path);
    const type = str(layerObj, "type", path);
    if (type !== "tile" && type !== "grid" && type !== "entity") throw new FormatError(`${path}.type`, `unsupported layer type "${type}"`);
    const props: LayerProps = {
      id: str(layerObj, "id", path),
      name: str(layerObj, "name", path),
      visible: bool(layerObj, "visible", path),
      locked: bool(layerObj, "locked", path),
      opacity: num(layerObj, "opacity", path),
    };
    const problem = layerPropsProblem(props);
    if (problem) throw new FormatError(path, problem);
    if (doc.getLayer(props.id)) throw new FormatError(`${path}.id`, `duplicate layer id "${props.id}"`);
    let layer: TileLayer;
    if (type === "grid") {
      const role = str(layerObj, "role", path);
      if (!isGridRole(role)) throw new FormatError(`${path}.role`, `unknown grid role "${role}"`);
      layer = new GridLayer(props, role);
    } else {
      if (layerObj["role"] !== undefined) throw new FormatError(`${path}.role`, "only grid layers have a role");
      layer = type === "entity" ? new EntityLayer(props) : new TileLayer(props);
    }
    if (isEntityLayer(layer)) {
      if (layerObj["chunks"] !== undefined) throw new FormatError(`${path}.chunks`, "entity layers have no chunks");
      const entities = arr(layerObj, "entities", path).map((e, j) => readEntity(e, `${path}.entities[${j}]`, doc));
      for (const [j, entity] of entities.entries()) {
        if (entityIds.has(entity.id)) throw new FormatError(`${path}.entities[${j}].id`, `duplicate entity id "${entity.id}"`);
        entityIds.add(entity.id);
        if (entity.typeId === SPAWN_TYPE_ID) {
          if (spawnSeen) throw new FormatError(`${path}.entities[${j}]`, "a level has at most one spawn point");
          spawnSeen = true;
        }
      }
      layer._setEntities(Object.freeze(entities));
    } else {
      readChunks(arr(layerObj, "chunks", path), `${path}.chunks`, layer, doc);
    }
    doc._insertLayer(layer, doc.layers.length);
  });

  if (fileFormatVersion(text)! < DOCUMENT_FORMAT_VERSION) doc._setMigrations(["format.migrated"]);
  if (options.warnings) options.warnings.push(...paletteWarnings(doc));
  return doc;
}

export function paletteWarnings(doc: MapDocument): string[] {
  const out: string[] = [];
  doc.palette.entries().forEach((entry, i) => {
    const tileset = doc.getTileset(entry.tilesetId);
    if (!tileset) out.push(`palette index ${i + 1}: tileset "${entry.tilesetId}" is not in the project`);
    else if (!isValidTileId(tileset, entry.tileId)) {
      out.push(`palette index ${i + 1}: tile ${entry.tileId} is outside tileset "${entry.tilesetId}" (${tileCount(tileset)} tiles)`);
    }
  });
  return out;
}

/**
 * Parses and validates clip text (e.g. from the system clipboard).
 * @throws FormatError on any problem (also when the text is not a clip at all).
 */
export function parseClip(text: string): TileClip {
  return readClipBody(readRoot(text, CLIP_FORMAT, "clip"));
}

/**
 * Parses and validates a stamp file (`stamps/<id>.json`).
 * @throws FormatError on any problem.
 */
export function parseStamp(text: string, tilesets: readonly Tileset[] = []): Stamp {
  const root = readRoot(text, STAMP_FORMAT, "stamp", tilesets);
  const id = str(root, "id", "");
  const problem = stampIdProblem(id);
  if (problem) throw new FormatError("id", problem);
  const name = str(root, "name", "");
  const meta: { category?: string; tags?: string[]; favorite?: boolean } = {};
  if (root["category"] !== undefined) meta.category = str(root, "category", "");
  if (root["tags"] !== undefined) meta.tags = arr(root, "tags", "").map((v, i) => strValue(v, `tags[${i}]`));
  if (root["favorite"] !== undefined) meta.favorite = bool(root, "favorite", "");
  const metaProblem = stampMetaProblem(meta);
  if (metaProblem) throw new FormatError("", metaProblem);
  const clip = readClipBody(root);
  let nineSlice: StampNineSlice | undefined;
  if ((root["documentFormatVersion"] as number) >= 3 && root["nineSlice"] !== undefined) {
    const problem = stampNineSliceProblem(clip, root["nineSlice"]);
    if (problem) throw new FormatError("nineSlice", problem);
    nineSlice = normalizeStampNineSlice(clip, root["nineSlice"] as StampNineSlice);
  }
  const smartDisabled = root["smartDisabled"] === undefined ? false : bool(root, "smartDisabled", "");
  return Object.freeze({ id, name, ...(smartDisabled ? { smartDisabled } : {}), ...normalizeStampMeta(meta as StampMeta), ...(nineSlice ? { nineSlice } : {}), width: clip.width, height: clip.height, palette: clip.palette, layers: clip.layers });
}

function readClipBody(root: Record<string, unknown>): TileClip {
  const width = int(root, "width", "");
  const height = int(root, "height", "");
  if (width < 1 || height < 1 || width > MAX_MAP_SIZE || height > MAX_MAP_SIZE) {
    throw new FormatError("", `clip size ${width}×${height} is invalid`);
  }
  const palette = arr(root, "palette", "").map((item, i) => {
    const path = `palette[${i}]`;
    const entry = obj(item, path);
    const index = int(entry, "index", path);
    if (index !== i + 1) throw new FormatError(`${path}.index`, `expected ${i + 1}, got ${index}`);
    const tilesetId = str(entry, "tilesetId", path);
    if (tilesetId.length === 0) throw new FormatError(`${path}.tilesetId`, "must not be empty");
    const tileId = int(entry, "tileId", path);
    if (tileId < 0) throw new FormatError(`${path}.tileId`, `must be ≥ 0, got ${tileId}`);
    return Object.freeze({ tilesetId, tileId });
  });
  const layers = arr(root, "layers", "").map((item, i): ClipLayer => {
    const path = `layers[${i}]`;
    const layerObj = obj(item, path);
    const layerId = str(layerObj, "layerId", path);
    const name = str(layerObj, "name", path);
    const grid = layerObj["grid"] === undefined ? false : bool(layerObj, "grid", path);
    let role: "collision" | undefined;
    if (layerObj["role"] !== undefined) {
      const r = str(layerObj, "role", path);
      if (!grid) throw new FormatError(`${path}.role`, "only grid layers have a role");
      if (!isGridRole(r)) throw new FormatError(`${path}.role`, `unknown grid role "${r}"`);
      role = r;
    }
    let cells: Uint32Array;
    try {
      cells = decodeUint32LE(str(layerObj, "data", path));
    } catch (error) {
      if (error instanceof FormatError) throw error;
      throw new FormatError(`${path}.data`, `invalid base64: ${(error as Error).message}`);
    }
    if (cells.length !== width * height) {
      throw new FormatError(`${path}.data`, `expected ${width * height} cells, got ${cells.length}`);
    }
    for (const cell of cells) {
      if (grid) {
        if (cell > MAX_GRID_VALUE) throw new FormatError(`${path}.data`, `grid value ${cell} is above ${MAX_GRID_VALUE}`);
        continue;
      }
      if (!isValidCell(cell)) throw new FormatError(`${path}.data`, `invalid cell value ${cell}`);
      if (cellPaletteIndex(cell) > palette.length) {
        throw new FormatError(`${path}.data`, `palette index ${cellPaletteIndex(cell)} does not exist`);
      }
    }
    return Object.freeze(grid ? { layerId, name, grid: true, ...(role ? { role } : {}), cells } : { layerId, name, cells });
  });
  assertUnique(layers.map((l) => l.layerId), "layers", "layerId");
  return Object.freeze({ width, height, palette: Object.freeze(palette), layers: Object.freeze(layers) });
}

function readChunks(items: unknown[], path: string, layer: TileLayer, doc: MapDocument): void {
  const maxCx = (doc.map.width - 1) >> CHUNK_SHIFT;
  const maxCy = (doc.map.height - 1) >> CHUNK_SHIFT;
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const p = `${path}[${i}]`;
    const chunkObj = obj(item, p);
    const cx = int(chunkObj, "cx", p);
    const cy = int(chunkObj, "cy", p);
    if (cx < 0 || cy < 0 || cx > maxCx || cy > maxCy) {
      throw new FormatError(p, `chunk (${cx}, ${cy}) is outside the map (max (${maxCx}, ${maxCy}))`);
    }
    const key = `${cx},${cy}`;
    if (seen.has(key)) throw new FormatError(p, `duplicate chunk (${cx}, ${cy})`);
    seen.add(key);

    let data: Uint32Array;
    try {
      data = decodeUint32LE(str(chunkObj, "data", p));
    } catch (error) {
      if (error instanceof FormatError) throw error;
      throw new FormatError(`${p}.data`, `invalid base64: ${(error as Error).message}`);
    }
    if (data.length !== CHUNK_AREA) {
      throw new FormatError(`${p}.data`, `expected ${CHUNK_AREA} cells, got ${data.length}`);
    }
    const grid = isGridLayer(layer) ? layer : null;
    if (!grid && fastChunkValid(data, cx, cy, doc)) {
      layer._putChunk(cx, cy, data);
      return;
    }
    // Slow path: edge chunks and errors (exact messages).
    for (let j = 0; j < CHUNK_AREA; j++) {
      const cell = data[j]!;
      if (cell === 0) continue;
      const x = cx * CHUNK_SIZE + (j & (CHUNK_SIZE - 1));
      const y = cy * CHUNK_SIZE + (j >> CHUNK_SHIFT);
      if (grid) {
        if (cell > grid.maxValue) throw new FormatError(`${p}.data`, `grid value ${cell} at (${x}, ${y}) is above ${grid.maxValue}`);
        if (!doc.inBounds(x, y)) throw new FormatError(`${p}.data`, `non-empty cell outside the map at (${x}, ${y})`);
        continue;
      }
      if (!isValidCell(cell)) throw new FormatError(`${p}.data`, `invalid cell value ${cell} at (${x}, ${y})`);
      if (!doc.inBounds(x, y)) throw new FormatError(`${p}.data`, `non-empty cell outside the map at (${x}, ${y})`);
      const index = cellPaletteIndex(cell);
      if (index > doc.palette.size) {
        throw new FormatError(`${p}.data`, `palette index ${index} at (${x}, ${y}) does not exist (palette size ${doc.palette.size})`);
      }
    }
    layer._putChunk(cx, cy, data);
  });
}

/**
 * Fast check of a tile chunk fully inside the map: every non-empty cell has a
 * palette index in `[1, palette size]` (a Uint32 is always an integer in
 * range, and index 0 with flags is the only other invalid cell). False sends
 * the chunk through the detailed per-cell check.
 */
function fastChunkValid(data: Uint32Array, cx: number, cy: number, doc: MapDocument): boolean {
  if ((cx + 1) * CHUNK_SIZE > doc.map.width || (cy + 1) * CHUNK_SIZE > doc.map.height) return false;
  const size = doc.palette.size;
  for (let j = 0; j < data.length; j++) {
    const cell = data[j]!;
    if (cell === 0) continue;
    const index = cell & CELL_INDEX_MASK;
    if (index === 0 || index > size) return false;
  }
  return true;
}

function readRoot(text: string, format: string, what: string, tilesets: readonly Tileset[] = []): Record<string, unknown> {
  if (typeof text !== "string") throw new FormatError("", `${what} file must be a string`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new FormatError("", `${what} file is not valid JSON: ${(error as Error).message}`);
  }
  const root = obj(value, "");
  if (root["format"] !== format) {
    throw new FormatError("format", `not a ${what} file (expected "${format}", got ${JSON.stringify(root["format"]) ?? "nothing"})`);
  }
  const version = root["documentFormatVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new FormatError("documentFormatVersion", `must be a positive integer, got ${JSON.stringify(version) ?? "nothing"}`);
  }
  if (version > DOCUMENT_FORMAT_VERSION) {
    throw new FormatError(
      "documentFormatVersion",
      `file version ${version} is newer than supported version ${DOCUMENT_FORMAT_VERSION}; update the editor`,
    );
  }
  try {
    return migrateV5(migrateV4(root, tilesets as unknown as readonly Record<string, unknown>[]));
  } catch (error) {
    throw new FormatError("", (error as Error).message);
  }
}

function readTileset(item: unknown, path: string, version: number): Tileset {
  const t = obj(item, path);
  const tileset: Tileset = {
    id: str(t, "id", path),
    name: str(t, "name", path),
    imagePath: str(t, "imagePath", path),
    tileWidth: int(t, "tileWidth", path),
    tileHeight: int(t, "tileHeight", path),
    columns: int(t, "columns", path),
    rows: int(t, "rows", path),
    margin: int(t, "margin", path),
    spacing: int(t, "spacing", path),
  };
  let group: string | undefined;
  if (t["group"] !== undefined) {
    group = str(t, "group", path);
    if (group.length === 0) throw new FormatError(`${path}.group`, "must not be empty (omit it instead)");
  }
  const full: Tileset = {
    ...tileset,
    ...(version >= 3 && t["generated"] !== undefined ? { generated: t["generated"] as NonNullable<Tileset["generated"]> } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(t["roadProfile"] !== undefined ? { roadProfile: t["roadProfile"] as NonNullable<Tileset["roadProfile"]> } : {}),
  };
  const problem = tilesetProblem(full);
  if (problem) throw new FormatError(path, problem);
  return retainLegacyRoadFamilies(t, normalizeTileset(full));
}

export function fileFormatVersion(text: string): number | null {
  try {
    const v = (JSON.parse(text) as { documentFormatVersion?: unknown } | null)?.documentFormatVersion;
    return typeof v === "number" && Number.isInteger(v) ? v : null;
  } catch {
    return null;
  }
}

function readValue(value: unknown, path: string): EntityFieldValue {
  if (!isEntityFieldValue(value)) throw new FormatError(path, `invalid field value ${describe(value)}`);
  return typeof value === "object" && value !== null ? Object.freeze({ x: value.x, y: value.y }) : value;
}

function readEntityType(item: unknown, path: string): EntityType {
  const t = obj(item, path);
  const fields = arr(t, "fields", path).map((f, i): EntityFieldDef => {
    const fp = `${path}.fields[${i}]`;
    const fo = obj(f, fp);
    const type = str(fo, "type", fp);
    if (!isEntityFieldType(type)) throw new FormatError(`${fp}.type`, `unknown field type "${type}"`);
    if (!Object.prototype.hasOwnProperty.call(fo, "default")) throw new FormatError(`${fp}.default`, "missing");
    return {
      name: str(fo, "name", fp),
      type,
      default: readValue(fo["default"], `${fp}.default`),
      ...(fo["enumValues"] !== undefined ? { enumValues: arr(fo, "enumValues", fp).map((v, j) => strValue(v, `${fp}.enumValues[${j}]`)) } : {}),
    };
  });
  return {
    id: str(t, "id", path),
    name: str(t, "name", path),
    color: str(t, "color", path),
    ...(t["icon"] !== undefined ? { icon: str(t, "icon", path) } : {}),
    fields,
  };
}

function readEntity(item: unknown, path: string, doc: MapDocument): Entity {
  const e = obj(item, path);
  const fields = emptyFieldRecord<EntityFieldValue>();
  arr(e, "fields", path).forEach((f, i) => {
    const fp = `${path}.fields[${i}]`;
    const fo = obj(f, fp);
    const name = str(fo, "name", fp);
    if (Object.prototype.hasOwnProperty.call(fields, name)) throw new FormatError(`${fp}.name`, `duplicate field "${name}"`);
    fields[name] = readValue(fo["value"], `${fp}.value`);
  });
  const entity: Entity = {
    id: str(e, "id", path),
    typeId: str(e, "typeId", path),
    x: int(e, "x", path),
    y: int(e, "y", path),
    ...(e["width"] !== undefined ? { width: int(e, "width", path) } : {}),
    ...(e["height"] !== undefined ? { height: int(e, "height", path) } : {}),
    fields,
  };
  // Field values are checked for shape only: the type may have changed since.
  const problem = entityProblem(entity, doc.map);
  if (problem) throw new FormatError(path, problem);
  return normalizeEntity(entity);
}

function strValue(value: unknown, path: string): string {
  if (typeof value !== "string") throw new FormatError(path, `expected a string, got ${describe(value)}`);
  return value;
}

function assertUnique(values: readonly string[], path: string, field: string): void {
  const seen = new Set<string>();
  for (const [i, value] of values.entries()) {
    if (seen.has(value)) throw new FormatError(`${path}[${i}].${field}`, `duplicate ${field} "${value}"`);
    seen.add(value);
  }
}

// ------------------------------------------------------------------ field readers

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FormatError(path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function arr(o: Record<string, unknown>, key: string, path: string): unknown[] {
  const value = o[key];
  if (!Array.isArray(value)) throw new FormatError(join(path, key), `expected an array, got ${describe(value)}`);
  return value;
}

function str(o: Record<string, unknown>, key: string, path: string): string {
  const value = o[key];
  if (typeof value !== "string") throw new FormatError(join(path, key), `expected a string, got ${describe(value)}`);
  return value;
}

function bool(o: Record<string, unknown>, key: string, path: string): boolean {
  const value = o[key];
  if (typeof value !== "boolean") throw new FormatError(join(path, key), `expected a boolean, got ${describe(value)}`);
  return value;
}

function num(o: Record<string, unknown>, key: string, path: string): number {
  const value = o[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FormatError(join(path, key), `expected a number, got ${describe(value)}`);
  }
  return value;
}

function int(o: Record<string, unknown>, key: string, path: string): number {
  const value = num(o, key, path);
  if (!Number.isInteger(value)) throw new FormatError(join(path, key), `expected an integer, got ${value}`);
  return value;
}

function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return `the string ${JSON.stringify(value.length > 40 ? value.slice(0, 40) + "…" : value)}`;
  return typeof value === "object" ? "an object" : `${typeof value} ${String(value)}`;
}
