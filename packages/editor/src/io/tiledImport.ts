/**
 * Simple Tiled import (v2.2), shared by Dosya → İçe aktar → Tiled haritası…
 * and the agent's import_tiled: read the map and the files it references
 * through a host reader, parse with core, decode the sheets and plan world
 * tilesets. The user's files are only read; PNG bytes are copied into the
 * project as new tilesets (identical sheets already in the world are reused).
 */
import {
  parseTiledMap, parseTiledTileset, tiledBaseName, tiledCellLayers, TiledImportError,
  type TiledMapDef, type TiledTilesetDef, type TiledUnsupported, type TiledUnsupportedKind, type Tileset,
} from "@smap/core";
import { decodePng } from "./projectIo";
import { hasPngSignature, planTilesetGrid } from "./tilesetImport";

/** Reads one file by path (absolute on desktop / MCP, a picked file name in the browser). */
export type TiledReader = (path: string) => Promise<Uint8Array>;

/** The map file itself could not be read (missing, too large, wrong type). */
export class TiledReadError extends Error {
  constructor(readonly path: string, readonly detail: string) {
    super(`Could not read ${path}: ${detail}`);
    this.name = "TiledReadError";
  }
}

export interface TiledSheet { readonly name: string; readonly bytes: Uint8Array; readonly bitmap: ImageBitmap }

export interface LoadedTiledTileset {
  readonly def: TiledTilesetDef | null;
  readonly sheet: TiledSheet | null;
  /** Why this tileset's cells cannot be imported (null = usable). */
  readonly problem: TiledUnsupportedKind | null;
  /** Display name for problem reports. */
  readonly label: string;
}

export interface LoadedTiled {
  readonly path: string;
  readonly map: TiledMapDef;
  /** Parallel to `map.tilesets`. */
  readonly tilesets: readonly LoadedTiledTileset[];
  /** Map- and tileset-level notes (cell counts come from {@link buildTiledContent}). */
  readonly unsupported: readonly TiledUnsupported[];
}

const decoder = new TextDecoder("utf-8");
const signal0 = { throwIfAborted() {} };

/** Reads, parses and decodes a Tiled map and its tilesets. Close sheets with {@link closeTiled}. */
export async function loadTiled(path: string, read: TiledReader, signal: { throwIfAborted(): void } = signal0): Promise<LoadedTiled> {
  let text: string;
  try { text = decoder.decode(await read(path)); } catch (error) { signal.throwIfAborted(); throw new TiledReadError(path, error instanceof Error ? error.message : String(error)); }
  signal.throwIfAborted();
  const map = parseTiledMap(text, path);
  const notes: TiledUnsupported[] = [...map.unsupported];
  const external = new Map<string, Promise<TiledTilesetDef | null>>();
  const sheets = new Map<string, Promise<TiledSheet | null>>();
  const out: LoadedTiledTileset[] = [];
  try {
    for (const entry of map.tilesets) {
      let def: TiledTilesetDef | null;
      if (entry.def) def = entry.def;
      else {
        const source = entry.source;
        if (!external.has(source)) external.set(source, read(source).then(bytes => parseTiledTileset(decoder.decode(bytes), source)).catch(() => null));
        def = await external.get(source)!;
      }
      signal.throwIfAborted();
      const label = def?.name ?? tiledBaseName(entry.source ?? "");
      if (!def) { out.push({ def, sheet: null, problem: "missingTileset", label }); continue; }
      for (const u of def.unsupported) if (!notes.some(n => n.kind === u.kind && n.name === u.name)) notes.push(u);
      if (!def.image) { out.push({ def, sheet: null, problem: "imageCollection", label }); continue; }
      if (!/\.png$/i.test(def.image.path)) { out.push({ def, sheet: null, problem: "imageFormat", label }); continue; }
      if (def.tileWidth !== map.tileWidth || def.tileHeight !== map.tileHeight) { out.push({ def, sheet: null, problem: "tileSize", label }); continue; }
      const imagePath = def.image.path;
      if (!sheets.has(imagePath)) sheets.set(imagePath, read(imagePath).then(async bytes => {
        if (!hasPngSignature(bytes)) return null;
        return { name: imagePath.split("/").at(-1) ?? imagePath, bytes, bitmap: await decodePng(bytes) };
      }).catch(() => null));
      const sheet = await sheets.get(imagePath)!;
      signal.throwIfAborted();
      out.push({ def, sheet, problem: sheet ? null : "missingImage", label });
    }
  } catch (error) {
    for (const p of sheets.values()) void p.then(s => s?.bitmap.close());
    throw error;
  }
  return { path, map, tilesets: out, unsupported: notes };
}

/** Closes every decoded sheet bitmap not handed on (`keep`). */
export function closeTiled(loaded: LoadedTiled, keep: ReadonlySet<ImageBitmap> = new Set()): void {
  const seen = new Set<ImageBitmap>();
  for (const t of loaded.tilesets) if (t.sheet && !keep.has(t.sheet.bitmap) && !seen.has(t.sheet.bitmap)) { seen.add(t.sheet.bitmap); t.sheet.bitmap.close(); }
}

