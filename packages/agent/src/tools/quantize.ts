/** Picture → map cells. Pure and deterministic: no DOM, no randomness, no writes.
 * A reference image is mapped onto the map cell grid; every cell is compared with
 * candidate tiles by a downsampled colour/structure patch (render mode) or by its
 * dominant colour (sketch mode). The result is a C1 grid proposal for paint_grid. */
import type { RgbaImage } from "@smap/core";
import type { Point, Rect, ResolvedTile } from "../contracts";

/** Samples per side of the compared patch. */
export const QUANTIZE_PATCH = 12;
/** Fraction of each cell edge ignored (grid lines, antialiasing, label bleed). */
const INNER_MARGIN = 0.1;
/** Overlay must beat the plain ground by this factor to be proposed. */
const OVERLAY_GAIN = 0.9;
const LEGEND_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=?@^~!<>/|";

export type ReferenceFit = "stretch" | "contain";
export type QuantizeMode = "render" | "sketch";
/** C1 cell (subset produced by the quantizer). */
export type ProposalCell = { tilesetId: string; tileId: number; flags?: number } | null | "keep";
export interface GridLayerProposal { layerId: string; origin: Point; rows: string[]; legend: Record<string, ProposalCell> }
export interface QuantizeCandidate { tile: ResolvedTile; pixels: RgbaImage }
export interface ColorLegendEntry { rgb: readonly [number, number, number]; cell?: ProposalCell; overlay?: ProposalCell; stampId?: string; label: string }
export interface StampProbe { stampId: string; width: number; height: number; cells: { x: number; y: number; tile: ResolvedTile }[] }
export interface QuantizeInput {
  reference: RgbaImage;
  /** Reference pixels that correspond to the map region (after trimming). */
  sourceRect: Rect;
  region: Rect;
  fit: ReferenceFit;
  mode: QuantizeMode;
  candidates: readonly QuantizeCandidate[];
  overlay: boolean;
  colorLegend?: readonly ColorLegendEntry[];
  /** Overlay tile placements to look for in the quantized overlay (stamp detection). */
  stamps?: readonly StampProbe[];
  checkpoint?: () => Promise<void> | undefined;
}
export interface CellResult { ground: number; overlay: number; error: number; confidence: number; legend: number; covered: boolean }
export interface QuantizeOutput {
  cells: CellResult[];
  /** Candidate index → used. */
  groundRows: string[]; groundLegend: Record<string, ProposalCell>;
  overlayRows: string[] | null; overlayLegend: Record<string, ProposalCell>;
  counts: { ground: Record<string, number>; overlay: Record<string, number> };
  confidence: { high: number; medium: number; low: number; uncovered: number; meanError: number; lowCells: Point[]; lowCellsTruncated: boolean };
  stamps: { stampId: string; at: Point; source: "detected" | "legend" }[];
  /** Sketch mode: distinct cell colours, most frequent first, with what each became. */
  palette: { hex: string; cells: number; legend?: string; ground?: ProposalCell }[];
  cellPixels: { width: number; height: number };
  placement: Rect;
}

interface Patch { rgb: Float32Array; alpha: Float32Array; mean: [number, number, number]; opaque: boolean; visible: boolean }

