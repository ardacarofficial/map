/**
 * Tileset grid helpers for importing and re-slicing a tileset image:
 *
 * - {@link inferTileGrid}: guesses tile size, margin and spacing from the
 *   image size, its alpha channel and the file name (never rejects an image
 *   that does not divide evenly: the leftover pixels are reported).
 * - {@link emptyTileIds}: fully transparent tiles (the palette can dim or
 *   skip them; they keep their ids — tile id = grid order stays stable).
 * - {@link tilesetGridRemap}: where each old tile id lands after a grid edit
 *   (used by the `updateTilesetGrid` / `replaceTilesetImage` ops).
 *
 * Core never decodes images: callers pass the alpha bytes (see
 * {@link alphaFromRgba}).
 */
import { gridCount, type Tileset } from "./tileset";

/** Tile size, margin and spacing: the part of a tileset that slices the image. */
export interface TileGridSpec {
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Pixels around the outer edge of the image. */
  readonly margin: number;
  /** Pixels between adjacent tiles. */
  readonly spacing: number;
}

/** A spec plus the resulting grid size. `Tileset` satisfies it. */
export interface TileGrid extends TileGridSpec {
  readonly columns: number;
  readonly rows: number;
}

/** Alpha channel of an image: `alpha[y * width + x]`, 0 = fully transparent. */
export interface AlphaImage {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8Array;
}

/**
 * Why a grid was suggested (language-neutral codes; the UI translates them):
 * - `fileName`: the file name carries this size (`dungeon-16`, `tiles_32x32`)
 * - `hint`: the caller's hint (e.g. the size used last time)
 * - `gutters`: fully transparent rows / columns line up with margin and spacing
 * - `seams`: tile edges line up with breaks in the artwork
 * - `divisible`: the image is a whole number of tiles
 * - `common`: a common tile size, nothing else to go on
 */
export type TileGridReason = "fileName" | "hint" | "gutters" | "seams" | "divisible" | "common";

export interface TileGridSuggestion extends TileGrid {
  /** Pixels on the right / bottom that no tile covers (after the margin). Never negative. */
  readonly leftoverX: number;
  readonly leftoverY: number;
  /** Higher is better. Only meaningful relative to the other suggestions of the same call. */
  readonly score: number;
  /** Strongest reason. */
  readonly reason: TileGridReason;
  /** Every reason that contributed, strongest first. */
  readonly reasons: readonly TileGridReason[];
}

export interface InferTileGridInput {
  readonly width: number;
  readonly height: number;
  /** `width * height` alpha bytes, row-major (optional; enables gutter and content checks). */
  readonly alpha?: Uint8Array;
  /** Preferred size, e.g. the one used last time or the map's tile size. */
  readonly hintSize?: number;
  readonly fileName?: string;
}

export interface InferTileGridResult {
  /** Best first; at most {@link MAX_GRID_SUGGESTIONS}; empty only when not even an 1×1 px tile fits. */
  readonly suggestions: readonly TileGridSuggestion[];
  /** `suggestions[0]`, or `null` when there is none. */
  readonly best: TileGridSuggestion | null;
}

/** Tile sizes tried for every image. */
export const COMMON_TILE_SIZES: readonly number[] = Object.freeze([8, 12, 16, 24, 32, 48, 64]);
/** Upper bound on {@link InferTileGridResult.suggestions}. */
export const MAX_GRID_SUGGESTIONS = 6;

/** Prior for sizes without other evidence (32 is the project default, 16 the next most common). */
const SIZE_PRIOR: ReadonlyMap<number, number> = new Map([
  [32, 1.6],
  [16, 1.5],
  [24, 0.6],
  [48, 0.6],
  [64, 0.5],
  [8, 0.4],
  [12, 0.3],
]);

const MAX_TRIED_GUTTER = 4;

/** Tile size(s) found in a file name: `"tiles_32x16.png"` → `[32, 16]`, `"dungeon-16"` → `[16, 16]`. */
export function tileSizeFromFileName(fileName: string): { width: number; height: number } | null {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, "");
  const pair = /(\d{1,3})\s*[x×]\s*(\d{1,3})/i.exec(base);
  if (pair) {
    const w = Number(pair[1]);
    const h = Number(pair[2]);
    if (plausibleSize(w) && plausibleSize(h)) return { width: w, height: h };
  }
  const numbers = [...base.matchAll(/\d+/g)].map((m) => Number(m[0])).filter(plausibleSize);
  const last = numbers[numbers.length - 1];
  return last === undefined ? null : { width: last, height: last };
}

