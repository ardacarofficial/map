import { bandBlits, bandLayout, bandSample, bandWidth, type BandedSource } from "./smartStamp/bands";
/** Pure nine-slice addressing and ordinary-atlas bake instructions. No pixels or map state are mutated. */
import { cellFlags, cellPaletteIndex, CELL_FLAG_MASK, FLIP_D, FLIP_H, FLIP_V, isValidCell } from "./cell";
import type { TileClip } from "./clip";
import type { CellPoint, CellRect } from "./geometry";
import type { PaletteEntry } from "./palette";
import { MAX_COLLISION_VALUE, MAX_GRID_VALUE } from "./layer";
import { BLOB47_MASKS } from "./smartStamp/topology";

/** D4 orientation encoded as the existing unsigned H/V/D cell flag bits; transpose precedes mirrors. */
export type NineSliceOrientation = number;

/** Rejects numbers other than an unsigned combination of H/V/D flags. */
export function assertOrientation(flags: number): void {
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffff_ffff || ((flags & CELL_FLAG_MASK) >>> 0) !== flags) throw new RangeError("orientation must contain only unsigned H/V/D flags");
}

/** Transforms a cell in a width × height rectangle, swapping dimensions for D. */
export function orientPoint(p: CellPoint, width: number, height: number, orientation = 0): CellPoint {
  assertOrientation(orientation);
  let { x, y } = p;
  if (orientation & FLIP_D) { [x, y] = [y, x]; [width, height] = [height, width]; }
  if (orientation & FLIP_H) x = width - 1 - x;
  if (orientation & FLIP_V) y = height - 1 - y;
  return { x, y };
}

const ORIENTATIONS = [0, FLIP_D, FLIP_V, (FLIP_V | FLIP_D) >>> 0, FLIP_H, (FLIP_H | FLIP_D) >>> 0, (FLIP_H | FLIP_V) >>> 0, (FLIP_H | FLIP_V | FLIP_D) >>> 0];

/** Applies `after` to a recipe already oriented by `before`; uses the same composition as cell flags. */
export function composeOrientation(before: number, after: number): number {
  assertOrientation(before); assertOrientation(after);
  const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  return ORIENTATIONS.find(f => points.every(p => {
    const a = orientPoint(orientPoint(p, 2, 2, before), 2, 2, after), b = orientPoint(p, 2, 2, f);
    return a.x === b.x && a.y === b.y;
  }))!;
}

/** Orientation that restores the canonical recipe. */
export function inverseOrientation(orientation: number): number {
  assertOrientation(orientation);
  return orientation & FLIP_D ? ((orientation & FLIP_H ? FLIP_V : 0) | (orientation & FLIP_V ? FLIP_H : 0) | FLIP_D) >>> 0 : orientation;
}

/** Eligibility diagnosis. Holes are allowed for area use; road conversion requires nine nonempty representatives. */
export function nineSliceProblem(source: TileClip & BandedSource, options: { readonly roadLayerId?: string } = {}): string | null {
  const { width: n, height: m } = source;
  if (!Number.isInteger(n) || !Number.isInteger(m) || n < 3 || m < 3) return "nine-slice dimensions must be integers >= 3 with a one-cell border";
  const b = bandWidth(source);
  if (!Number.isSafeInteger(b) || b < 1 || (b > 1 && (n <= 2*b || m <= 2*b))) return "invalid nine-slice border";
  if (source.layers.length === 0) return "nine-slice requires a source layer";
  if (new Set(source.layers.map(l => l.layerId)).size !== source.layers.length) return "duplicate source layer id";
  for (const layer of source.layers) {
    if (layer.cells.length !== n * m) return `invalid cell count in layer ${layer.layerId}`;
    if (layer.grid) {
      const max = layer.role === "collision" ? MAX_COLLISION_VALUE : MAX_GRID_VALUE;
      if (layer.cells.some(v => v > max)) return `invalid grid value in layer ${layer.layerId}`;
    }
    if (!layer.grid) for (const cell of layer.cells) {
      if (!isValidCell(cell) || (cell !== 0 && !source.palette[cellPaletteIndex(cell) - 1])) return `invalid source palette reference in layer ${layer.layerId}`;
    }
  }
  if (options.roadLayerId !== undefined) {
    const layer = source.layers.find(l => l.layerId === options.roadLayerId);
    if (!layer || layer.grid) return "road requires an explicitly chosen tile layer";
    if (b > 1 && layer.cells.some(c => !c)) return "banded road requires full patches";
    for (const y of [0, 1, m - 1]) for (const x of [0, 1, n - 1]) if (!layer.cells[y * n + x]) return `missing road representative at (${x}, ${y})`;
  }
  return null;
}

