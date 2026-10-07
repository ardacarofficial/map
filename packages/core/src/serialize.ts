/**
 * Deterministic JSON for `project.smap` and `levels/<name>.json`.
 *
 * Rules (CLAUDE.md → Dosya düzeni): fixed key order, ordered arrays instead of
 * object maps, `\n` line endings, 2-space indent, trailing newline. The same
 * input always yields the same bytes.
 *
 * Chunk encoding: each chunk's 1024 cells (row-major) are written as
 * little-endian `Uint32` bytes, base64-encoded (4096 bytes → 5464 chars).
 * Chunks are sorted by `cy`, then `cx`. Empty chunks are never written.
 * Grid layers (v0.3) use the same chunk encoding; their values are terrain
 * ids / collision kinds instead of cells.
 *
 * v0.3 additions are optional fields with defaults, so
 * `documentFormatVersion` stays 1 and files without them are unchanged:
 * - tileset `solidTiles` (default none) and `terrains` (default none),
 *   written only when non-empty;
 * - level `seed` (default 0), written only when non-zero;
 * - layer `type: "grid"` with `role` and (terrain only) `target`.
 *
 * Core does not touch the filesystem: these functions produce and consume strings.
 */
import { decodeUint32LE, encodeUint32LE } from "./base64";
import { cellPaletteIndex, isValidCell } from "./cell";
import type { ClipLayer, TileClip } from "./clip";
import { CHUNK_AREA, CHUNK_SHIFT, CHUNK_SIZE } from "./chunk";
import { DOCUMENT_FORMAT_VERSION, MapDocument, isValidSeed, mapInfoProblem, type MapInfo } from "./document";
import { GridLayer, MAX_GRID_VALUE, TileLayer, isGridLayer, isGridRole, layerPropsProblem, type LayerProps } from "./layer";
import { isTerrainTemplate, type Terrain, type TerrainVariant } from "./terrain";
import { normalizeTileset, relativePathProblem, tilesetProblem, type Tileset } from "./tileset";

/** `format` field of a project file. */
export const PROJECT_FORMAT = "smap-project";
/** `format` field of a level file. */
export const LEVEL_FORMAT = "smap-level";
/** `format` field of a serialized clip (system clipboard). */
export const CLIP_FORMAT = "smap-clip";
/** Conventional project file name. */
export const PROJECT_FILE_NAME = "project.smap";

/** A level listed in the project file. */
export interface LevelRef {
  readonly name: string;
  /** Project-relative path, e.g. `"levels/main.json"`. */
  readonly path: string;
}

/** Contents of `project.smap`. */
export interface ProjectData {
  readonly name: string;
  readonly levels: readonly LevelRef[];
  readonly tilesets: readonly Tileset[];
}

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

/** Project file text. */
export function serializeProject(project: ProjectData): string {
  return toJson({
    format: PROJECT_FORMAT,
    documentFormatVersion: DOCUMENT_FORMAT_VERSION,
    name: project.name,
    levels: project.levels.map((level) => ({ name: level.name, path: level.path })),
    tilesets: project.tilesets.map(tilesetJson),
  });
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
        ? { role: layer.role, ...(layer.role === "terrain" ? { target: layer.targetLayerId } : {}) }
        : {}),
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      chunks: [...layer.chunks()]
        .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
        .map((chunk) => ({ cx: chunk.cx, cy: chunk.cy, data: encodeUint32LE(chunk.data) })),
    })),
  });
}

/**
 * Clip text for the system clipboard. Deterministic: same clip, same bytes.
 * Each layer's cells are little-endian `Uint32`, base64-encoded.
 */
export function serializeClip(clip: TileClip): string {
  return toJson({
    format: CLIP_FORMAT,
    documentFormatVersion: DOCUMENT_FORMAT_VERSION,
    width: clip.width,
    height: clip.height,
    palette: clip.palette.map((entry, i) => ({ index: i + 1, tilesetId: entry.tilesetId, tileId: entry.tileId })),
    layers: clip.layers.map((layer) => ({
      layerId: layer.layerId,
      name: layer.name,
      ...(layer.grid ? { grid: true } : {}),
      data: encodeUint32LE(layer.cells),
    })),
  });
}

