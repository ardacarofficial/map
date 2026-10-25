/**
 * Simple Tiled import (v2.2): orthogonal TMJ (JSON) and TMX (XML) maps,
 * tile layers only. Pure: text in, plain data out; the caller reads files
 * (external `.tsx` / `.tsj` tilesets, PNGs) and builds the map with ordinary
 * store operations. Everything that cannot be imported is collected in
 * `unsupported` (object/image layers, group structure, animations, ...).
 *
 * Tiled's gid flag bits are the same as our cell's (bit 31 H, bit 30 V,
 * bit 29 D = transpose applied before H/V) — the TMJ exporter writes them
 * unchanged, so the importer reads them unchanged. Bit 28 (hex 120°) is
 * dropped and listed.
 */
import { gunzipSync, unzlibSync } from "fflate";
import { decodeBase64 } from "../base64";
import { CELL_FLAG_MASK } from "../cell";
import { MAX_MAP_SIZE } from "../document";
import { parseXml, type XmlElement } from "./xml";

/** Tiled's hexagonal 120° rotation flag (unused on orthogonal maps). */
export const TILED_FLIP_HEX = 0x1000_0000;
const TILED_FLAG_BITS = 0xf000_0000;

export type TiledUnsupportedKind =
  | "objectLayer"
  | "imageLayer"
  | "groupLayer"
  | "layerOffset"
  | "parallax"
  | "tint"
  | "properties"
  | "animation"
  | "tileCollision"
  | "wangSets"
  | "tileOffset"
  | "imageCollection"
  | "imageFormat"
  | "tileSize"
  | "missingTileset"
  | "missingImage"
  | "unknownTile"
  | "hexRotation";

/** One thing that was not imported; `count` = affected cells / tiles where that applies. */
export interface TiledUnsupported {
  readonly kind: TiledUnsupportedKind;
  readonly name?: string;
  readonly count?: number;
}

export type TiledImportErrorCode = "format" | "orientation" | "compression" | "encoding" | "size" | "noTileLayers";

export class TiledImportError extends Error {
  constructor(readonly code: TiledImportErrorCode, message: string) {
    super(message);
    this.name = "TiledImportError";
  }
}

export interface TiledTilesetDef {
  readonly name: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly margin: number;
  readonly spacing: number;
  readonly columns: number;
  readonly tileCount: number;
  /** Sheet image; `path` is resolved against the file that declared it. `null` = image collection. */
  readonly image: { readonly path: string; readonly width: number; readonly height: number } | null;
  readonly unsupported: readonly TiledUnsupported[];
}

/** A map's tileset reference: external (`source`, resolved path) or embedded (`def`). */
export type TiledTilesetEntry =
  | { readonly firstGid: number; readonly source: string; readonly def?: undefined }
  | { readonly firstGid: number; readonly def: TiledTilesetDef; readonly source?: undefined };

export interface TiledLayerDef {
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  /** Raw gids (flags included), row-major over the map's width × height. */
  readonly gids: Uint32Array;
}

export interface TiledMapDef {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly layers: readonly TiledLayerDef[];
  readonly tilesets: readonly TiledTilesetEntry[];
  readonly unsupported: readonly TiledUnsupported[];
}

/** Map / tileset files the importer understands, by extension. */
export const TILED_MAP_EXTENSIONS = [".tmx", ".tmj", ".json"] as const;
export const TILED_TILESET_EXTENSIONS = [".tsx", ".tsj", ".json"] as const;

// ------------------------------------------------------------------ paths

const isAbsolutePath = (p: string) => p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(p);

/** `rel` resolved against the directory of `fromFile`; `/`-separated, `.`/`..` removed. */
export function resolveTiledPath(fromFile: string, rel: string): string {
  const base = fromFile.replace(/\\/g, "/");
  const target = rel.replace(/\\/g, "/");
  const joined = isAbsolutePath(target) ? target : `${base.slice(0, base.lastIndexOf("/") + 1)}${target}`;
  const lead = joined.startsWith("//") ? "//" : joined.startsWith("/") ? "/" : "";
  const out: string[] = [];
  for (const part of joined.slice(lead.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out.at(-1) !== ".." && !/^[A-Za-z]:$/.test(out.at(-1)!)) out.pop();
    else if (part !== ".." || lead === "") out.push(part);
  }
  return lead + out.join("/");
}