/** Integer summed-area table over premultiplied RGB + alpha of a reference crop. */
class Integral {
  readonly w: number; readonly h: number;
  readonly sums: Float64Array[];
  constructor(image: RgbaImage, rect: Rect) {
    this.w = rect.width; this.h = rect.height;
    const stride = this.w + 1;
    this.sums = [0, 1, 2, 3].map(() => new Float64Array(stride * (this.h + 1)));
    const [r, g, b, a] = this.sums as [Float64Array, Float64Array, Float64Array, Float64Array];
    for (let y = 0; y < this.h; y++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      const row = (rect.y + y) * image.width;
      for (let x = 0; x < this.w; x++) {
        const p = (row + rect.x + x) * 4, alpha = image.data[p + 3]! / 255;
        sr += image.data[p]! * alpha; sg += image.data[p + 1]! * alpha; sb += image.data[p + 2]! * alpha; sa += alpha;
        const i = (y + 1) * stride + x + 1, up = y * stride + x + 1;
        r[i] = r[up]! + sr; g[i] = g[up]! + sg; b[i] = b[up]! + sb; a[i] = a[up]! + sa;
      }
    }
  }
  /** Mean premultiplied RGB + alpha over a fractional box, rounded to whole pixels (≥ 1 px). */
  box(x0: number, y0: number, x1: number, y1: number, out: number[]): void {
    let ax = Math.max(0, Math.min(this.w - 1, Math.floor(x0))), ay = Math.max(0, Math.min(this.h - 1, Math.floor(y0)));
    let bx = Math.max(ax + 1, Math.min(this.w, Math.round(x1))), by = Math.max(ay + 1, Math.min(this.h, Math.round(y1)));
    if (bx > this.w) { bx = this.w; ax = bx - 1; }
    if (by > this.h) { by = this.h; ay = by - 1; }
    const stride = this.w + 1, n = (bx - ax) * (by - ay);
    for (let c = 0; c < 4; c++) {
      const s = this.sums[c]!;
      out[c] = (s[by * stride + bx]! - s[ay * stride + bx]! - s[by * stride + ax]! + s[ay * stride + ax]!) / n;
    }
  }
}

function patchFromIntegral(integral: Integral, x0: number, y0: number, w: number, h: number): Patch {
  const P = QUANTIZE_PATCH, rgb = new Float32Array(P * P * 3), alpha = new Float32Array(P * P), tmp = [0, 0, 0, 0];
  const mx = w * INNER_MARGIN, my = h * INNER_MARGIN, iw = (w - 2 * mx) / P, ih = (h - 2 * my) / P;
  let mr = 0, mg = 0, mb = 0, minA = 1, maxA = 0;
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    const sx = x0 + mx + i * iw, sy = y0 + my + j * ih;
    integral.box(sx, sy, sx + iw, sy + ih, tmp);
    const k = j * P + i;
    rgb[k * 3] = tmp[0]!; rgb[k * 3 + 1] = tmp[1]!; rgb[k * 3 + 2] = tmp[2]!; alpha[k] = tmp[3]!;
    mr += tmp[0]!; mg += tmp[1]!; mb += tmp[2]!; minA = Math.min(minA, tmp[3]!); maxA = Math.max(maxA, tmp[3]!);
  }
  const n = P * P;
  return { rgb, alpha, mean: [mr / n, mg / n, mb / n], opaque: minA > 0.98, visible: maxA > 0.02 };
}

/** Candidate tile → inner-cropped patch with the same sampling as reference cells. */
export function tilePatch(pixels: RgbaImage): Patch {
  return patchFromIntegral(new Integral(pixels, { x: 0, y: 0, width: pixels.width, height: pixels.height }), 0, 0, pixels.width, pixels.height);
}

function distance(a: Float32Array, b: Float32Array, limit: number): number {
  let sum = 0;
  const cut = limit * a.length;
  for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; sum += d * d; if (sum > cut) return Infinity; }
  return sum / a.length;
}
function compositeDistance(cell: Float32Array, fg: Patch, bg: Float32Array, limit: number): number {
  let sum = 0;
  const n = cell.length, cut = limit * n;
  for (let k = 0, s = 0; k < n; k += 3, s++) {
    const keep = 1 - fg.alpha[s]!;
    for (let c = 0; c < 3; c++) { const d = cell[k + c]! - (fg.rgb[k + c]! + bg[k + c]! * keep); sum += d * d; }
    if (sum > cut) return Infinity;
  }
  return sum / n;
}
const key = (t: ResolvedTile) => `${t.tilesetId}\u0000${t.tileId}\u0000${t.flags}`;
const cellJson = (t: ResolvedTile): ProposalCell => t.flags ? { tilesetId: t.tilesetId, tileId: t.tileId, flags: t.flags } : { tilesetId: t.tilesetId, tileId: t.tileId };