/** Version of the permanent slot-prefix ABI. Future extensions append slots; they must never insert, remove or renumber this prefix. */
export const NINE_SLICE_LAYOUT_VERSION = 1;

/** Stable slot offsets. Packing into image rows/pages must never renumber these tile ids; existing source dimensions are immutable. */
export interface NineSliceLayout {
  readonly source: number;
  readonly collapsedWidth: number;
  readonly collapsedHeight: number;
  readonly isolated: number;
  readonly bank: number;
  readonly slots: number;
}

/** Source row-major; m collapsed-width slots; n collapsed-height slots; isolated; 47 ascending reduced masks. */
export function nineSliceLayout(source: BandedSource): NineSliceLayout {
  if (bandWidth(source) > 1) return bandLayout(source);
  const { width: n, height: m } = source;
  if (!Number.isInteger(n) || !Number.isInteger(m) || n < 3 || m < 3) throw new RangeError("nine-slice source must be at least 3 by 3");
  const collapsedWidth = n * m, collapsedHeight = collapsedWidth + m, isolated = collapsedHeight + n, bank = isolated + 1;
  return { source: 0, collapsedWidth, collapsedHeight, isolated, bank, slots: bank + 47 };
}

/** Source regions in row-major order: NW, N strip, NE, W strip, centre, E strip, SW, S strip, SE. */
export function nineSliceRegions(source: BandedSource): readonly CellRect[] {
  nineSliceLayout(source);
  const { width: n, height: m } = source, b = bandWidth(source);
  return [0, 1, 2].flatMap(y => [0, 1, 2].map(x => ({ x: x === 2 ? n - b : x*b, y: y === 2 ? m - b : y*b, width: x === 1 ? n - 2*b : b, height: y === 1 ? m - 2*b : b })));
}

/** One sampled atlas slot and its raw grid contributors. Baked pixels already include source cell flags. */
export interface NineSliceSample extends CellPoint {
  readonly slot: number;
  readonly flags: number;
  readonly sourceIndices: readonly number[];
}

const phase = (p: number, length: number, sourceLength: number) => p === 0 ? 0 : p === length - 1 ? sourceLength - 1 : 1 + (p - 1) % (sourceLength - 2);

function assertRect(rect: CellRect): void {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) || rect.width < 1 || rect.height < 1) throw new RangeError("rectangle must have integer coordinates and positive dimensions");
}

/**
 * Samples intended geometry before clipping. A point outside it returns null.
 * D4 transforms dimensions, border roles and periodic phase together. Width/height 1 splice opposing caps.
 */
export function sampleNineSlice(rect: CellRect, worldCell: CellPoint, source: BandedSource, orientation = 0): NineSliceSample | null {
  assertRect(rect); assertOrientation(orientation);
  const l = nineSliceLayout(source), { width: n, height: m } = source;
  if (!Number.isInteger(worldCell.x) || !Number.isInteger(worldCell.y)) throw new RangeError("sample coordinates must be integers");
  const local = { x: worldCell.x - rect.x, y: worldCell.y - rect.y };
  if (local.x < 0 || local.y < 0 || local.x >= rect.width || local.y >= rect.height) return null;
  if (bandWidth(source) > 1) return bandSample(rect, worldCell, source, orientation);
  const p = orientPoint(local, rect.width, rect.height, inverseOrientation(orientation));
  const W = orientation & FLIP_D ? rect.height : rect.width, H = orientation & FLIP_D ? rect.width : rect.height;
  const sx = phase(p.x, W, n), sy = phase(p.y, H, m);
  let slot: number, sourceIndices: number[];
  if (W === 1 && H === 1) { slot = l.isolated; sourceIndices = [0, n - 1, n * m - 1, n * (m - 1)]; }
  else if (W === 1) { slot = l.collapsedWidth + sy; sourceIndices = [sy * n, sy * n + n - 1]; }
  else if (H === 1) { slot = l.collapsedHeight + sx; sourceIndices = [sx, (m - 1) * n + sx]; }
  else { slot = sy * n + sx; sourceIndices = [slot]; }
  return { ...worldCell, slot, flags: orientation, sourceIndices };
}

/** Row-major rectangle samples, optionally restricted to a window; phase always uses the full intended rectangle. */
export function planNineSliceRect(rect: CellRect, source: BandedSource, orientation = 0, window?: CellRect): NineSliceSample[] {
  assertRect(rect); assertOrientation(orientation); nineSliceLayout(source);
  if (window) assertRect(window);
  const out: NineSliceSample[] = [];
  const x0 = Math.max(rect.x, window?.x ?? rect.x), y0 = Math.max(rect.y, window?.y ?? rect.y);
  const x1 = Math.min(rect.x + rect.width, window ? window.x + window.width : Infinity), y1 = Math.min(rect.y + rect.height, window ? window.y + window.height : Infinity);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(sampleNineSlice(rect, { x, y }, source, orientation)!);
  return out;
}

