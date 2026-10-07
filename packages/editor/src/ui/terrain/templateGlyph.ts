/**
 * Pure helpers for the terrain template picker: which templates to show
 * where, and a tiny 3×3 "glyph" per template slot that draws the slot's mask
 * (which neighbours / corners carry the terrain). Drawing every slot of a
 * block side by side makes each layout recognizable at a glance.
 */
import {
  BLOB_E,
  BLOB_N,
  BLOB_NE,
  BLOB_NW,
  BLOB_S,
  BLOB_SE,
  BLOB_SW,
  BLOB_W,
  CORNER_NE,
  CORNER_NW,
  CORNER_SE,
  CORNER_SW,
  TERRAIN_TEMPLATES,
  type TerrainTemplateFamily,
  type TerrainTemplateInfo,
} from "@smap/core";

/**
 * 3×3 cells, row-major (index 4 = centre); `true` = terrain shown there.
 * `null` for an unused slot.
 */
export type Glyph = readonly boolean[] | null;

/** Blob bit for each glyph cell (centre = 0: always on for a blob tile). */
const BLOB_CELLS = [BLOB_NW, BLOB_N, BLOB_NE, BLOB_W, 0, BLOB_E, BLOB_SW, BLOB_S, BLOB_SE] as const;

/**
 * Glyph of one mask.
 * - blob47: the centre is the tile itself (always on); each of the 8
 *   neighbours is on when its bit is set.
 * - corner16: the four corners follow the corner bits; an edge is on when
 *   both of its corners are; the centre when at least three corners are.
 */
export function maskGlyph(family: TerrainTemplateFamily, mask: number | null): Glyph {
  if (mask === null) return null;
  if (family === "blob47") return BLOB_CELLS.map((bit) => bit === 0 || (mask & bit) !== 0);
  const ne = (mask & CORNER_NE) !== 0;
  const se = (mask & CORNER_SE) !== 0;
  const sw = (mask & CORNER_SW) !== 0;
  const nw = (mask & CORNER_NW) !== 0;
  const count = Number(ne) + Number(se) + Number(sw) + Number(nw);
  return [nw, nw && ne, ne, nw && sw, count >= 3, ne && se, sw, sw && se, se];
}

/** Glyph of every slot of a template, row-major (same order as `masks`). */
export function templateGlyphs(info: TerrainTemplateInfo): Glyph[] {
  return info.masks.map((mask) => maskGlyph(info.family, mask));
}

/** Templates for the picker: everyday ones first, legacy ones under "Diğer". */
export function templatePickerGroups(templates: readonly TerrainTemplateInfo[] = TERRAIN_TEMPLATES): {
  main: TerrainTemplateInfo[];
  other: TerrainTemplateInfo[];
} {
  return { main: templates.filter((t) => !t.legacy), other: templates.filter((t) => t.legacy) };
}

/**
 * The slot that shows the "fully surrounded" tile (blob 255, corner 15) —
 * the most representative tile of a terrain, used as its swatch.
 */
export function fillSlot(info: TerrainTemplateInfo): number {
  const full = info.family === "blob47" ? 255 : 15;
  const slot = info.masks.indexOf(full);
  return slot >= 0 ? slot : 0;
}