export interface PlannedTiledTileset {
  readonly tileset: Tileset;
  readonly sheet: TiledSheet;
  /** An identical sheet + grid already in the world. */
  readonly reused: boolean;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * World tilesets for the usable Tiled tilesets (parallel to `loaded.tilesets`,
 * `null` = not importable). New ids avoid `taken` (updated in place); a sheet
 * shared by two Tiled tilesets with the same grid becomes one tileset.
 */
export function planTiledTilesets(
  loaded: LoadedTiled,
  existing: readonly Tileset[],
  existingBytes: (tilesetId: string) => Uint8Array | undefined,
  taken: Set<string>,
  group: string,
): (PlannedTiledTileset | null)[] {
  const planned: PlannedTiledTileset[] = [];
  return loaded.tilesets.map(t => {
    if (!t.def || !t.sheet || t.problem) return null;
    const spec = { tileWidth: t.def.tileWidth, tileHeight: t.def.tileHeight, margin: t.def.margin, spacing: t.def.spacing };
    const sameGrid = (ts: Tileset) => ts.tileWidth === spec.tileWidth && ts.tileHeight === spec.tileHeight && ts.margin === spec.margin && ts.spacing === spec.spacing;
    const twin = planned.find(p => p.sheet === t.sheet && sameGrid(p.tileset));
    if (twin) return twin;
    const found = existing.find(ts => !ts.generated && !ts.edited && sameGrid(ts) && (() => { const b = existingBytes(ts.id); return !!b && sameBytes(b, t.sheet!.bytes); })());
    if (found) { const p = { tileset: found, sheet: t.sheet, reused: true }; planned.push(p); return p; }
    const tileset = planTilesetGrid(t.def.name, `${tiledBaseName(t.def.image!.path)}.png`, t.sheet.bitmap.width, t.sheet.bitmap.height, spec, taken);
    if (!tileset) return null;
    taken.add(tileset.id);
    const p = { tileset: { ...tileset, group }, sheet: t.sheet, reused: false };
    planned.push(p);
    return p;
  });
}

export interface TiledContentLayer {
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly cells: readonly { x: number; y: number; tilesetId: string; tileId: number; flags: number }[];
}

/** Cells resolved to world tilesets, plus the complete unsupported list (with skipped cell counts). */
export function buildTiledContent(loaded: LoadedTiled, plans: readonly (PlannedTiledTileset | null)[]): { layers: TiledContentLayer[]; unsupported: TiledUnsupported[] } {
  const limits = plans.map(p => (p ? p.tileset.columns * p.tileset.rows : null));
  const { layers, unsupported, skipped } = tiledCellLayers(loaded.map, limits);
  const notes: TiledUnsupported[] = [...loaded.unsupported];
  loaded.tilesets.forEach((t, i) => {
    if (plans[i]) return;
    const kind = t.problem ?? "missingImage";
    const prior = notes.findIndex(n => n.kind === kind && n.name === t.label);
    const count = skipped[i]!;
    if (prior >= 0) notes[prior] = { ...notes[prior]!, count: (notes[prior]!.count ?? 0) + count };
    else notes.push({ kind, name: t.label, count });
  });
  notes.push(...unsupported);
  return {
    layers: layers.map(l => ({ ...l, cells: l.cells.map(c => ({ x: c.x, y: c.y, tilesetId: plans[c.tileset]!.tileset.id, tileId: c.tileId, flags: c.flags })) })),
    unsupported: notes,
  };
}

/** A short English cause for logs and agent errors. */
export function tiledErrorDetail(error: unknown): string {
  if (error instanceof TiledImportError || error instanceof TiledReadError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** One new world tileset with its own image (a sheet shared by two new grids gets a copied bitmap). */
export interface NewTiledImage { readonly tileset: Tileset; readonly bytes: Uint8Array; readonly bitmap: ImageBitmap }

export async function newTiledImages(plans: readonly (PlannedTiledTileset | null)[]): Promise<NewTiledImage[]> {
  const out: NewTiledImage[] = [];
  const used = new Set<ImageBitmap>();
  for (const p of plans) {
    if (!p || p.reused || out.some(o => o.tileset.id === p.tileset.id)) continue;
    const bitmap = used.has(p.sheet.bitmap) ? await createImageBitmap(p.sheet.bitmap) : p.sheet.bitmap;
    used.add(p.sheet.bitmap);
    out.push({ tileset: p.tileset, bytes: p.sheet.bytes, bitmap });
  }
  return out;
}

/** Each world tileset once: `{tilesetId, name, reused}`. */
export function tiledTilesetSummary(plans: readonly (PlannedTiledTileset | null)[]): { tilesetId: string; name: string; reused: boolean }[] {
  const out: { tilesetId: string; name: string; reused: boolean }[] = [];
  for (const p of plans) if (p && !out.some(o => o.tilesetId === p.tileset.id)) out.push({ tilesetId: p.tileset.id, name: p.tileset.name, reused: p.reused });
  return out;
}
