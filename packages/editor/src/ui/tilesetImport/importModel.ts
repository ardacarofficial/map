/**
 * State of the tileset import / settings card, as pure functions: fields
 * prefilled from `inferTileGrid`, the linked width / height toggle, field
 * parsing, the "8 × 6 = 48 tile · 12 boş" summary and the leftover hint
 * with a margin / spacing that would use the whole image.
 */
import {
  emptyTileIds,
  gridCount,
  inferTileGrid,
  type TileGridReason,
  type TileGridSpec,
  type TileGridSuggestion,
} from "@smap/core";

import { t, type MessageKey } from "../../i18n";

/** UI limits for tile size, margin and spacing. */
export const TILE_MIN = 1;
export const TILE_MAX = 1024;
export const GAP_MAX = 256;

export type DraftField = "tileWidth" | "tileHeight" | "margin" | "spacing";

/** What the user is editing (numbers as typed). */
export interface GridDraft {
  name: string;
  tileWidth: string;
  tileHeight: string;
  margin: string;
  spacing: string;
  /** Width and height change together. */
  linked: boolean;
}

/** The image the card shows (alpha may be missing when it could not be read). */
export interface CardImageInfo {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8Array | null;
}

export function draftFromSpec(name: string, spec: TileGridSpec): GridDraft {
  return {
    name,
    tileWidth: String(spec.tileWidth),
    tileHeight: String(spec.tileHeight),
    margin: String(spec.margin),
    spacing: String(spec.spacing),
    linked: spec.tileWidth === spec.tileHeight,
  };
}

export interface InferredDraft {
  draft: GridDraft;
  suggestions: readonly TileGridSuggestion[];
}

/**
 * The card's first state for a new image: the best `inferTileGrid`
 * suggestion (alpha, file name and the hint size all count), or the hint /
 * 32 px when nothing fits.
 */
export function inferDraft(input: {
  name: string;
  fileName: string;
  image: CardImageInfo;
  hintSize?: number | null;
}): InferredDraft {
  const { width, height, alpha } = input.image;
  const result = inferTileGrid({
    width,
    height,
    fileName: input.fileName,
    ...(alpha ? { alpha } : {}),
    ...(input.hintSize ? { hintSize: input.hintSize } : {}),
  });
  const fallback = input.hintSize ?? 32;
  const spec = result.best ?? { tileWidth: fallback, tileHeight: fallback, margin: 0, spacing: 0 };
  return { draft: draftFromSpec(input.name, spec), suggestions: result.suggestions };
}

/** `draft` with one field changed; a linked tile size changes both. */
export function setDraftField(draft: GridDraft, field: DraftField, value: string): GridDraft {
  const next = { ...draft, [field]: value };
  if (draft.linked && field === "tileWidth") next.tileHeight = value;
  if (draft.linked && field === "tileHeight") next.tileWidth = value;
  return next;
}

/** Linking copies the width into the height (one square size). */
export function setDraftLinked(draft: GridDraft, linked: boolean): GridDraft {
  return linked ? { ...draft, linked, tileHeight: draft.tileWidth } : { ...draft, linked };
}

/** `draft` with a whole spec applied (a suggestion chip, the leftover fix). */
export function applySpec(draft: GridDraft, spec: TileGridSpec): GridDraft {
  return draftFromSpec(draft.name, spec);
}

