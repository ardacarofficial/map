/**
 * Shared pieces of the exporters: which tile layers and tilesets are
 * exported, the cells of a tile layer in a fixed order, and the image file
 * names written next to the exported map.
 *
 * Only tile layers are exported as cells (entity layers are exported as
 * entities / objects by each exporter). Grid layers (terrain / collision) are not:
 * a terrain grid's look is already in its derived tile layer, and collision
 * exceptions are folded into the derived collision grid.
 */
import { cellFlags, cellPaletteIndex, FLIP_D, FLIP_H, FLIP_V } from "../cell";
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT } from "../chunk";
import type { MapDocument } from "../document";
import { isTileLayer, type TileLayer } from "../layer";
import { safeFileName } from "../fileName";
import { isValidTileId, type Tileset } from "../tileset";

/** Export flip flags (small bits, so they fit any int parser). */
export const EXPORT_FLIP_H = 1;
export const EXPORT_FLIP_V = 2;
/** Reserved like the cell's `FLIP_D`; the editor does not produce it yet. */
export const EXPORT_FLIP_D = 4;

/** A tileset that appears in an export, with the image file name written next to the map. */
export interface ExportImage {
  readonly tileset: Tileset;
  /** Project-relative source path (the tileset's `imagePath`), for copying the PNG. */
  readonly sourcePath: string;
  /** File name next to the exported map, unique within the export, e.g. `"grass.png"`. */
  readonly fileName: string;
}

/** One non-empty cell of a tile layer, resolved through the palette. */
export interface ExportCell {
  readonly x: number;
  readonly y: number;
  /** Index into the export's tileset list. */
  readonly tilesetIndex: number;
  readonly tileId: number;
  /** Combination of `EXPORT_FLIP_*`. */
  readonly flags: number;
  /** The raw cell flag bits (`FLIP_*`, Tiled-compatible). */
  readonly cellFlags: number;
}

/**
 * A problem an export left out of its output. `code` and the params let the UI
 * translate it; `message` is the English text (logs, tests, other tools).
 */
export type ExportWarning =
  | { readonly code: "missingTilesets"; readonly tilesets: readonly string[]; readonly message: string }
  | {
      readonly code: "tileIdsOutOfRange";
      readonly tileset: string;
      readonly tileIds: readonly number[];
      readonly message: string;
    }
  | { readonly code: "collisionExceptions"; readonly layers: readonly string[]; readonly message: string };

/** Tile layers (grid and entity layers excluded), bottom to top. */
export function exportedLayers(doc: MapDocument): TileLayer[] {
  return doc.layers.filter((layer) => isTileLayer(layer));
}

/**
 * Tilesets referenced by any exported cell, in the document's tileset order,
 * with unique image file names (basename of `imagePath`; a clash gets
 * `-2`, `-3`… before the extension).
 */
export function exportedTilesets(doc: MapDocument): ExportImage[] {
  const used = new Set<string>();
  const palette = doc.palette;
  for (const layer of exportedLayers(doc)) {
    for (const chunk of layer.chunks()) {
      for (let i = 0; i < CHUNK_AREA; i++) {
        const cell = chunk.data[i]!;
        if (cell === 0) continue;
        const entry = palette.get(cellPaletteIndex(cell));
        if (!entry || used.has(entry.tilesetId)) continue;
        const tileset = doc.getTileset(entry.tilesetId);
        if (tileset && isValidTileId(tileset, entry.tileId)) used.add(entry.tilesetId);
      }
    }
  }
  const taken = new Set<string>();
  const out: ExportImage[] = [];
  for (const tileset of doc.tilesets) {
    if (!used.has(tileset.id)) continue;
    out.push({ tileset, sourcePath: tileset.imagePath, fileName: uniqueName(basename(tileset.imagePath), taken) });
  }
  return out;
}

/**
 * Non-empty in-bounds cells of `layer`, row-major (y, then x; y down),
 * resolved to `(tilesetIndex, tileId)`. Cells whose palette entry or
 * tileset is missing from `images`, or whose tile id is outside the tileset
 * (the image shrank), are skipped — {@link exportWarnings} reports them.
 */