/** File name without directory and extension. */
export function tiledBaseName(path: string): string {
  const file = path.replace(/\\/g, "/").split("/").at(-1) ?? path;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

// ------------------------------------------------------------------ helpers

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function int(v: unknown, what: string, min = 0): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min) throw new TiledImportError("format", `${what} must be an integer ≥ ${min}`);
  return n;
}
const optInt = (v: unknown, what: string, fallback: number) => (v === undefined ? fallback : int(v, what));
function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}
const bool = (v: unknown, fallback: boolean) => (v === undefined ? fallback : v === true || v === 1 || v === "1" || v === "true");

class Notes {
  readonly list: TiledUnsupported[] = [];
  add(kind: TiledUnsupportedKind, name?: string, count?: number): void {
    const same = this.list.findIndex(u => u.kind === kind && u.name === name);
    if (same >= 0 && count !== undefined) {
      const prev = this.list[same]!;
      this.list[same] = { ...prev, count: (prev.count ?? 0) + count };
      return;
    }
    if (same >= 0) return;
    this.list.push({ kind, ...(name !== undefined ? { name } : {}), ...(count !== undefined ? { count } : {}) });
  }
}

function inflate(bytes: Uint8Array, compression: string): Uint8Array {
  try {
    if (compression === "zlib") return unzlibSync(bytes);
    if (compression === "gzip") return gunzipSync(bytes);
  } catch (error) {
    throw new TiledImportError("encoding", `${compression} data is corrupt: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new TiledImportError("compression", `${compression} compression is not supported; save the map with CSV, Base64 (uncompressed), zlib or gzip`);
}

/** Gids from TMJ/TMX layer data (array, CSV or Base64, optionally zlib/gzip). */
function decodeGids(data: unknown, encoding: string | undefined, compression: string | undefined, expected: number): Uint32Array {
  let out: Uint32Array;
  if (Array.isArray(data)) {
    out = new Uint32Array(data.length);
    data.forEach((v, i) => { out[i] = int(v, "gid") >>> 0; });
  } else if (typeof data === "string" && (encoding === "csv" || encoding === undefined)) {
    const parts = data.split(/[\s,]+/).filter(s => s.length > 0);
    out = new Uint32Array(parts.length);
    parts.forEach((s, i) => { out[i] = int(s, "gid") >>> 0; });
  } else if (typeof data === "string" && encoding === "base64") {
    let bytes = decodeBase64(data.replace(/\s+/g, ""));
    if (compression) bytes = inflate(bytes, compression);
    if (bytes.length % 4 !== 0) throw new TiledImportError("encoding", "Base64 layer data is not a whole number of gids");
    out = new Uint32Array(bytes.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = (bytes[i * 4]! | (bytes[i * 4 + 1]! << 8) | (bytes[i * 4 + 2]! << 16) | (bytes[i * 4 + 3]! << 24)) >>> 0;
  } else {
    throw new TiledImportError("encoding", `unknown layer encoding ${String(encoding)}`);
  }
  if (out.length !== expected) throw new TiledImportError("format", `layer data has ${out.length} cells, expected ${expected}`);
  return out;
}

/** Layer data before placement: the whole map, or chunks of an infinite map. */
interface RawLayer {
  name: string; visible: boolean; locked: boolean; opacity: number;
  parts: { x: number; y: number; width: number; height: number; gids: Uint32Array }[];
}

function checkArea(width: number, height: number, what: string): void {
  if (width * height > MAX_MAP_SIZE * MAX_MAP_SIZE) throw new TiledImportError("size", `${what} is too large`);
}

/** Places raw layers on one finite grid (infinite maps: the bounds of all non-empty cells). */
function placeLayers(raw: readonly RawLayer[], infinite: boolean, width: number, height: number): { width: number; height: number; layers: TiledLayerDef[] } {
  let minX = 0, minY = 0;
  if (infinite) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const layer of raw) for (const p of layer.parts) for (let i = 0; i < p.gids.length; i++) if ((p.gids[i]! & ~TILED_FLAG_BITS) !== 0) {
      const x = p.x + (i % p.width), y = p.y + Math.floor(i / p.width);
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    if (x0 === Infinity) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
    minX = x0; minY = y0; width = x1 - x0 + 1; height = y1 - y0 + 1;
  }
  if (width > MAX_MAP_SIZE || height > MAX_MAP_SIZE) throw new TiledImportError("size", `map is ${width}×${height}; the limit is ${MAX_MAP_SIZE}×${MAX_MAP_SIZE}`);
  const layers = raw.map(layer => {
    const gids = new Uint32Array(width * height);
    for (const p of layer.parts) for (let i = 0; i < p.gids.length; i++) {
      const g = p.gids[i]!;
      if (g === 0) continue;
      const x = p.x + (i % p.width) - minX, y = p.y + Math.floor(i / p.width) - minY;
      if (x >= 0 && y >= 0 && x < width && y < height) gids[y * width + x] = g;
    }
    return { name: layer.name, visible: layer.visible, locked: layer.locked, opacity: layer.opacity, gids };
  });
  return { width, height, layers };
}

function layerExtras(notes: Notes, name: string, l: { offsetx?: unknown; offsety?: unknown; parallaxx?: unknown; parallaxy?: unknown; tintcolor?: unknown; hasProperties: boolean }): void {
  if (num(l.offsetx, 0) !== 0 || num(l.offsety, 0) !== 0) notes.add("layerOffset", name);
  if (num(l.parallaxx, 1) !== 1 || num(l.parallaxy, 1) !== 1) notes.add("parallax", name);
  if (typeof l.tintcolor === "string" && l.tintcolor !== "" && !/^#?(ff)?ffffff$/i.test(l.tintcolor)) notes.add("tint", name);
  if (l.hasProperties) notes.add("properties", name);
}

const PNG_PATH = /\.png$/i;

// ------------------------------------------------------------------ JSON (TMJ / TSJ)

function jsonTileset(o: Record<string, unknown>, file: string, notes: Notes): TiledTilesetDef {
  const name = typeof o.name === "string" && o.name ? o.name : tiledBaseName(file);
  const tileWidth = int(o.tilewidth, "tilewidth", 1), tileHeight = int(o.tileheight, "tileheight", 1);
  const tiles = Array.isArray(o.tiles) ? o.tiles.filter(isRecord) : [];
  const animations = tiles.filter(t => Array.isArray(t.animation) && t.animation.length > 0).length;
  if (animations) notes.add("animation", name, animations);
  const shapes = tiles.filter(t => isRecord(t.objectgroup)).length;
  if (shapes) notes.add("tileCollision", name, shapes);
  if (Array.isArray(o.wangsets) && o.wangsets.length > 0) notes.add("wangSets", name);
  if (isRecord(o.tileoffset) && (num(o.tileoffset.x, 0) !== 0 || num(o.tileoffset.y, 0) !== 0)) notes.add("tileOffset", name);
  let image: TiledTilesetDef["image"] = null;
  if (typeof o.image === "string" && o.image) {
    image = { path: resolveTiledPath(file, o.image), width: optInt(o.imagewidth, "imagewidth", 0), height: optInt(o.imageheight, "imageheight", 0) };
    if (!PNG_PATH.test(o.image)) notes.add("imageFormat", name);
  } else notes.add("imageCollection", name);
  return {
    name, tileWidth, tileHeight,
    margin: optInt(o.margin, "margin", 0), spacing: optInt(o.spacing, "spacing", 0),
    columns: optInt(o.columns, "columns", 0), tileCount: optInt(o.tilecount, "tilecount", 0),
    image, unsupported: notes.list,
  };
}

function jsonMap(o: Record<string, unknown>, file: string): TiledMapDef {
  const notes = new Notes();
  if (o.orientation !== undefined && o.orientation !== "orthogonal") throw new TiledImportError("orientation", `${String(o.orientation)} maps are not supported; only orthogonal maps can be imported`);
  const infinite = bool(o.infinite, false);
  const width = int(o.width, "width", infinite ? 0 : 1), height = int(o.height, "height", infinite ? 0 : 1);
  checkArea(width, height, "map");
  if (Array.isArray(o.properties) && o.properties.length > 0) notes.add("properties");
  const raw: RawLayer[] = [];
  const walk = (layers: unknown, prefix: string) => {
    if (!Array.isArray(layers)) return;
    for (const l of layers) {
      if (!isRecord(l)) continue;
      const name = `${prefix}${typeof l.name === "string" ? l.name : ""}`;
      if (l.type === "group") { notes.add("groupLayer", name); walk(l.layers, `${name}/`); continue; }
      if (l.type === "objectgroup") { notes.add("objectLayer", name); continue; }
      if (l.type === "imagelayer") { notes.add("imageLayer", name); continue; }
      if (l.type !== "tilelayer") continue;
      layerExtras(notes, name, { ...l, hasProperties: Array.isArray(l.properties) && l.properties.length > 0 });
      const encoding = typeof l.encoding === "string" ? l.encoding : undefined;
      const compression = typeof l.compression === "string" && l.compression ? l.compression : undefined;
      const parts: RawLayer["parts"] = [];
      if (infinite && Array.isArray(l.chunks)) {
        for (const c of l.chunks) {
          if (!isRecord(c)) continue;
          const cw = int(c.width, "chunk width", 1), ch = int(c.height, "chunk height", 1);
          parts.push({ x: int(c.x, "chunk x", -Infinity), y: int(c.y, "chunk y", -Infinity), width: cw, height: ch, gids: decodeGids(c.data, encoding ?? (Array.isArray(c.data) ? undefined : "base64"), compression, cw * ch) });
        }
      } else {
        const lw = optInt(l.width, "layer width", width), lh = optInt(l.height, "layer height", height);
        checkArea(lw, lh, "layer");
        parts.push({ x: optInt(l.x, "layer x", 0), y: optInt(l.y, "layer y", 0), width: lw, height: lh, gids: decodeGids(l.data, encoding ?? (Array.isArray(l.data) ? undefined : "base64"), compression, lw * lh) });
      }
      raw.push({ name, visible: bool(l.visible, true), locked: bool(l.locked, false), opacity: Math.min(1, Math.max(0, num(l.opacity, 1))), parts });
    }
  };
  walk(o.layers, "");
  const tilesets: TiledTilesetEntry[] = [];
  if (Array.isArray(o.tilesets)) for (const t of o.tilesets) {
    if (!isRecord(t)) continue;
    const firstGid = int(t.firstgid, "firstgid", 1);
    if (typeof t.source === "string") tilesets.push({ firstGid, source: resolveTiledPath(file, t.source) });
    else tilesets.push({ firstGid, def: jsonTileset(t, file, new Notes()) });
  }
  return finish(file, raw, infinite, width, height, int(o.tilewidth, "tilewidth", 1), int(o.tileheight, "tileheight", 1), tilesets, notes);
}

function finish(file: string, raw: RawLayer[], infinite: boolean, width: number, height: number, tileWidth: number, tileHeight: number, tilesets: TiledTilesetEntry[], notes: Notes): TiledMapDef {
  if (raw.length === 0) throw new TiledImportError("noTileLayers", "the map has no tile layer");
  const placed = placeLayers(raw, infinite, width, height);
  return { name: tiledBaseName(file), width: placed.width, height: placed.height, tileWidth, tileHeight, layers: placed.layers, tilesets: [...tilesets].sort((a, b) => a.firstGid - b.firstGid), unsupported: notes.list };
}

// ------------------------------------------------------------------ XML (TMX / TSX)

const child = (e: XmlElement, name: string) => e.children.find(c => c.name === name);
const hasProperties = (e: XmlElement) => (child(e, "properties")?.children.length ?? 0) > 0;

/** Gids of a TMX `<data>` (or `<chunk>`) element. */
function xmlGids(data: XmlElement, encoding: string | undefined, compression: string | undefined, expected: number): Uint32Array {
  if (encoding === undefined) {
    const tiles = data.children.filter(c => c.name === "tile");
    return decodeGids(tiles.map(t => (t.attrs.gid === undefined ? 0 : Number(t.attrs.gid))), undefined, undefined, expected);
  }
  return decodeGids(data.text.trim(), encoding, compression, expected);
}

function xmlTileset(e: XmlElement, file: string, notes: Notes): TiledTilesetDef {
  const a = e.attrs;
  const name = a.name || tiledBaseName(file);
  const tiles = e.children.filter(c => c.name === "tile");
  const animations = tiles.filter(t => (child(t, "animation")?.children.length ?? 0) > 0).length;
  if (animations) notes.add("animation", name, animations);
  const shapes = tiles.filter(t => child(t, "objectgroup")).length;
  if (shapes) notes.add("tileCollision", name, shapes);
  if ((child(e, "wangsets")?.children.length ?? 0) > 0 || child(e, "terraintypes")) notes.add("wangSets", name);
  const offset = child(e, "tileoffset");
  if (offset && (num(offset.attrs.x, 0) !== 0 || num(offset.attrs.y, 0) !== 0)) notes.add("tileOffset", name);
  const img = child(e, "image");
  let image: TiledTilesetDef["image"] = null;
  if (img?.attrs.source) {
    image = { path: resolveTiledPath(file, img.attrs.source), width: optInt(img.attrs.width, "image width", 0), height: optInt(img.attrs.height, "image height", 0) };
    if (!PNG_PATH.test(img.attrs.source)) notes.add("imageFormat", name);
  } else notes.add("imageCollection", name);
  return {
    name, tileWidth: int(a.tilewidth, "tilewidth", 1), tileHeight: int(a.tileheight, "tileheight", 1),
    margin: optInt(a.margin, "margin", 0), spacing: optInt(a.spacing, "spacing", 0),
    columns: optInt(a.columns, "columns", 0), tileCount: optInt(a.tilecount, "tilecount", 0),
    image, unsupported: notes.list,
  };
}

function xmlMap(root: XmlElement, file: string): TiledMapDef {
  const notes = new Notes();
  const a = root.attrs;
  if (a.orientation !== undefined && a.orientation !== "orthogonal") throw new TiledImportError("orientation", `${a.orientation} maps are not supported; only orthogonal maps can be imported`);
  const infinite = bool(a.infinite, false);
  const width = int(a.width, "width", infinite ? 0 : 1), height = int(a.height, "height", infinite ? 0 : 1);
  checkArea(width, height, "map");
  if (hasProperties(root)) notes.add("properties");
  const raw: RawLayer[] = [];
  const walk = (parent: XmlElement, prefix: string) => {
    for (const l of parent.children) {
      const name = `${prefix}${l.attrs.name ?? ""}`;
      if (l.name === "group") { notes.add("groupLayer", name); walk(l, `${name}/`); continue; }
      if (l.name === "objectgroup") { notes.add("objectLayer", name); continue; }
      if (l.name === "imagelayer") { notes.add("imageLayer", name); continue; }
      if (l.name !== "layer") continue;
      layerExtras(notes, name, { ...l.attrs, hasProperties: hasProperties(l) });
      const data = child(l, "data");
      const encoding = data?.attrs.encoding, compression = data?.attrs.compression || undefined;
      const parts: RawLayer["parts"] = [];
      if (data && infinite) {
        for (const c of data.children.filter(c => c.name === "chunk")) {
          const cw = int(c.attrs.width, "chunk width", 1), ch = int(c.attrs.height, "chunk height", 1);
          parts.push({ x: int(c.attrs.x, "chunk x", -Infinity), y: int(c.attrs.y, "chunk y", -Infinity), width: cw, height: ch, gids: xmlGids(c, encoding, compression, cw * ch) });
        }
      } else if (data) {
        const lw = optInt(l.attrs.width, "layer width", width), lh = optInt(l.attrs.height, "layer height", height);
        checkArea(lw, lh, "layer");
        parts.push({ x: 0, y: 0, width: lw, height: lh, gids: xmlGids(data, encoding, compression, lw * lh) });
      }
      raw.push({ name, visible: bool(l.attrs.visible, true), locked: bool(l.attrs.locked, false), opacity: Math.min(1, Math.max(0, num(l.attrs.opacity, 1))), parts });
    }
  };
  walk(root, "");
  const tilesets: TiledTilesetEntry[] = [];
  for (const t of root.children.filter(c => c.name === "tileset")) {
    const firstGid = int(t.attrs.firstgid, "firstgid", 1);
    if (t.attrs.source !== undefined) tilesets.push({ firstGid, source: resolveTiledPath(file, t.attrs.source) });
    else tilesets.push({ firstGid, def: xmlTileset(t, file, new Notes()) });
  }
  return finish(file, raw, infinite, width, height, int(a.tilewidth, "tilewidth", 1), int(a.tileheight, "tileheight", 1), tilesets, notes);
}

// ------------------------------------------------------------------ public parsers

function sniff(text: string): "json" | "xml" {
  const head = text.replace(/^\uFEFF/, "").trimStart();
  if (head.startsWith("{")) return "json";
  if (head.startsWith("<")) return "xml";
  throw new TiledImportError("format", "not a Tiled map (expected JSON or XML)");
}

function parseJson(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); } catch (error) { throw new TiledImportError("format", `invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!isRecord(value)) throw new TiledImportError("format", "invalid JSON: expected an object");
  return value;
}

function parseXmlRoot(text: string, expected: string): XmlElement {
  let root: XmlElement;
  try { root = parseXml(text); } catch (error) { throw new TiledImportError("format", error instanceof Error ? error.message : String(error)); }
  if (root.name !== expected) throw new TiledImportError("format", `expected <${expected}>, found <${root.name}>`);
  return root;
}

/** Parses a TMJ or TMX map. `path` names the file (relative references resolve against it). */
export function parseTiledMap(text: string, path: string): TiledMapDef {
  if (sniff(text) === "json") {
    const o = parseJson(text);
    if (o.type !== undefined && o.type !== "map") throw new TiledImportError("format", `expected a Tiled map, found type "${String(o.type)}"`);
    return jsonMap(o, path);
  }
  return xmlMap(parseXmlRoot(text, "map"), path);
}

/** Parses an external TSX or TSJ tileset. */
export function parseTiledTileset(text: string, path: string): TiledTilesetDef {
  if (sniff(text) === "json") return jsonTileset(parseJson(text), path, new Notes());
  return xmlTileset(parseXmlRoot(text, "tileset"), path, new Notes());
}

// ------------------------------------------------------------------ cells

/** One imported cell: tileset index into `TiledMapDef.tilesets`, tile id, our flag bits. */
export interface TiledCell { readonly x: number; readonly y: number; readonly tileset: number; readonly tileId: number; readonly flags: number }

export interface TiledCellLayer {
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly cells: readonly TiledCell[];
}

/**
 * Splits gids into (tileset, tile id, flags). `tileLimit[i]` is the number
 * of tiles usable in tileset `i` (its sheet grid), or `null` when that
 * tileset cannot be imported (missing file, wrong tile size, ...; the caller
 * lists why). Cells of unusable tilesets, gids beyond any tileset and hex
 * rotation bits are counted in `unsupported`.
 */
export function tiledCellLayers(map: TiledMapDef, tileLimit: readonly (number | null)[]): { layers: TiledCellLayer[]; unsupported: TiledUnsupported[]; skipped: number[] } {
  const notes = new Notes();
  const skipped = map.tilesets.map(() => 0);
  let unknown = 0, hex = 0;
  const layers = map.layers.map(layer => {
    const cells: TiledCell[] = [];
    for (let i = 0; i < layer.gids.length; i++) {
      const raw = layer.gids[i]!;
      const gid = (raw & ~TILED_FLAG_BITS) >>> 0;
      if (gid === 0) continue;
      let index = -1;
      for (let t = map.tilesets.length - 1; t >= 0; t--) if (map.tilesets[t]!.firstGid <= gid) { index = t; break; }
      if (index < 0) { unknown++; continue; }
      const limit = tileLimit[index];
      if (limit === null || limit === undefined) { skipped[index]!++; continue; }
      const tileId = gid - map.tilesets[index]!.firstGid;
      if (tileId >= limit) { unknown++; continue; }
      if (raw & TILED_FLIP_HEX) hex++;
      cells.push({ x: i % map.width, y: Math.floor(i / map.width), tileset: index, tileId, flags: (raw & CELL_FLAG_MASK) >>> 0 });
    }
    return { name: layer.name, visible: layer.visible, locked: layer.locked, opacity: layer.opacity, cells };
  });
  if (unknown) notes.add("unknownTile", undefined, unknown);
  if (hex) notes.add("hexRotation", undefined, hex);
  return { layers, unsupported: notes.list, skipped };
}