/** Placement of the reference over the region in cell units (contain may letterbox). */
export function referencePlacement(sourceRect: Rect, region: Rect, fit: ReferenceFit, cellAspect = 1): Rect {
  if (fit === "stretch") return { x: 0, y: 0, width: region.width, height: region.height };
  const refAspect = sourceRect.width / sourceRect.height, regionAspect = region.width * cellAspect / region.height;
  if (refAspect >= regionAspect) { const h = region.width * cellAspect / refAspect; return { x: 0, y: (region.height - h) / 2, width: region.width, height: h }; }
  const w = region.height * refAspect / cellAspect;
  return { x: (region.width - w) / 2, y: 0, width: w, height: region.height };
}

/** Trim uniform dark/neutral borders (editor gutters, letterboxing) from a reference. */
export function autoTrim(image: RgbaImage): Rect {
  // Only a uniform dark, neutral frame (editor gutters, letterboxing) is trimmed; textured dark maps stay.
  const at = (x: number, y: number) => (y * image.width + x) * 4;
  const corner = [image.data[0]!, image.data[1]!, image.data[2]!];
  if (Math.max(...corner) >= 72 || Math.max(...corner) - Math.min(...corner) >= 28) return { x: 0, y: 0, width: image.width, height: image.height };
  const frame = (p: number) => image.data[p + 3]! < 16 || Math.abs(image.data[p]! - corner[0]!) + Math.abs(image.data[p + 1]! - corner[1]!) + Math.abs(image.data[p + 2]! - corner[2]!) <= 24;
  const lineFrame = (horizontal: boolean, index: number, from: number, to: number) => {
    let n = 0;
    for (let i = from; i < to; i++) if (frame(horizontal ? at(i, index) : at(index, i))) n++;
    return n >= (to - from) * 0.7;
  };
  let top = 0, bottom = image.height, left = 0, right = image.width;
  const maxTrim = 0.25;
  while (top < image.height * maxTrim && lineFrame(true, top, left, right)) top++;
  while (bottom > image.height * (1 - maxTrim) && lineFrame(true, bottom - 1, left, right)) bottom--;
  while (left < image.width * maxTrim && lineFrame(false, left, top, bottom)) left++;
  while (right > image.width * (1 - maxTrim) && lineFrame(false, right - 1, top, bottom)) right--;
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function legendChars(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(i < LEGEND_ALPHABET.length ? LEGEND_ALPHABET[i]! : String.fromCodePoint(0xc0 + i - LEGEND_ALPHABET.length));
  return out;
}

/** Rows + legend from per-cell values; most frequent value gets the first letter. */
export function encodeLayer(width: number, height: number, values: (ProposalCell | undefined)[]): { rows: string[]; legend: Record<string, ProposalCell>; counts: Record<string, number> } {
  const freq = new Map<string, { cell: ProposalCell; n: number; first: number }>();
  values.forEach((cell, i) => {
    if (cell === undefined || cell === "keep") return;
    const k = JSON.stringify(cell);
    const e = freq.get(k);
    if (e) e.n++; else freq.set(k, { cell, n: 1, first: i });
  });
  const ordered = [...freq.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first);
  const chars = legendChars(ordered.length), lookup = new Map<string, string>(), legend: Record<string, ProposalCell> = {}, counts: Record<string, number> = {};
  ordered.forEach(([k, e], i) => { lookup.set(k, chars[i]!); legend[chars[i]!] = e.cell; counts[chars[i]!] = e.n; });
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const cell = values[y * width + x];
      row += cell === undefined || cell === "keep" ? " " : lookup.get(JSON.stringify(cell))!;
    }
    rows.push(row);
  }
  return { rows, legend, counts };
}