export function layerCells(doc: MapDocument, layer: TileLayer, images: readonly ExportImage[]): ExportCell[] {
  const { width, height } = doc.map;
  const tilesetIndex = new Map(images.map((image, i) => [image.tileset.id, i]));
  const cells: ExportCell[] = [];
  for (const chunk of layer.chunks()) {
    const x0 = chunk.cx << CHUNK_SHIFT;
    const y0 = chunk.cy << CHUNK_SHIFT;
    for (let i = 0; i < CHUNK_AREA; i++) {
      const cell = chunk.data[i]!;
      if (cell === 0) continue;
      const x = x0 + (i & CHUNK_MASK);
      const y = y0 + (i >> CHUNK_SHIFT);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const entry = doc.palette.get(cellPaletteIndex(cell));
      const index = entry && tilesetIndex.get(entry.tilesetId);
      if (!entry || index === undefined) continue;
      if (!isValidTileId(images[index]!.tileset, entry.tileId)) continue;
      const raw = cellFlags(cell);
      const flags =
        (raw & FLIP_H ? EXPORT_FLIP_H : 0) | (raw & FLIP_V ? EXPORT_FLIP_V : 0) | (raw & FLIP_D ? EXPORT_FLIP_D : 0);
      cells.push({ x, y, tilesetIndex: index, tileId: entry.tileId, flags, cellFlags: raw });
    }
  }
  return cells.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Problems an export skips silently in the data, as readable messages (sorted,
 * deterministic): cells whose tileset is not in the project, and cells whose
 * tile id is outside its tileset (e.g. the PNG lost rows; CLAUDE.md: tiles
 * are only appended, so this means the image shrank). Such cells are left
 * out of every export — writing them would show a tile of the next tileset
 * (TMJ GID overflow) or read outside the image.
 */
export function exportWarnings(doc: MapDocument): ExportWarning[] {
  const missing = new Set<string>();
  const outOfRange = new Map<string, Set<number>>();
  const palette = doc.palette;
  const seen = new Set<number>();
  for (const layer of exportedLayers(doc)) {
    for (const chunk of layer.chunks()) {
      for (let i = 0; i < CHUNK_AREA; i++) {
        const cell = chunk.data[i]!;
        if (cell === 0) continue;
        const index = cellPaletteIndex(cell);
        if (seen.has(index)) continue;
        seen.add(index);
        const entry = palette.get(index);
        if (!entry) continue;
        const tileset = doc.getTileset(entry.tilesetId);
        if (!tileset) missing.add(entry.tilesetId);
        else if (!isValidTileId(tileset, entry.tileId)) {
          let ids = outOfRange.get(tileset.id);
          if (!ids) outOfRange.set(tileset.id, (ids = new Set()));
          ids.add(entry.tileId);
        }
      }
    }
  }
  const warnings: ExportWarning[] = [];
  if (missing.size > 0) {
    const tilesets = [...missing].sort();
    warnings.push({ code: "missingTilesets", tilesets, message: `Cells of missing tilesets were skipped: ${tilesets.join(", ")}.` });
  }
  for (const id of [...outOfRange.keys()].sort()) {
    const tileIds = [...outOfRange.get(id)!].sort((a, b) => a - b);
    warnings.push({
      code: "tileIdsOutOfRange",
      tileset: id,
      tileIds,
      message: `Cells with tile ids outside tileset "${id}" were skipped: ${tileIds.join(", ")}.`,
    });
  }
  return warnings;
}

/** Pixel size of a tileset image as implied by its grid (margins and spacing included). */
export function tilesetImageSize(tileset: Tileset): { width: number; height: number } {
  return {
    width: 2 * tileset.margin + tileset.columns * tileset.tileWidth + (tileset.columns - 1) * tileset.spacing,
    height: 2 * tileset.margin + tileset.rows * tileset.tileHeight + (tileset.rows - 1) * tileset.spacing,
  };
}

/**
 * A file-system-safe base name for an exported level: characters Windows
 * forbids (and control characters) become `_`; trailing dots/spaces are
 * dropped; a Windows device name (`CON`, `NUL`, `COM1`…, also `con.v2`)
 * gets a `_` after its stem; an empty result becomes `"map"`.
 */
export function exportBaseName(levelName: string): string {
  return safeFileName(levelName, "map");
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function uniqueName(name: string, taken: Set<string>): string {
  const key = (n: string) => n.toLowerCase(); // Windows and macOS file systems ignore case
  let candidate = name;
  if (taken.has(key(candidate))) {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 2; taken.has(key(candidate)); n++) candidate = `${stem}-${n}${ext}`;
  }
  taken.add(key(candidate));
  return candidate;
}
