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
 *
 * Core does not touch the filesystem: these functions produce and consume strings.
 */
import { decodeUint32LE, encodeUint32LE } from "./base64";
import { cellPaletteIndex, isValidCell } from "./cell";
import { CHUNK_AREA, CHUNK_SHIFT, CHUNK_SIZE } from "./chunk";
import { DOCUMENT_FORMAT_VERSION, MapDocument, mapInfoProblem, type MapInfo } from "./document";
import { TileLayer, layerPropsProblem, type LayerProps } from "./layer";
import { relativePathProblem, tilesetProblem, type Tileset } from "./tileset";

/** `format` field of a project file. */
export const PROJECT_FORMAT = "smap-project";
/** `format` field of a level file. */
export const LEVEL_FORMAT = "smap-level";
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
    palette: doc.palette.entries().map((entry, i) => ({
      index: i + 1,
      tilesetId: entry.tilesetId,
      tileId: entry.tileId,
    })),
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      chunks: [...layer.chunks()]
        .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
        .map((chunk) => ({ cx: chunk.cx, cy: chunk.cy, data: encodeUint32LE(chunk.data) })),
    })),
  });
}

function tilesetJson(t: Tileset): Record<string, unknown> {
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

  const doc = new MapDocument(map);
  for (const tileset of tilesets) {
    if (doc.getTileset(tileset.id)) throw new FormatError("tilesets", `duplicate tileset id "${tileset.id}"`);
    doc._addTileset(tileset);
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

  arr(root, "layers", "").forEach((item, i) => {
    const path = `layers[${i}]`;
    const layerObj = obj(item, path);
    const type = str(layerObj, "type", path);
    if (type !== "tile") throw new FormatError(`${path}.type`, `unsupported layer type "${type}"`);
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
    const layer = new TileLayer(props);
    readChunks(arr(layerObj, "chunks", path), `${path}.chunks`, layer, doc);
    doc._insertLayer(layer, doc.layers.length);
  });

  return doc;
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
    for (let j = 0; j < CHUNK_AREA; j++) {
      const cell = data[j]!;
      if (cell === 0) continue;
      const x = cx * CHUNK_SIZE + (j & (CHUNK_SIZE - 1));
      const y = cy * CHUNK_SIZE + (j >> CHUNK_SHIFT);
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
  const problem = tilesetProblem(tileset);
  if (problem) throw new FormatError(path, problem);
  return tileset;
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