/** Dominant colour of a reference cell: mode of a 4-bit/channel histogram, refined to its mean. */
function dominantColor(image: RgbaImage, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const ax = Math.floor(x0), ay = Math.floor(y0), bx = Math.max(ax + 1, Math.ceil(x1)), by = Math.max(ay + 1, Math.ceil(y1));
  const step = Math.max(1, Math.floor(Math.min(bx - ax, by - ay) / 12));
  for (let y = ay; y < by && y < image.height; y += step) for (let x = ax; x < bx && x < image.width; x += step) {
    const p = (y * image.width + x) * 4;
    if (image.data[p + 3]! < 128) continue;
    const r = image.data[p]!, g = image.data[p + 1]!, b = image.data[p + 2]!;
    const k = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    const e = bins.get(k);
    if (e) { e.n++; e.r += r; e.g += g; e.b += b; } else bins.set(k, { n: 1, r, g, b });
  }
  let best: { n: number; r: number; g: number; b: number } | undefined;
  for (const e of bins.values()) if (!best || e.n > best.n) best = e;
  return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [0, 0, 0];
}
const rgbDistance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** Heuristic for mode:"auto": flat-colour cells → sketch, textured cells → render. */
export function looksLikeSketch(reference: RgbaImage, sourceRect: Rect): boolean {
  const samples = Math.max(1, Math.min(24, Math.floor(Math.min(sourceRect.width, sourceRect.height) / 12))), flat: number[] = [];
  const cw = sourceRect.width / samples, ch = sourceRect.height / samples;
  for (let j = 0; j < samples; j++) for (let i = 0; i < samples; i++) {
    const x0 = Math.floor(sourceRect.x + (i + 0.25) * cw), y0 = Math.floor(sourceRect.y + (j + 0.25) * ch);
    const x1 = Math.max(x0 + 1, Math.floor(sourceRect.x + (i + 0.75) * cw)), y1 = Math.max(y0 + 1, Math.floor(sourceRect.y + (j + 0.75) * ch));
    let n = 0, s = 0, s2 = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = (y * reference.width + x) * 4, v = reference.data[p]! * 0.3 + reference.data[p + 1]! * 0.59 + reference.data[p + 2]! * 0.11;
      n++; s += v; s2 += v * v;
    }
    flat.push(Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)));
  }
  flat.sort((a, b) => a - b);
  return flat[Math.floor(flat.length / 2)]! < 3;
}

