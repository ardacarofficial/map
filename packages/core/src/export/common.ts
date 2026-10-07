/**
 * Shared pieces of the exporters: which tile layers and tilesets are
 * exported, the cells of a tile layer in a fixed order, and the image file
 * names written next to the exported map.
 *
 * Only tile layers are exported. Grid layers (terrain / collision) are not:
 * a terrain grid's look is already in its derived tile layer, and collision
 * exceptions are folded into the derived collision grid.
 */
import { cellFlags, cellPaletteIndex, FLIP_D, FLIP_H, FLIP_V } from "../cell";
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT } from "../chunk";
import type { MapDocument } from "../document";
import { isGridLayer, type TileLayer } from "../layer";
import type { Tileset } from "../tileset";

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

/** Tile layers (grid layers excluded), bottom to top. */
export function exportedLayers(doc: MapDocument): TileLayer[] {
  return doc.layers.filter((layer) => !isGridLayer(layer));
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
        if (entry) used.add(entry.tilesetId);
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
 * tileset is missing from `images` are skipped.
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
      const raw = cellFlags(cell);
      const flags =
        (raw & FLIP_H ? EXPORT_FLIP_H : 0) | (raw & FLIP_V ? EXPORT_FLIP_V : 0) | (raw & FLIP_D ? EXPORT_FLIP_D : 0);
      cells.push({ x, y, tilesetIndex: index, tileId: entry.tileId, flags, cellFlags: raw });
    }
  }
  return cells.sort((a, b) => a.y - b.y || a.x - b.x);
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
 * dropped; an empty result becomes `"map"`.
 */
export function exportBaseName(levelName: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = levelName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim();
  return cleaned.length > 0 ? cleaned : "map";
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