function plausibleSize(n: number): boolean {
  return Number.isInteger(n) && n >= 4 && n <= 256;
}

/**
 * Suggests how to slice an image into tiles. See the module doc and
 * {@link TileGridReason} for the heuristics; every suggestion has at least
 * one whole tile, and images that do not divide evenly still get
 * suggestions (with `leftoverX` / `leftoverY` > 0).
 */
export function inferTileGrid(input: InferTileGridInput): InferTileGridResult {
  const { width, height } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { suggestions: [], best: null };
  }
  const alpha = input.alpha && input.alpha.length >= width * height ? new AlphaStats({ width, height, alpha: input.alpha }) : null;
  const named = input.fileName ? tileSizeFromFileName(input.fileName) : null;
  const hint = input.hintSize !== undefined && Number.isInteger(input.hintSize) && input.hintSize >= 1 ? input.hintSize : null;

  const specs = new Map<string, TileGridSpec>();
  const add = (tileWidth: number, tileHeight: number, margin = 0, spacing = 0) => {
    if (tileWidth < 1 || tileHeight < 1 || tileWidth > width || tileHeight > height) return;
    specs.set(`${tileWidth},${tileHeight},${margin},${spacing}`, { tileWidth, tileHeight, margin, spacing });
  };
  const sizes = new Set(COMMON_TILE_SIZES);
  if (hint !== null) sizes.add(hint);
  if (named) {
    sizes.add(named.width);
    sizes.add(named.height);
    add(named.width, named.height);
  }
  for (const s of sizes) add(s, s);
  if (alpha) {
    // Margin / spacing combinations whose gutters are fully transparent.
    const pairs: [number, number][] = [...sizes].map((s) => [s, s]);
    if (named) pairs.push([named.width, named.height]);
    for (const [tw, th] of pairs) {
      for (let m = 0; m <= MAX_TRIED_GUTTER; m++) {
        for (let s = 0; s <= MAX_TRIED_GUTTER; s++) {
          if (m === 0 && s === 0) continue;
          if (alpha.guttersEmpty("x", tw, m, s) && alpha.guttersEmpty("y", th, m, s)) add(tw, th, m, s);
        }
      }
    }
    // A regular pattern of transparent columns / rows (any tile size).
    const gx = alpha.gutterPattern("x");
    const gy = alpha.gutterPattern("y");
    if (gx && gy && gx.margin === gy.margin && gx.spacing === gy.spacing) add(gx.tile, gy.tile, gx.margin, gx.spacing);
    else if (gx && gx.tile <= height) add(gx.tile, gx.tile, gx.margin, gx.spacing);
    else if (gy && gy.tile <= width) add(gy.tile, gy.tile, gy.margin, gy.spacing);
  }

  const suggestions: TileGridSuggestion[] = [];
  for (const spec of specs.values()) {
    const s = scoreSpec(spec, width, height, alpha, named, hint);
    if (s) suggestions.push(s);
  }
  suggestions.sort(
    (a, b) => b.score - a.score || b.tileWidth * b.tileHeight - a.tileWidth * a.tileHeight || a.margin - b.margin || a.spacing - b.spacing,
  );
  const top = suggestions.slice(0, MAX_GRID_SUGGESTIONS);
  return { suggestions: top, best: top[0] ?? null };
}