export async function quantizeReference(input: QuantizeInput): Promise<QuantizeOutput> {
  const { reference, sourceRect, region, mode } = input;
  const W = region.width, H = region.height;
  const placement = referencePlacement(sourceRect, region, input.fit);
  const pxPerCellX = sourceRect.width / placement.width, pxPerCellY = sourceRect.height / placement.height;
  const integral = new Integral(reference, sourceRect);
  const patches = input.candidates.map(c => tilePatch(c.pixels));
  const groundIdx = patches.flatMap((p, i) => p.opaque ? [i] : []);
  const overlayIdx = input.overlay ? patches.flatMap((p, i) => !p.opaque && p.visible ? [i] : []) : [];
  const cells: CellResult[] = [];
  const groundValues: (ProposalCell | undefined)[] = [], overlayValues: (ProposalCell | undefined)[] = [];
  const legendStamps: { entry: number; x: number; y: number }[] = [];
  const clusters: { rgb: [number, number, number]; n: number; legend: number; ground: number }[] = [];
  const cluster = (rgb: [number, number, number], legend: number, ground: number) => {
    const hit = clusters.find(c => c.legend === legend && c.ground === ground && rgbDistance(c.rgb, rgb) < 24);
    if (hit) hit.n++; else if (clusters.length < 64) clusters.push({ rgb, n: 1, legend, ground });
  };
  let checked = 0;
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if ((++checked & 63) === 0) { const pause = input.checkpoint?.(); if (pause) await pause; }
    const lx = cx - placement.x, ly = cy - placement.y;
    // A cell is covered when its centre lies on the placed reference.
    if (lx + 0.5 < 0 || ly + 0.5 < 0 || lx + 0.5 >= placement.width || ly + 0.5 >= placement.height) {
      cells.push({ ground: -1, overlay: -1, error: 0, confidence: 0, legend: -1, covered: false });
      groundValues.push(undefined); overlayValues.push(undefined); continue;
    }
    const x0 = Math.max(0, lx * pxPerCellX), y0 = Math.max(0, ly * pxPerCellY);
    const x1 = Math.min(sourceRect.width, (lx + 1) * pxPerCellX), y1 = Math.min(sourceRect.height, (ly + 1) * pxPerCellY);
    if (mode === "sketch") {
      const mx = (x1 - x0) * 0.15, my = (y1 - y0) * 0.15;
      const color = dominantColor(reference, sourceRect.x + x0 + mx, sourceRect.y + y0 + my, sourceRect.x + x1 - mx, sourceRect.y + y1 - my);
      let legend = -1, legendDistance = Infinity;
      input.colorLegend?.forEach((entry, i) => { const d = rgbDistance(color, entry.rgb); if (d < legendDistance) { legendDistance = d; legend = i; } });
      if (legend >= 0 && legendDistance <= 64) {
        const entry = input.colorLegend![legend]!;
        if (entry.stampId) legendStamps.push({ entry: legend, x: cx, y: cy });
        cluster(color, legend, -1);
        cells.push({ ground: -1, overlay: -1, error: legendDistance, confidence: Math.max(0, 1 - legendDistance / 64), legend, covered: true });
        groundValues.push(entry.stampId ? undefined : entry.cell); overlayValues.push(entry.overlay ?? undefined);
        continue;
      }
      let best = -1, bestD = Infinity, second = Infinity;
      for (const i of groundIdx) {
        const d = rgbDistance(color, patches[i]!.mean);
        if (d < bestD) { second = bestD; bestD = d; best = i; } else if (d < second) second = d;
      }
      cells.push({ ground: best, overlay: -1, error: bestD, confidence: best < 0 ? 0 : Math.max(0, Math.min(1, 1 - bestD / 96)) * (second === Infinity ? 1 : Math.min(1, (second - bestD) / Math.max(1, bestD) + 0.5)), legend: -1, covered: true });
      groundValues.push(best < 0 ? undefined : cellJson(input.candidates[best]!.tile)); overlayValues.push(undefined);
      cluster(color, -1, best);
      continue;
    }
    const cell = patchFromIntegral(integral, x0, y0, x1 - x0, y1 - y0).rgb;
    // Ground: nearest opaque tiles; keep the best few for overlay compositing.
    const top: { i: number; d: number }[] = [];
    for (const i of groundIdx) {
      const limit = top.length >= 6 ? top[top.length - 1]!.d : Infinity;
      const d = distance(cell, patches[i]!.rgb, limit);
      if (d === Infinity) continue;
      top.push({ i, d }); top.sort((a, b) => a.d - b.d); if (top.length > 6) top.pop();
    }
    let best = top[0] ? { ground: top[0].i, overlay: -1, d: top[0].d } : { ground: -1, overlay: -1, d: Infinity };
    let second = top[1]?.d ?? Infinity;
    for (const { i: g } of top) for (const o of overlayIdx) {
      const d = compositeDistance(cell, patches[o]!, patches[g]!.rgb, Math.min(best.d, second) * (best.overlay < 0 ? OVERLAY_GAIN : 1));
      if (d === Infinity) continue;
      if (d < best.d * (best.overlay < 0 ? OVERLAY_GAIN : 1)) { second = best.d; best = { ground: g, overlay: o, d }; }
      else if (d < second) second = d;
    }
    const rmse = Math.sqrt(best.d);
    const margin = second === Infinity ? 1 : Math.min(1, (Math.sqrt(second) - rmse) / Math.max(4, rmse));
    const fit = Math.max(0, 1 - rmse / 48);
    cells.push({ ground: best.ground, overlay: best.overlay, error: rmse, confidence: Math.max(0, Math.min(1, fit * (0.4 + 0.6 * margin))), legend: -1, covered: true });
    groundValues.push(best.ground < 0 ? undefined : cellJson(input.candidates[best.ground]!.tile));
    overlayValues.push(best.overlay < 0 ? undefined : cellJson(input.candidates[best.overlay]!.tile));
  }
  // Legend stamps: cells dominated by a stamp colour get the background ground; stamps go on pixel blobs.
  const stamps: QuantizeOutput["stamps"] = [];
  if (mode === "sketch" && input.colorLegend?.some(entry => entry.stampId)) {
    const groundFreq = new Map<string, { cell: ProposalCell; n: number }>();
    for (const v of groundValues) if (v && v !== "keep") { const k = JSON.stringify(v); const e = groundFreq.get(k); if (e) e.n++; else groundFreq.set(k, { cell: v, n: 1 }); }
    const background = [...groundFreq.values()].sort((x, y) => y.n - x.n)[0]?.cell;
    for (const s of legendStamps) groundValues[s.y * W + s.x] = input.colorLegend![s.entry]!.cell ?? background;
    for (const p of await legendStampPlacements(input, placement, pxPerCellX, pxPerCellY)) stamps.push(p);
  }
  // Detected stamps: every non-empty stamp cell equals the topmost proposed tile (overlay, else ground).
  if (mode === "render" && input.stamps?.length)
    stamps.push(...detectStampProbes(region, cells.map(c => c.overlay >= 0 ? key(input.candidates[c.overlay]!.tile) : c.ground >= 0 ? key(input.candidates[c.ground]!.tile) : ""), input.stamps));
  const ground = encodeLayer(W, H, groundValues), overlay = encodeLayer(W, H, overlayValues);
  const confidence = summarizeConfidence(cells, region);
  return {
    cells,
    groundRows: ground.rows, groundLegend: ground.legend,
    overlayRows: input.overlay || overlayValues.some(v => v !== undefined) ? overlay.rows : null, overlayLegend: overlay.legend,
    counts: { ground: ground.counts, overlay: overlay.counts },
    confidence,
    stamps,
    palette: clusters.sort((a, b) => b.n - a.n).slice(0, 16).map(c => ({
      hex: "#" + c.rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join(""), cells: c.n,
      ...(c.legend >= 0 ? { legend: input.colorLegend![c.legend]!.label } : c.ground >= 0 ? { ground: cellJson(input.candidates[c.ground]!.tile) } : {}),
    })),
    cellPixels: { width: Math.round(pxPerCellX * 100) / 100, height: Math.round(pxPerCellY * 100) / 100 },
    placement,
  };
}