function tilesetJson(tileset: Tileset): Record<string, unknown> {
  const t = normalizeTileset(tileset);
  return {
    id: t.id,
    name: t.name,
    imagePath: t.imagePath,
    tileWidth: t.tileWidth,
    tileHeight: t.tileHeight,
    columns: t.columns,
    rows: t.rows,
    margin: t.margin,
    spacing: t.spacing,
    ...(t.solidTiles ? { solidTiles: t.solidTiles } : {}),
    ...(t.terrains ? { terrains: t.terrains.map(terrainJson) } : {}),
  };
}

/** A terrain inside its tileset entry (`tilesetId` is implied by the owner). */
function terrainJson(t: Terrain): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    template: t.template,
    origin: { col: t.origin.col, row: t.origin.row },
    ...(t.variants ? { variants: t.variants.map((v) => ({ slot: v.slot, tileIds: v.tileIds })) } : {}),
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
export function parseProject(text: string): ProjectData {
  const root = readRoot(text, PROJECT_FORMAT, "project");
  const name = str(root, "name", "");
  const levels = arr(root, "levels", "").map((item, i): LevelRef => {
    const path = `levels[${i}]`;
    const level = obj(item, path);
    const ref = { name: str(level, "name", path), path: str(level, "path", path) };
    const problem = relativePathProblem(ref.path);
    if (problem) throw new FormatError(`${path}.path`, problem);
    return ref;
  });
  assertUnique(levels.map((l) => l.path), "levels", "path");
  const tilesets = arr(root, "tilesets", "").map((item, i) => readTileset(item, `tilesets[${i}]`));
  assertUnique(tilesets.map((t) => t.id), "tilesets", "id");
  assertUniqueTerrains(tilesets, "tilesets");
  return { name, levels, tilesets };
}

/**
 * Parses and validates a level file into a new `MapDocument`.
 *
 * `tilesets` (from the project file) are attached to the document. Palette
 * entries pointing at a tileset that is not listed are kept, so a level still
 * opens when a tileset is missing; the renderer should show those tiles as missing.
 *
 * @throws FormatError with a descriptive message on any problem, including a newer `documentFormatVersion`.
 */
export function parseLevel(text: string, tilesets: readonly Tileset[] = []): MapDocument {
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
  assertUniqueTerrains(doc.tilesets, "tilesets");

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

  const targets: { path: string; target: string }[] = [];
  arr(root, "layers", "").forEach((item, i) => {
    const path = `layers[${i}]`;
    const layerObj = obj(item, path);
    const type = str(layerObj, "type", path);
    if (type !== "tile" && type !== "grid") throw new FormatError(`${path}.type`, `unsupported layer type "${type}"`);
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
      let target: string | null = null;
      if (role === "terrain") {
        const raw = layerObj["target"];
        if (raw !== null && raw !== undefined) target = str(layerObj, "target", path);
        if (target !== null) targets.push({ path: `${path}.target`, target });
      } else if (layerObj["target"] !== undefined) {
        throw new FormatError(`${path}.target`, "only terrain grid layers have a target");
      }
      layer = new GridLayer(props, role, target);
    } else {
      if (layerObj["role"] !== undefined) throw new FormatError(`${path}.role`, "only grid layers have a role");
      layer = new TileLayer(props);
    }
    readChunks(arr(layerObj, "chunks", path), `${path}.chunks`, layer, doc);
    doc._insertLayer(layer, doc.layers.length);
  });

  // A target may dangle (its tile layer was removed; derivation is then
  // skipped), but two terrain layers never share one.
  const seenTargets = new Set<string>();
  for (const { path, target } of targets) {
    if (seenTargets.has(target)) throw new FormatError(path, `tile layer "${target}" is the target of two terrain layers`);
    seenTargets.add(target);
  }

  return doc;
}