function scoreSpec(
  spec: TileGridSpec,
  width: number,
  height: number,
  alpha: AlphaStats | null,
  named: { width: number; height: number } | null,
  hint: number | null,
): TileGridSuggestion | null {
  const { tileWidth: tw, tileHeight: th, margin: m, spacing: s } = spec;
  const columns = gridCount(width, tw, m, s);
  const rows = gridCount(height, th, m, s);
  if (columns < 1 || rows < 1) return null;
  const leftoverX = width - 2 * m - columns * tw - (columns - 1) * s;
  const leftoverY = height - 2 * m - rows * th - (rows - 1) * s;
  const parts: [TileGridReason, number][] = [];

  if (leftoverX === 0 && leftoverY === 0) parts.push(["divisible", 3]);
  else parts.push(["divisible", -Math.min(4, 2 * (leftoverX / tw + leftoverY / th) + 1)]);
  if (named && named.width === tw && named.height === th) parts.push(["fileName", 2.5]);
  if (hint !== null && hint === tw && hint === th) parts.push(["hint", 1.2]);
  const prior = tw === th ? (SIZE_PRIOR.get(tw) ?? 0) : 0;
  if (prior > 0) parts.push(["common", prior]);

  if (alpha) {
    // Margin / spacing candidates exist only when those lines are empty;
    // that says more the less transparent the image is. An empty outer
    // strip alone is weak evidence (sprites with transparent borders give
    // one for free), and margin-only sheets are rarer than spaced ones.
    const opaqueness = 1 - (alpha.emptyLineFraction("x") + alpha.emptyLineFraction("y")) / 2;
    if (s > 0) parts.push(["gutters", 3.2 * opaqueness + 0.3]);
    if (m > 0) parts.push(["gutters", 0.5 * opaqueness - (s === 0 ? 1 : 0)]);
    if (s === 0) {
      const seams = (alpha.seamEvidence("x", tw, m, columns) + alpha.seamEvidence("y", th, m, rows)) / 2;
      if (seams !== 0) parts.push(["seams", 3 * seams]);
    }
    const split = alpha.splitTileFraction({ ...spec, columns, rows });
    if (split > 0) parts.push(["seams", -3 * split]);
  }

  const score = Math.round(parts.reduce((sum, [, v]) => sum + v, 0) * 1000) / 1000;
  const reasons = [...new Set(parts.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([r]) => r))];
  return {
    tileWidth: tw,
    tileHeight: th,
    margin: m,
    spacing: s,
    columns,
    rows,
    leftoverX,
    leftoverY,
    score,
    reason: reasons[0] ?? "divisible",
    reasons,
  };
}

/** Summed-area table of opaque pixels plus per-line statistics. */
class AlphaStats {
  readonly #w: number;
  readonly #h: number;
  /** (w + 1) × (h + 1) prefix sums of `alpha > 0`. */
  readonly #sum: Uint32Array;
  /** Opaque pixels per column / row. */
  readonly #colCount: Uint32Array;
  readonly #rowCount: Uint32Array;
  /** `#colCont[x]`: rows where columns x - 1 and x are both opaque (x ≥ 1). Same for rows. */
  readonly #colCont: Uint32Array;
  readonly #rowCont: Uint32Array;