/** Stamps whose every non-empty cell equals the topmost proposed tile key (row-major cells of region). */
export function detectStampProbes(region: Rect, topKeys: readonly string[], probes: readonly StampProbe[]): QuantizeOutput["stamps"] {
  const W = region.width, H = region.height, claimed = new Set<number>(), out: QuantizeOutput["stamps"] = [];
  for (const probe of [...probes].sort((a, b) => b.cells.length - a.cells.length || (a.stampId < b.stampId ? -1 : 1))) {
    if (!probe.cells.length) continue;
    for (let y = 0; y + probe.height <= H; y++) for (let x = 0; x + probe.width <= W; x++) {
      if (probe.cells.some(c => claimed.has((y + c.y) * W + x + c.x) || topKeys[(y + c.y) * W + x + c.x] !== key(c.tile))) continue;
      for (const c of probe.cells) claimed.add((y + c.y) * W + x + c.x);
      out.push({ stampId: probe.stampId, at: { x: x + region.x, y: y + region.y }, source: "detected" });
    }
  }
  return out;
}
/** Confidence bands (≥0.6 high, ≥0.3 medium) and the first low cells. */
export function summarizeConfidence(cells: readonly CellResult[], region: Rect): QuantizeOutput["confidence"] {
  const W = region.width;
  let high = 0, medium = 0, low = 0, uncovered = 0, errorSum = 0, covered = 0;
  const lowCells: Point[] = [];
  cells.forEach((c, i) => {
    if (!c.covered) { uncovered++; return; }
    covered++; errorSum += c.error;
    if (c.confidence >= 0.6) high++; else if (c.confidence >= 0.3) medium++; else { low++; if (lowCells.length < 64) lowCells.push({ x: region.x + i % W, y: region.y + Math.floor(i / W) }); }
  });
  return { high, medium, low, uncovered, meanError: covered ? Math.round(errorSum / covered * 10) / 10 : 0, lowCells, lowCellsTruncated: low > lowCells.length };
}
export const tileKey = (t: ResolvedTile): string => key(t);