/**
 * Parses and validates clip text (e.g. from the system clipboard).
 * @throws FormatError on any problem (also when the text is not a clip at all).
 */
export function parseClip(text: string): TileClip {
  const root = readRoot(text, CLIP_FORMAT, "clip");
  const width = int(root, "width", "");
  const height = int(root, "height", "");
  if (width < 1 || height < 1 || width * height > 1 << 26) {
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
    return Object.freeze(grid ? { layerId, name, grid: true, cells } : { layerId, name, cells });
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

function readRoot(text: string, format: string, what: string): Record<string, unknown> {
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
  return root;
}

function readTileset(item: unknown, path: string): Tileset {
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
  let solidTiles: number[] | undefined;
  if (t["solidTiles"] !== undefined) {
    solidTiles = arr(t, "solidTiles", path).map((v, i) => intValue(v, `${path}.solidTiles[${i}]`));
    for (let i = 1; i < solidTiles.length; i++) {
      if (solidTiles[i]! <= solidTiles[i - 1]!) throw new FormatError(`${path}.solidTiles`, "must be strictly ascending");
    }
  }
  let terrains: Terrain[] | undefined;
  if (t["terrains"] !== undefined) {
    terrains = arr(t, "terrains", path).map((item, i) => readTerrain(item, `${path}.terrains[${i}]`, tileset.id));
    for (let i = 1; i < terrains.length; i++) {
      if (terrains[i]!.id <= terrains[i - 1]!.id) throw new FormatError(`${path}.terrains`, "must be sorted by ascending id without duplicates");
    }
  }
  const full: Tileset = {
    ...tileset,
    ...(solidTiles && solidTiles.length > 0 ? { solidTiles } : {}),
    ...(terrains && terrains.length > 0 ? { terrains } : {}),
  };
  const problem = tilesetProblem(full);
  if (problem) throw new FormatError(path, problem);
  return full;
}

function readTerrain(item: unknown, path: string, tilesetId: string): Terrain {
  const t = obj(item, path);
  const originObj = obj(t["origin"], `${path}.origin`);
  const template = str(t, "template", path);
  if (!isTerrainTemplate(template)) throw new FormatError(`${path}.template`, `unknown template "${template}"`);
  let variants: TerrainVariant[] | undefined;
  if (t["variants"] !== undefined) {
    variants = arr(t, "variants", path).map((v, i): TerrainVariant => {
      const vp = `${path}.variants[${i}]`;
      const vo = obj(v, vp);
      const tileIds = arr(vo, "tileIds", vp).map((id, j) => intValue(id, `${vp}.tileIds[${j}]`));
      if (tileIds.length === 0) throw new FormatError(`${vp}.tileIds`, "must not be empty");
      if (new Set(tileIds).size !== tileIds.length) throw new FormatError(`${vp}.tileIds`, "must not contain duplicates");
      return { slot: int(vo, "slot", vp), tileIds };
    });
    for (let i = 1; i < variants.length; i++) {
      if (variants[i]!.slot <= variants[i - 1]!.slot) throw new FormatError(`${path}.variants`, "must be sorted by ascending slot without duplicates");
    }
  }
  return {
    id: int(t, "id", path),
    name: str(t, "name", path),
    tilesetId,
    template,
    origin: { col: int(originObj, "col", `${path}.origin`), row: int(originObj, "row", `${path}.origin`) },
    ...(variants && variants.length > 0 ? { variants } : {}),
  };
}

function assertUniqueTerrains(tilesets: readonly Tileset[], path: string): void {
  const seen = new Map<number, string>();
  for (const tileset of tilesets) {
    for (const terrain of tileset.terrains ?? []) {
      const other = seen.get(terrain.id);
      if (other !== undefined) {
        throw new FormatError(path, `terrain id ${terrain.id} is used by tilesets "${other}" and "${tileset.id}"`);
      }
      seen.set(terrain.id, tileset.id);
    }
  }
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

function intValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new FormatError(path, `expected an integer, got ${describe(value)}`);
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