  constructor(image: AlphaImage) {
    const { width: w, height: h, alpha } = image;
    this.#w = w;
    this.#h = h;
    const sum = new Uint32Array((w + 1) * (h + 1));
    const colCount = new Uint32Array(w);
    const rowCount = new Uint32Array(h);
    const colCont = new Uint32Array(w);
    const rowCont = new Uint32Array(h);
    for (let y = 0; y < h; y++) {
      let run = 0;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const o = alpha[row + x]! > 0 ? 1 : 0;
        run += o;
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1]! + run;
        if (o) {
          colCount[x]!++;
          rowCount[y]!++;
          if (x > 0 && alpha[row + x - 1]! > 0) colCont[x]!++;
          if (y > 0 && alpha[row - w + x]! > 0) rowCont[y]!++;
        }
      }
    }
    this.#sum = sum;
    this.#colCount = colCount;
    this.#rowCount = rowCount;
    this.#colCont = colCont;
    this.#rowCont = rowCont;
  }

  /** Opaque pixels in [x0, x1) × [y0, y1) (clipped to the image). */
  opaque(x0: number, y0: number, x1: number, y1: number): number {
    const w1 = this.#w + 1;
    x0 = Math.max(0, Math.min(this.#w, x0));
    x1 = Math.max(0, Math.min(this.#w, x1));
    y0 = Math.max(0, Math.min(this.#h, y0));
    y1 = Math.max(0, Math.min(this.#h, y1));
    if (x1 <= x0 || y1 <= y0) return 0;
    const s = this.#sum;
    return s[y1 * w1 + x1]! - s[y0 * w1 + x1]! - s[y1 * w1 + x0]! + s[y0 * w1 + x0]!;
  }

  #counts(axis: "x" | "y"): Uint32Array {
    return axis === "x" ? this.#colCount : this.#rowCount;
  }

  /** Fraction of columns (`x`) or rows (`y`) that are fully transparent. */
  emptyLineFraction(axis: "x" | "y"): number {
    const counts = this.#counts(axis);
    let empty = 0;
    for (const c of counts) if (c === 0) empty++;
    return counts.length === 0 ? 0 : empty / counts.length;
  }

  /**
   * True when the margin strip and every spacing gutter along `axis` are
   * fully transparent, the image is not empty, and (with spacing) there is
   * at least one gutter between two tiles.
   */
  guttersEmpty(axis: "x" | "y", tile: number, margin: number, spacing: number): boolean {
    const counts = this.#counts(axis);
    const size = counts.length;
    const n = gridCount(size, tile, margin, spacing);
    if (n < 1 || (spacing > 0 && n < 2)) return false;
    let content = 0;
    for (let i = 0; i < size; i++) {
      const pos = i - margin;
      const inMargin = pos < 0 || i >= size - margin;
      const pitch = tile + spacing;
      const inGutter = !inMargin && pos % pitch >= tile && Math.floor(pos / pitch) < n - 1;
      if ((inMargin || inGutter) && counts[i]! > 0) return false;
      if (!inMargin && !inGutter) content += counts[i]!;
    }
    return content > 0;
  }

  /**
   * Regular transparent gutters along `axis`: runs of fully transparent
   * lines between content runs of (mostly) one length. Returns tile size,
   * spacing and margin, or `null` when there is no clear pattern.
   */
  gutterPattern(axis: "x" | "y"): { tile: number; spacing: number; margin: number } | null {
    const counts = this.#counts(axis);
    const runs: { empty: boolean; length: number }[] = [];
    for (const c of counts) {
      const empty = c === 0;
      const last = runs[runs.length - 1];
      if (last && last.empty === empty) last.length++;
      else runs.push({ empty, length: 1 });
    }
    const content = runs.filter((r) => !r.empty).map((r) => r.length);
    const first = runs[0]!;
    const inner = runs.slice(first.empty ? 1 : 0, runs[runs.length - 1]!.empty ? -1 : undefined).filter((r) => r.empty).map((r) => r.length);
    if (content.length < 2 || inner.length < 1) return null;
    const tile = mode(content);
    const spacing = mode(inner);
    if (content.filter((v) => v === tile).length < content.length * 0.6) return null;
    if (inner.filter((v) => v === spacing).length < inner.length * 0.6) return null;
    const margin = first.empty ? first.length : 0;
    if (margin > tile || spacing > tile) return null;
    return { tile, spacing, margin };
  }

  /**
   * Whether the grid lines of a spacing-free grid fall on breaks in the
   * art: 1 = the art never continues across them, −1 = it continues as
   * much as across an average line (seamless art: every size gets the
   * same), 0 = no signal.
   */
  seamEvidence(axis: "x" | "y", tile: number, margin: number, count: number): number {
    const cont = axis === "x" ? this.#colCont : this.#rowCont;
    if (count < 2 || cont.length < 2) return 0;
    let all = 0;
    for (let i = 1; i < cont.length; i++) all += cont[i]!;
    const baseline = all / (cont.length - 1);
    if (baseline <= 0) return 0;
    let ratio = 0;
    for (let k = 1; k < count; k++) ratio += Math.min(1, (cont[margin + k * tile] ?? 0) / baseline);
    return Math.max(-1, Math.min(1, 1 - (2 * ratio) / (count - 1)));
  }

  /**
   * Among non-empty tiles of at least 16 px, the fraction with an empty
   * aligned quarter or a fully transparent 2-line band through the middle
   * (signs that the real tiles are smaller).
   */
  splitTileFraction(grid: TileGrid): number {
    const { tileWidth: tw, tileHeight: th } = grid;
    if (tw < 16 || th < 16 || tw % 2 !== 0 || th % 2 !== 0) return 0;
    let nonEmpty = 0;
    let split = 0;
    const hw = tw / 2;
    const hh = th / 2;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.columns; col++) {
        const x = grid.margin + col * (tw + grid.spacing);
        const y = grid.margin + row * (th + grid.spacing);
        if (this.opaque(x, y, x + tw, y + th) === 0) continue;
        nonEmpty++;
        if (
          this.opaque(x, y, x + hw, y + hh) === 0 ||
          this.opaque(x + hw, y, x + tw, y + hh) === 0 ||
          this.opaque(x, y + hh, x + hw, y + th) === 0 ||
          this.opaque(x + hw, y + hh, x + tw, y + th) === 0 ||
          this.opaque(x + hw - 1, y, x + hw + 1, y + th) === 0 ||
          this.opaque(x, y + hh - 1, x + tw, y + hh + 1) === 0
        ) {
          split++;
        }
      }
    }
    return nonEmpty === 0 ? 0 : split / nonEmpty;
  }
}

/** Most frequent value (smallest on ties). */
function mode(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0]!;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v < best)) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** Alpha bytes of RGBA pixel data (e.g. canvas `ImageData.data`). */
export function alphaFromRgba(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3] ?? 0;
  return out;
}

/**
 * Ids of fully transparent tiles (every pixel alpha 0; pixels outside the
 * image count as transparent). The ids stay in the tileset — the palette
 * only dims or skips them.
 */
export function emptyTileIds(grid: TileGrid, image: AlphaImage): Set<number> {
  const stats = new AlphaStats(image);
  const out = new Set<number>();
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.columns; col++) {
      const x = grid.margin + col * (grid.tileWidth + grid.spacing);
      const y = grid.margin + row * (grid.tileHeight + grid.spacing);
      if (stats.opaque(x, y, x + grid.tileWidth, y + grid.tileHeight) === 0) out.add(row * grid.columns + col);
    }
  }
  return out;
}

