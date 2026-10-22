/**
 * The bulk import card (several PNGs at once) as pure functions (unit
 * tested): one row per file with the inferred tile size (editable inline),
 * the resulting grid and a ✓ / ⚠ verdict with its reason, plus the
 * "add without asking when the guess is safe" rule the single-file path
 * uses too.
 */
import { gridCount, type TileGridSpec, type TileGridSuggestion } from "@smap/core";

import { t } from "../../i18n";
import { chipReason, reasonLabel, TILE_MAX, TILE_MIN } from "./importModel";

export interface BulkRow {
  /** Stable React key (the file's position in the drop). */
  readonly key: string;
  readonly fileName: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly suggestions: readonly TileGridSuggestion[];
  /** The size field as typed ("16", "16×8"). */
  readonly sizeText: string;
  /** Current grid, or null while the size field is not a valid size. */
  readonly spec: TileGridSpec | null;
}

export type RowVerdict =
  | { readonly kind: "ok"; readonly columns: number; readonly rows: number; readonly reason: string }
  | { readonly kind: "warn"; readonly columns: number; readonly rows: number; readonly reason: string }
  | { readonly kind: "invalid"; readonly reason: string };

type MapTile = { readonly tileWidth: number; readonly tileHeight: number } | null;

export function sizeText(spec: Pick<TileGridSpec, "tileWidth" | "tileHeight">): string {
  return spec.tileWidth === spec.tileHeight ? String(spec.tileWidth) : `${spec.tileWidth}×${spec.tileHeight}`;
}

/** "16" → 16×16, "16x8" / "16×8" / "16 8" → 16×8; null when not a valid size. */
export function parseSize(text: string): { tileWidth: number; tileHeight: number } | null {
  const m = /^\s*(\d+)\s*(?:[x×*\s]\s*(\d+))?\s*$/i.exec(text);
  if (!m) return null;
  const w = Number(m[1]);
  const h = m[2] === undefined ? w : Number(m[2]);
  const ok = (n: number) => Number.isInteger(n) && n >= TILE_MIN && n <= TILE_MAX;
  return ok(w) && ok(h) ? { tileWidth: w, tileHeight: h } : null;
}

/** The active map supplies the initial grid; inference is used only without a map. */
export function makeRow(input: {
  key: string;
  fileName: string;
  name: string;
  width: number;
  height: number;
  suggestions: readonly TileGridSuggestion[];
  fallback: number;
  mapTile?: MapTile;
}): BulkRow {
  const best = input.suggestions[0];
  const spec: TileGridSpec = input.mapTile
    ? { ...input.mapTile, margin: 0, spacing: 0 }
    : best
    ? { tileWidth: best.tileWidth, tileHeight: best.tileHeight, margin: best.margin, spacing: best.spacing }
    : { tileWidth: input.fallback, tileHeight: input.fallback, margin: 0, spacing: 0 };
  return { ...input, sizeText: sizeText(spec), spec };
}

/**
 * The row with its size field set to `text`. A size one of the suggestions
 * has keeps that suggestion's margin / spacing; any other size slices
 * without gaps.
 */
export function setRowSize(row: BulkRow, text: string): BulkRow {
  const size = parseSize(text);
  if (!size) return { ...row, sizeText: text, spec: null };
  const match = row.suggestions.find((s) => s.tileWidth === size.tileWidth && s.tileHeight === size.tileHeight);
  const spec: TileGridSpec = { ...size, margin: match?.margin ?? 0, spacing: match?.spacing ?? 0 };
  return { ...row, sizeText: text, spec };
}

/** The row with a whole spec (the detailed card's result) and name. */
export function setRowSpec(row: BulkRow, name: string, spec: TileGridSpec): BulkRow {
  return { ...row, name, spec, sizeText: sizeText(spec) };
}

function leftover(size: number, tile: number, n: number, margin: number, spacing: number): number {
  return size - 2 * margin - n * tile - (n - 1) * spacing;
}

/** The suggestion that matches `spec` exactly, if the guess produced it. */
function suggestionFor(row: BulkRow, spec: TileGridSpec): TileGridSuggestion | undefined {
  return row.suggestions.find(
    (s) => s.tileWidth === spec.tileWidth && s.tileHeight === spec.tileHeight && s.margin === spec.margin && s.spacing === spec.spacing,
  );
}

/** ✓ / ⚠ and why: invalid size, no tile fits, leftover pixels, tile size other than the map's, a weak guess. */
export function rowVerdict(row: BulkRow, mapTile: MapTile): RowVerdict {
  const spec = row.spec;
  if (!spec) return { kind: "invalid", reason: t("bulkImport.badSize") };
  const columns = gridCount(row.width, spec.tileWidth, spec.margin, spec.spacing);
  const rows = gridCount(row.height, spec.tileHeight, spec.margin, spec.spacing);
  if (columns < 1 || rows < 1) return { kind: "invalid", reason: t("bulkImport.noTile") };
  const lx = leftover(row.width, spec.tileWidth, columns, spec.margin, spec.spacing);
  const ly = leftover(row.height, spec.tileHeight, rows, spec.margin, spec.spacing);
  if (lx > 0 || ly > 0) return { kind: "warn", columns, rows, reason: t("bulkImport.leftover", { x: lx, y: ly }) };
  if (mapTile && (spec.tileWidth !== mapTile.tileWidth || spec.tileHeight !== mapTile.tileHeight)) {
    return { kind: "warn", columns, rows, reason: t("bulkImport.otherSize", { map: sizeText(mapTile) }) };
  }
  const s = suggestionFor(row, spec);
  if (!s) return { kind: "ok", columns, rows, reason: t("bulkImport.manual") };
  const why = chipReason(s);
  return { kind: why === "fileName" || why === "gutters" || why === "hint" ? "ok" : "warn", columns, rows, reason: reasonLabel(why) };
}

/**
 * "Tahmin güvenliyse sormadan ekle": the best guess comes from the file
 * name or the transparent gutters, slices the image with nothing left
 * over, and its tile size is the map's.
 */
export function isConfidentGuess(suggestions: readonly TileGridSuggestion[], mapTile: MapTile): boolean {
  const best = suggestions[0];
  if (!best || !mapTile) return false;
  const why = chipReason(best);
  return (
    (why === "fileName" || why === "gutters") &&
    best.leftoverX === 0 &&
    best.leftoverY === 0 &&
    best.tileWidth === mapTile.tileWidth &&
    best.tileHeight === mapTile.tileHeight
  );
}

/** Rows "Hepsini ekle" adds (every row whose grid holds at least one tile). */
export function addableRows(rows: readonly BulkRow[], mapTile: MapTile): BulkRow[] {
  return rows.filter((r) => rowVerdict(r, mapTile).kind !== "invalid");
}

// ------------------------------------------------------------------ preference

const AUTO_KEY = "smap.tilesetImport.autoAdd";

export function readAutoAdd(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(AUTO_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAutoAdd(on: boolean, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(AUTO_KEY, on ? "1" : "0");
  } catch {
    // Blocked storage: this session only.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