/** One stamp per pixel blob of its legend colours (small dots such as trees rarely dominate a whole cell). */
async function legendStampPlacements(input: QuantizeInput, placement: Rect, pxPerCellX: number, pxPerCellY: number): Promise<QuantizeOutput["stamps"]> {
  const { reference, sourceRect, region } = input, legend = input.colorLegend!;
  const W = region.width, H = region.height, w = sourceRect.width, h = sourceRect.height;
  const owner = new Int16Array(w * h).fill(-1), ids = [...new Set(legend.flatMap(entry => entry.stampId ? [entry.stampId] : []))];
  for (let y = 0; y < h; y++) {
    if ((y & 31) === 0) { const pause = input.checkpoint?.(); if (pause) await pause; }
    for (let x = 0; x < w; x++) {
      const p = ((sourceRect.y + y) * reference.width + sourceRect.x + x) * 4;
      if (reference.data[p + 3]! < 128) continue;
      let best = -1, bestD = 40;
      legend.forEach((entry, i) => { const d = Math.hypot(reference.data[p]! - entry.rgb[0], reference.data[p + 1]! - entry.rgb[1], reference.data[p + 2]! - entry.rgb[2]); if (d < bestD) { bestD = d; best = i; } });
      if (best >= 0 && legend[best]!.stampId) owner[y * w + x] = ids.indexOf(legend[best]!.stampId!);
    }
  }
  const out: QuantizeOutput["stamps"] = [], cellArea = pxPerCellX * pxPerCellY, seen = new Uint8Array(w * h), stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (owner[start]! < 0 || seen[start]) continue;
    const id = owner[start]!;
    let area = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!, x = c % w, y = (c - x) / w;
      area++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const n of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1])
        if (n >= 0 && !seen[n] && owner[n] === id) { seen[n] = 1; stack.push(n); }
    }
    if (area < cellArea * 0.25) continue;
    const probe = input.stamps?.find(p => p.stampId === ids[id]), sw = probe?.width ?? 1, sh = probe?.height ?? 1;
    // Touching blobs get several stamps, split along the longer axis.
    const count = Math.max(1, Math.round(area / (sw * sh * cellArea * 1.6)));
    const horizontal = maxX - minX >= maxY - minY;
    for (let k = 0; k < count; k++) {
      const x0 = horizontal ? minX + (maxX - minX + 1) * k / count : minX, x1 = horizontal ? minX + (maxX - minX + 1) * (k + 1) / count : maxX + 1;
      const y0 = horizontal ? minY : minY + (maxY - minY + 1) * k / count, y1 = horizontal ? maxY + 1 : minY + (maxY - minY + 1) * (k + 1) / count;
      const cx = placement.x + (x0 + x1) / 2 / pxPerCellX, cy = placement.y + (y0 + y1) / 2 / pxPerCellY;
      out.push({ stampId: ids[id]!, at: { x: Math.max(0, Math.min(W - sw, Math.round(cx - sw / 2))) + region.x, y: Math.max(0, Math.min(H - sh, Math.round(cy - sh / 2))) + region.y }, source: "legend" });
    }
  }
  return out;
}

/** Parse "#rgb" / "#rrggbb" into RGB. */
export function parseHexColor(value: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split("").map(c => c + c).join("") : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