/** What a grid problem looks like, or `null` for a valid spec (positive tile size, non-negative margin / spacing). */
export function tileGridSpecProblem(spec: TileGridSpec): string | null {
  for (const key of ["tileWidth", "tileHeight"] as const) {
    const v = spec[key];
    if (!Number.isInteger(v) || v < 1) return `${key} must be a positive integer, got ${String(v)}`;
  }
  for (const key of ["margin", "spacing"] as const) {
    const v = spec[key];
    if (!Number.isInteger(v) || v < 0) return `${key} must be a non-negative integer, got ${String(v)}`;
  }
  return null;
}

/**
 * Smallest image size the tileset's grid needs (margin on both sides). Core
 * does not store the real image size; this is the stand-in when an edit
 * does not pass one.
 */
export function tilesetImageExtent(grid: TileGrid): { width: number; height: number } {
  return {
    width: 2 * grid.margin + grid.columns * grid.tileWidth + Math.max(0, grid.columns - 1) * grid.spacing,
    height: 2 * grid.margin + grid.rows * grid.tileHeight + Math.max(0, grid.rows - 1) * grid.spacing,
  };
}

/**
 * `tileset` re-sliced with `spec` over an image of the given size: new
 * columns / rows, same metadata (solid flags and terrains are NOT remapped
 * here; the store ops do that).
 */
export function tilesetWithGrid(tileset: Tileset, spec: TileGridSpec, imageWidth: number, imageHeight: number): Tileset {
  return {
    ...tileset,
    tileWidth: spec.tileWidth,
    tileHeight: spec.tileHeight,
    margin: spec.margin,
    spacing: spec.spacing,
    columns: gridCount(imageWidth, spec.tileWidth, spec.margin, spec.spacing),
    rows: gridCount(imageHeight, spec.tileHeight, spec.margin, spec.spacing),
  };
}

/**
 * Where tile ids of grid `before` go in grid `after`, by pixel position:
 * an old tile whose top-left pixel is exactly the top-left pixel of a tile
 * of the new grid gets that tile's id; anything else (misaligned, or
 * outside the new grid) gets `null`. Works for ids beyond the old grid too
 * (their position follows the same formula). Simple and predictable — no
 * content matching.
 */
export function tilesetGridRemap(before: TileGrid, after: TileGrid): (tileId: number) => number | null {
  const pitchX = after.tileWidth + after.spacing;
  const pitchY = after.tileHeight + after.spacing;
  return (tileId) => {
    if (!Number.isInteger(tileId) || tileId < 0 || before.columns < 1) return null;
    const col = tileId % before.columns;
    const row = Math.floor(tileId / before.columns);
    const px = before.margin + col * (before.tileWidth + before.spacing) - after.margin;
    const py = before.margin + row * (before.tileHeight + before.spacing) - after.margin;
    if (px < 0 || py < 0 || px % pitchX !== 0 || py % pitchY !== 0) return null;
    const c = px / pitchX;
    const r = py / pitchY;
    if (c >= after.columns || r >= after.rows) return null;
    return r * after.columns + c;
  };
}