/** Pixel rectangle; half-open, relative to a tile (never to an atlas image). */
export interface NineSlicePixelRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** One no-resampling blit. Crop sourceRect from the raw source tile, transform that crop with flags, then copy to destinationRect in slot. */
export interface NineSliceBlit {
  readonly tile: PaletteEntry;
  readonly flags: number;
  readonly sourceRect: NineSlicePixelRect;
  readonly slot: number;
  readonly destinationRect: NineSlicePixelRect;
}
/** Optional authored inner-corner tile, with NW/NE/SE/SW quadrants in their corresponding positions. */
export interface NineSliceInnerCorner { readonly tile: PaletteEntry; readonly flags?: number }

function quadrantRect(q: number, width: number, height: number): NineSlicePixelRect {
  const left = Math.floor(width / 2), top = Math.floor(height / 2), right = q === 1 || q === 2, bottom = q >= 2;
  return { x: right ? left : 0, y: bottom ? top : 0, width: right ? width - left : left, height: bottom ? height - top : top };
}

function rawRect(r: NineSlicePixelRect, width: number, height: number, flags: number): NineSlicePixelRect {
  let { x, y, width: w, height: h } = r;
  if (flags & FLIP_H) x = width - x - w;
  if (flags & FLIP_V) y = height - y - h;
  if (flags & FLIP_D) { [x, y] = [y, x]; [w, h] = [h, w]; }
  return { x, y, width: w, height: h };
}

/** Quadrant bits: both cardinal neighbours present and the diagonal absent (NW, NE, SE, SW). */
const INNER_QUADRANT_BITS = [[1, 64, 128], [1, 4, 2], [16, 4, 8], [16, 64, 32]] as const;
/** True when quadrant q of a reduced blob mask is a concave (inner) join. */
export function isInnerJoinQuadrant(mask: number, q: number): boolean {
  const [a, b, diagonal] = INNER_QUADRANT_BITS[q]!;
  return !!(mask & a) && !!(mask & b) && !(mask & diagonal);
}
/** Source indices [vertical edge strip, horizontal edge strip] adjoining inner quadrant q. */
export function innerJoinSources(source: BandedSource, q: number): readonly [number, number] {
  const { width: n, height: m } = source;
  return ([[n, 1], [2 * n - 1, 1], [2 * n - 1, (m - 1) * n + 1], [n, (m - 1) * n + 1]] as const)[q]!;
}
/** A mitered inner-join piece: copy the same rectangle from the chosen adjoining edge strip. */
export interface InnerMiterSpan extends NineSlicePixelRect { readonly strip: "vertical" | "horizontal" }
/**
 * Splits quadrant q of a width × height patch along its corner diagonal. Pixels nearer the side shared with the
 * left/right neighbour copy the horizontal edge strip that neighbour shows; the rest copy the vertical strip shown by
 * the top/bottom neighbour. Both borders therefore continue into the cell and meet in a mitered concave corner.
 * Pure integer geometry: no pixels are inspected or resampled, and equal rows are merged.
 */
export function innerMiterSpans(q: number, rect: NineSlicePixelRect, width: number, height: number): InnerMiterSpan[] {
  const right = q === 1 || q === 2, bottom = q >= 2, out: InnerMiterSpan[] = [];
  const x0 = rect.x, x1 = rect.x + rect.width;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    const dy = bottom ? height - 1 - y : y, num = (2 * dy + 1) * width - height, den = 2 * height;
    // Number of side distances dx with (2dx+1)/width < (2dy+1)/height; ties go to the vertical strip.
    const k = num <= 0 ? 0 : Math.floor((num + den - 1) / den);
    const h0 = right ? Math.max(x0, width - k) : x0, h1 = right ? x1 : Math.min(x1, k);
    const pieces: [number, number, InnerMiterSpan["strip"]][] = right ? [[x0, Math.min(x1, h0), "vertical"], [h0, h1, "horizontal"]] : [[h0, h1, "horizontal"], [Math.max(x0, h1), x1, "vertical"]];
    for (const [a, b, strip] of pieces) {
      if (b <= a) continue;
      const prev = out.find(p => p.strip === strip && p.x === a && p.width === b - a && p.y + p.height === y);
      if (prev) (prev as { height: number }).height++;
      else out.push({ x: a, y, width: b - a, height: 1, strip });
    }
  }
  return out;
}