function parseIntIn(text: string, min: number, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export interface ParsedDraft {
  spec: TileGridSpec | null;
  /** Fields that do not hold a valid number. */
  invalid: ReadonlySet<DraftField>;
  nameOk: boolean;
}

export function parseDraft(draft: GridDraft): ParsedDraft {
  const tileWidth = parseIntIn(draft.tileWidth, TILE_MIN, TILE_MAX);
  const tileHeight = parseIntIn(draft.tileHeight, TILE_MIN, TILE_MAX);
  const margin = parseIntIn(draft.margin, 0, GAP_MAX);
  const spacing = parseIntIn(draft.spacing, 0, GAP_MAX);
  const invalid = new Set<DraftField>();
  if (tileWidth === null) invalid.add("tileWidth");
  if (tileHeight === null) invalid.add("tileHeight");
  if (margin === null) invalid.add("margin");
  if (spacing === null) invalid.add("spacing");
  const spec =
    tileWidth !== null && tileHeight !== null && margin !== null && spacing !== null ? { tileWidth, tileHeight, margin, spacing } : null;
  return { spec, invalid, nameOk: draft.name.trim().length > 0 };
}

export interface GridSummary {
  columns: number;
  rows: number;
  count: number;
  /** Fully transparent tiles (0 when the alpha channel is unknown). */
  empty: number;
  /** Their ids. */
  emptyIds: ReadonlySet<number>;
  /** Pixels on the right / bottom that no tile uses. */
  leftoverX: number;
  leftoverY: number;
  /** Margin / spacing (same tile size) that leaves nothing over, or `null`. */
  fix: TileGridSpec | null;
}

/** What `spec` makes of the image, or `null` when not even one tile fits. */
export function summarize(spec: TileGridSpec, image: CardImageInfo): GridSummary | null {
  const { width, height } = image;
  const columns = gridCount(width, spec.tileWidth, spec.margin, spec.spacing);
  const rows = gridCount(height, spec.tileHeight, spec.margin, spec.spacing);
  if (columns < 1 || rows < 1) return null;
  const leftoverX = width - 2 * spec.margin - columns * spec.tileWidth - (columns - 1) * spec.spacing;
  const leftoverY = height - 2 * spec.margin - rows * spec.tileHeight - (rows - 1) * spec.spacing;
  const emptyIds = image.alpha ? emptyTileIds({ ...spec, columns, rows }, { width, height, alpha: image.alpha }) : new Set<number>();
  return {
    columns,
    rows,
    count: columns * rows,
    empty: emptyIds.size,
    emptyIds,
    leftoverX,
    leftoverY,
    fix: leftoverX > 0 || leftoverY > 0 ? leftoverFix(spec, width, height) : null,
  };
}

/** Largest margin / spacing tried by {@link leftoverFix}. */
const FIX_MAX = 8;

/**
 * Margin and spacing (same tile size, same number of columns and rows)
 * that slice the image with no pixels left over: the leftover is explained
 * by gaps the current settings miss. The smallest total gap wins (spacing
 * before margin on ties). `null` when none up to 8 px works.
 */
export function leftoverFix(spec: TileGridSpec, width: number, height: number): TileGridSpec | null {
  const columns = gridCount(width, spec.tileWidth, spec.margin, spec.spacing);
  const rows = gridCount(height, spec.tileHeight, spec.margin, spec.spacing);
  if (columns < 1 || rows < 1) return null;
  const fits = (size: number, tile: number, n: number, margin: number, spacing: number) =>
    2 * margin + n * tile + (n - 1) * spacing === size;
  for (let total = 0; total <= 2 * FIX_MAX; total++) {
    for (let spacing = Math.min(total, FIX_MAX); spacing >= 0; spacing--) {
      const margin = total - spacing;
      if (margin > FIX_MAX || (margin === spec.margin && spacing === spec.spacing)) continue;
      if (fits(width, spec.tileWidth, columns, margin, spacing) && fits(height, spec.tileHeight, rows, margin, spacing)) {
        return { ...spec, margin, spacing };
      }
    }
  }
  return null;
}

const REASON_KEYS: Record<TileGridReason, MessageKey> = {
  fileName: "tilesetImport.reasonFileName",
  hint: "tilesetImport.reasonHint",
  gutters: "tilesetImport.reasonGutters",
  seams: "tilesetImport.reasonSeams",
  divisible: "tilesetImport.reasonDivisible",
  common: "tilesetImport.reasonCommon",
};

/** "dosya adından", "boşluklardan"… */
export function reasonLabel(reason: TileGridReason): string {
  return t(REASON_KEYS[reason]);
}

export interface SuggestionChip {
  key: string;
  spec: TileGridSpec;
  /** "32×32" or "16×16 +1/2" (margin / spacing). */
  size: string;
  /** Translated strongest reason. */
  reason: string;
}

/** Reasons worth naming on a chip first ("dosya adından" says more than "tam bölünüyor"). */
const REASON_ORDER: readonly TileGridReason[] = ["fileName", "gutters", "hint", "seams", "divisible", "common"];

/** The most telling reason of a suggestion. */
export function chipReason(s: Pick<TileGridSuggestion, "reason" | "reasons">): TileGridReason {
  return REASON_ORDER.find((r) => s.reasons.includes(r)) ?? s.reason;
}

/** Up to `max` chips, best first (suggestions are already unique specs). */
export function suggestionChips(suggestions: readonly TileGridSuggestion[], max = 4): SuggestionChip[] {
  return suggestions.slice(0, max).map((s) => ({
    key: `${s.tileWidth}x${s.tileHeight}+${s.margin}+${s.spacing}`,
    spec: { tileWidth: s.tileWidth, tileHeight: s.tileHeight, margin: s.margin, spacing: s.spacing },
    size: `${s.tileWidth}×${s.tileHeight}${s.margin || s.spacing ? ` · ${s.margin}/${s.spacing}` : ""}`,
    reason: reasonLabel(chipReason(s)),
  }));
}

export function sameSpec(a: TileGridSpec, b: TileGridSpec): boolean {
  return a.tileWidth === b.tileWidth && a.tileHeight === b.tileHeight && a.margin === b.margin && a.spacing === b.spacing;
}

/** "8 × 6 = 48 tile · 12 boş". */
export function summaryLine(summary: GridSummary): string {
  const base = t("tilesetImport.summary", { columns: summary.columns, rows: summary.rows, count: summary.count });
  return summary.empty > 0 ? `${base} · ${t("tilesetImport.summaryEmpty", { count: summary.empty })}` : base;
}

/** "Sağda 7 px artıyor — margin/spacing önerisi: 1 / 2", or `null` when the image divides evenly. */
export function leftoverMessage(summary: GridSummary): string | null {
  const { leftoverX: x, leftoverY: y } = summary;
  if (x === 0 && y === 0) return null;
  const where =
    x > 0 && y > 0
      ? t("tilesetImport.leftoverBoth", { x, y })
      : x > 0
        ? t("tilesetImport.leftoverRight", { x })
        : t("tilesetImport.leftoverBottom", { y });
  const tail = summary.fix
    ? t("tilesetImport.leftoverFix", { margin: summary.fix.margin, spacing: summary.fix.spacing })
    : t("tilesetImport.leftoverUnused");
  return `${where} — ${tail}`;
}

/** Note shown when the tileset's tile size differs from the map's, else `null`. */
export function sizeMismatchNote(spec: TileGridSpec, map: { tileWidth: number; tileHeight: number } | null): string | null {
  if (!map || (spec.tileWidth === map.tileWidth && spec.tileHeight === map.tileHeight)) return null;
  return t("tilesetImport.sizeMismatch", {
    tile: `${spec.tileWidth}×${spec.tileHeight}`,
    map: `${map.tileWidth}×${map.tileHeight}`,
  });
}

// ------------------------------------------------------------------ remembered settings

const LAST_KEY = "smap.tilesetImport.last";

/** The grid used for the last import (a hint for the next one), or `null`. */
export function readLastSpec(storage: Pick<Storage, "getItem"> | null = safeStorage()): TileGridSpec | null {
  try {
    const raw = storage?.getItem(LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<TileGridSpec>;
    const ok = (n: unknown, min: number) => typeof n === "number" && Number.isInteger(n) && n >= min;
    if (!ok(v.tileWidth, 1) || !ok(v.tileHeight, 1) || !ok(v.margin, 0) || !ok(v.spacing, 0)) return null;
    return { tileWidth: v.tileWidth!, tileHeight: v.tileHeight!, margin: v.margin!, spacing: v.spacing! };
  } catch {
    return null;
  }
}

export function rememberSpec(spec: TileGridSpec, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(LAST_KEY, JSON.stringify(spec));
  } catch {
    // Private window / blocked storage: the hint is only a convenience.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ paste

/**
 * The PNG to import from a paste, or `null` when the paste is something
 * else: map clips (copied cells: their text carries `smap-clip`) always
 * win over an image, so Ctrl+C / Ctrl+V of cells keeps working.
 */
export function pastedImage<F extends { readonly type: string; readonly name: string }>(
  data: { getData(format: string): string; readonly files?: ArrayLike<F> | null } | null | undefined,
): F | null {
  if (!data) return null;
  let text = "";
  try {
    text = data.getData("text/plain");
  } catch {
    // Unreadable text: treat as no clip.
  }
  if (text.includes("smap-clip")) return null;
  const files = data.files ? Array.from(data.files) : [];
  return files.find((f) => f.type === "image/png") ?? null;
}