/** Per-quadrant source index for a blob mask; missing authored inner joins use the centre's corresponding quadrant. */
export function nineSliceMaskSources(source: BandedSource, mask: number): readonly number[] {
  nineSliceLayout(source);
  const { width: n, height: m } = source;
  return [[1, 64, 0, n, 1], [1, 4, n - 1, 2 * n - 1, 1], [16, 4, n * m - 1, 2 * n - 1, (m - 1) * n + 1], [16, 64, (m - 1) * n, n, (m - 1) * n + 1]].map(([a, b, corner, vertical, horizontal]) => (mask & a!) ? (mask & b!) ? n + 1 : vertical! : (mask & b!) ? horizontal! : corner!);
}

/**
 * Describes every nontransparent quarter of the canonical bake. Odd sizes split at floor(size/2).
 * Source flips are mapped back to raw crop rectangles, including odd flipped halves; no scaling or nearest-mask substitution.
 * Same input yields the same ordered list. Slots form a permanent append-only prefix: future growth goes after the bank.
 * Rasterize ONLY into a separate generated PNG, never into a source tileset image. PNG-only regeneration retains the
 * generated tileset id and these slot ids, so already placed cells keep their palette references.
 * Diagonal source flags require square pixel tiles, matching editor rotation constraints.
 */
export function nineSliceBlits(source: TileClip & BandedSource, layerId: string, tileWidth: number, tileHeight: number, innerCorner?: NineSliceInnerCorner, innerJoin?: "miter"): NineSliceBlit[] {
  const problem = nineSliceProblem(source);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(tileWidth) || !Number.isInteger(tileHeight) || tileWidth < 1 || tileHeight < 1) throw new RangeError("tile dimensions must be positive integers");
  const layer = source.layers.find(l => l.layerId === layerId);
  if (!layer || layer.grid) throw new Error("bake requires a source tile layer");
  if (bandWidth(source) > 1) { if (innerCorner) throw new Error("banded inner corners use the source centre patch"); return bandBlits(source, layerId, tileWidth, tileHeight, innerJoin === "miter"); }
  const { width: n, height: m } = source, layout = nineSliceLayout(source), out: NineSliceBlit[] = [];
  const emit = (slot: number, indices: readonly number[], mask?: number) => {
    for (let q = 0; q < 4; q++) {
      const inner = mask !== undefined && isInnerJoinQuadrant(mask, q), useInner = innerCorner && inner;
      if (!useInner && inner && innerJoin === "miter") {
        const [vertical, horizontal] = innerJoinSources(source, q);
        for (const span of innerMiterSpans(q, quadrantRect(q, tileWidth, tileHeight), tileWidth, tileHeight)) {
          const cell = layer.cells[span.strip === "vertical" ? vertical : horizontal]!;
          if (cell === 0) continue;
          const flags = cellFlags(cell), destinationRect = { x: span.x, y: span.y, width: span.width, height: span.height };
          if (flags & FLIP_D && tileWidth !== tileHeight) throw new Error("diagonal source orientation requires square tiles");
          out.push({ tile: source.palette[cellPaletteIndex(cell) - 1]!, flags, sourceRect: rawRect(destinationRect, tileWidth, tileHeight, flags), slot, destinationRect });
        }
        continue;
      }
      const cell = layer.cells[indices[q]!]!;
      if (!useInner && cell === 0) continue;
      const tile = useInner ? innerCorner.tile : source.palette[cellPaletteIndex(cell) - 1]!;
      const flags = useInner ? innerCorner.flags ?? 0 : cellFlags(cell);
      assertOrientation(flags);
      if (flags & FLIP_D && tileWidth !== tileHeight) throw new Error("diagonal source orientation requires square tiles");
      const destinationRect = quadrantRect(q, tileWidth, tileHeight);
      if (destinationRect.width === 0 || destinationRect.height === 0) continue;
      out.push({ tile, flags, sourceRect: rawRect(destinationRect, tileWidth, tileHeight, flags), slot, destinationRect });
    }
  };
  for (let i = 0; i < n * m; i++) emit(i, [i, i, i, i]);
  for (let y = 0; y < m; y++) emit(layout.collapsedWidth + y, [y * n, y * n + n - 1, y * n + n - 1, y * n]);
  for (let x = 0; x < n; x++) emit(layout.collapsedHeight + x, [x, x, (m - 1) * n + x, (m - 1) * n + x]);
  emit(layout.isolated, [0, n - 1, n * m - 1, (m - 1) * n]);
  BLOB47_MASKS.forEach((mask, rank) => emit(layout.bank + rank, nineSliceMaskSources(source, mask), mask));
  return out;
}
