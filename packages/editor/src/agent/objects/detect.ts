/** Stamps in a picture (K5). Pure and deterministic: no DOM, no randomness.
 *
 * The aligned picture is resampled to map pixels; every stamp is a template with its real alpha (transparent
 * cells and edges are masked out). A placement is scored on its visible template pixels after a simple light
 * model (one luminance gain, one offset per channel: uneven light, a warm glow), with a structure term so flat
 * ground cannot pass for textured art. Penalties on the light keep an object from passing for a recoloured one.
 *
 * Search: a softened coarse level (≈8 px per cell) is scanned at every position; its local maxima are probed and
 * refined to the exact pixel at full resolution. Acceptance is greedy, big-and-confident first. An accepted object
 * owns the picture pixels it explains; later candidates are scored on their unowned (visible) pixels only and the
 * scan is repeated on what is left, so an object partly hidden under another (stacked crates) is found after the
 * one in front. */
import type { RgbaImage } from "@smap/core";

export interface DetectTemplate { id: string; cellsW: number; cellsH: number; image: RgbaImage; /** Variants of one object (mirrors) share a family: one match per place. */ family?: string }
export interface DetectInput {
  /** Map-pixel picture (cols*tileWidth × rows*tileHeight). */
  work: RgbaImage;
  tileWidth: number; tileHeight: number;
  templates: readonly DetectTemplate[];
  minScore: number;
  maxMatches: number;
  checkpoint?: () => Promise<void> | undefined;
}
export interface DetectedObject {
  id: string;
  /** Top-left cell and the object's pixel offset from it (map pixels). */
  x: number; y: number; dx: number; dy: number;
  /** Top-left in work pixels and template size. */
  px: number; py: number; width: number; height: number;
  score: number;
}
export interface DetectOutput { matches: DetectedObject[]; truncated: boolean }

/** Colour distance (RGB, 0..441) at which a pixel stops counting as similar. */
const COLOR_RANGE = 150;
/** Pixels closer than this belong to the accepted object (its inliers). */
const INLIER_DISTANCE = 60;
const MIN_GAIN = 0.7, MAX_GAIN = 1.45, MIN_OFFSET = -48, MAX_OFFSET = 64;
const GAIN_PENALTY = 0.15, OFFSET_PENALTY = 0.15, STRUCTURE_PENALTY = 0.3;
/** A tinted light (warm glow) shifts channels a little; beyond that a channel shift means other art (a recolour). */
const FREE_CHROMA = 16, CHROMA_PENALTY = 2;
const chromaPenalty = (r: number, g: number, b: number, mean: number) => CHROMA_PENALTY * Math.max(0, Math.max(Math.abs(r - mean), Math.abs(g - mean), Math.abs(b - mean)) - FREE_CHROMA) / 255;
/** The worst share of pixels is ignored (clipped highlights, a stray overlap). */
const TRIM = 0.1;
/** Mean colour difference (RGB) between flat art and its holes for the art to count as present. */
const FLAT_CONTRAST = 14;
/** Share of a template's scored pixels that must be visible (not owned, inside the picture). */
const MIN_VISIBLE = 0.5;
const COARSE_PER_TEMPLATE = 4096, COARSE_POINTS = 192, GATE_POINTS = 24, PROBE_POINTS = 64, REFINE_POINTS = 256, COARSE_SLACK = 0.35, COARSE_STRUCTURE = 0.5, GATE_SLACK = 0.25, ROUNDS = 4;
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const clamp = (v: number, lo: number, hi: number) => v < lo ? lo : v > hi ? hi : v;

/** Scored template pixels for one plane: index offsets (row stride of that plane), colours and luminance. */
interface Points { o: Int32Array; r: Float32Array; g: Float32Array; b: Float32Array; l: Float32Array; w: number; h: number; textured: boolean }
interface Plane { width: number; height: number; r: Float32Array; g: Float32Array; b: Float32Array; l: Float32Array; valid: Uint8Array }
interface Prepared { id: string; family: string; cellsW: number; cellsH: number; width: number; height: number; holes: Points | null; all: Points; refine: Points; probe: Points; gate: Points; coarse: Points | null; cw: number; ch: number }

function textured(image: RgbaImage, xs: readonly number[], ys: readonly number[]): boolean {
  let s = 0, ss = 0;
  for (let i = 0; i < xs.length; i++) { const p = (ys[i]! * image.width + xs[i]!) * 4, l = lum(image.data[p]!, image.data[p + 1]!, image.data[p + 2]!); s += l; ss += l * l; }
  return xs.length > 1 && Math.sqrt(Math.max(0, ss / xs.length - (s / xs.length) ** 2)) > 8;
}
/** Pixels with alpha ≥ threshold; an evenly spread subset (deterministic) when there are more than limit. */
function points(image: RgbaImage, threshold: number, stride: number, limit = Infinity): Points {
  let xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (image.data[(y * image.width + x) * 4 + 3]! >= threshold) { xs.push(x); ys.push(y); }
  const rich = textured(image, xs, ys);
  if (xs.length > limit) {
    const sx: number[] = [], sy: number[] = [];
    for (let i = 0; i < limit; i++) { const k = Math.floor((i + 0.5) * xs.length / limit); sx.push(xs[k]!); sy.push(ys[k]!); }
    xs = sx; ys = sy;
  }
  const n = xs.length;
  const out: Points = { o: new Int32Array(n), r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), l: new Float32Array(n), w: image.width, h: image.height, textured: rich };
  for (let i = 0; i < n; i++) {
    const p = (ys[i]! * image.width + xs[i]!) * 4;
    out.o[i] = ys[i]! * stride + xs[i]!;
    out.r[i] = image.data[p]!; out.g[i] = image.data[p + 1]!; out.b[i] = image.data[p + 2]!;
    out.l[i] = lum(out.r[i]!, out.g[i]!, out.b[i]!);
  }
  return out;
}
/** Box-downsampled straight-alpha image. */
function shrink(image: RgbaImage, f: number): RgbaImage {
  const width = Math.floor(image.width / f), height = Math.floor(image.height / f), out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) {
      const p = ((y * f + yy) * image.width + x * f + xx) * 4, w = image.data[p + 3]!;
      r += image.data[p]! * w; g += image.data[p + 1]! * w; b += image.data[p + 2]! * w; a += w;
    }
    const q = (y * width + x) * 4;
    if (a) { out[q] = Math.round(r / a); out[q + 1] = Math.round(g / a); out[q + 2] = Math.round(b / a); out[q + 3] = Math.round(a / (f * f)); }
  }
  return { width, height, data: out };
}
/** 3×3 box blur of colour weighted by alpha; alpha itself is kept, so masks stay sharp. The coarse scan then
 * barely depends on the sub-pixel phase between picture and art. */
function soften(image: RgbaImage): RgbaImage {
  const { width, height, data } = image, out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
      const p = (yy * width + xx) * 4, w = data[p + 3]!;
      r += data[p]! * w; g += data[p + 1]! * w; b += data[p + 2]! * w; a += w;
    }
    const q = (y * width + x) * 4;
    if (a) { out[q] = Math.round(r / a); out[q + 1] = Math.round(g / a); out[q + 2] = Math.round(b / a); }
    out[q + 3] = data[q + 3]!;
  }
  return { width, height, data: out };
}
/** Alpha replaced by the minimum alpha of the 3×3 neighbourhood (outside counts as transparent). */
function erode(image: RgbaImage): RgbaImage {
  const { width, height, data } = image, out = new Uint8Array(data);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let a = 255;
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) a = Math.min(a, xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : data[(yy * width + xx) * 4 + 3]!);
    out[(y * width + x) * 4 + 3] = a;
  }
  return { width, height, data: out };
}
function plane(image: RgbaImage): Plane {
  const n = image.width * image.height;
  const out: Plane = { width: image.width, height: image.height, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), l: new Float32Array(n), valid: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    out.r[i] = image.data[i * 4]!; out.g[i] = image.data[i * 4 + 1]!; out.b[i] = image.data[i * 4 + 2]!;
    out.l[i] = lum(out.r[i]!, out.g[i]!, out.b[i]!); out.valid[i] = image.data[i * 4 + 3]! >= 128 ? 1 : 0;
  }
  return out;
}

/** Shared scratch (the search is synchronous between awaits and never re-entered). */
const scratch = { i: new Int32Array(0), k: new Int32Array(0), bins: new Uint32Array(65) };
/** Light fitted by the last {@link visibleLight} call, with its luminance sums. */
const lit = { gain: 1, r: 0, g: 0, b: 0, penalty: 0, st: 0, sr: 0, stt: 0, srr: 0, str: 0 };
/** Collect visible template points placed at base (index of the top-left) and fit picture ≈ gain·art + offset.
 * Gain from luminance (least squares on textured art, ratio on flat art); textured art also gets one offset per
 * channel. Flat art gets none: it would turn any flat colour into any other. Returns the visible count. */
function visibleLight(work: Plane, pts: Points, base: number, blocked: Int32Array | null): number {
  const n = pts.o.length;
  if (scratch.k.length < n) { scratch.i = new Int32Array(n); scratch.k = new Int32Array(n); }
  let m = 0, st = 0, sr = 0, stt = 0, srr = 0, str = 0, tr = 0, tg = 0, tb = 0, rr = 0, rg = 0, rb = 0;
  for (let i = 0; i < n; i++) {
    const k = base + pts.o[i]!;
    if (!work.valid[k] || (blocked !== null && blocked[k]! >= 0)) continue;
    const lt = pts.l[i]!, lr = work.l[k]!;
    st += lt; sr += lr; stt += lt * lt; srr += lr * lr; str += lt * lr;
    tr += pts.r[i]!; tg += pts.g[i]!; tb += pts.b[i]!; rr += work.r[k]!; rg += work.g[k]!; rb += work.b[k]!;
    scratch.i[m] = i; scratch.k[m] = k; m++;
  }
  lit.st = st; lit.sr = sr; lit.stt = stt; lit.srr = srr; lit.str = str;
  if (!m) return 0;
  const mt = st / m, mr = sr / m, vt = stt / m - mt * mt;
  if (vt <= 25) {
    lit.gain = st > m ? clamp(sr / st, MIN_GAIN, MAX_GAIN) : 1; lit.r = lit.g = lit.b = 0;
    lit.penalty = GAIN_PENALTY * Math.abs(Math.log(lit.gain));
    return m;
  }
  const gain = lit.gain = clamp((str / m - mt * mr) / vt, MIN_GAIN, MAX_GAIN);
  lit.r = clamp((rr - gain * tr) / m, MIN_OFFSET, MAX_OFFSET); lit.g = clamp((rg - gain * tg) / m, MIN_OFFSET, MAX_OFFSET); lit.b = clamp((rb - gain * tb) / m, MIN_OFFSET, MAX_OFFSET);
  const mean = (lit.r + lit.g + lit.b) / 3;
  lit.penalty = GAIN_PENALTY * Math.abs(Math.log(gain)) + OFFSET_PENALTY * Math.abs(mean) / 255 + chromaPenalty(lit.r, lit.g, lit.b, mean);
  return m;
}
/** Distance between lit art and a picture pixel; lit art saturates like the picture does. */
function litDistance(pts: Points, i: number, work: Plane, k: number): number {
  const dr = clamp(lit.gain * pts.r[i]! + lit.r, 0, 255) - work.r[k]!, dg = clamp(lit.gain * pts.g[i]! + lit.g, 0, 255) - work.g[k]!, db = clamp(lit.gain * pts.b[i]! + lit.b, 0, 255) - work.b[k]!;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

interface Score { score: number; visible: number }
/** Masked similarity of template points placed with top-left (px,py). blocked[k] ≥ 0 hides picture pixels owned
 * by accepted objects. Placements reaching outside the plane are not scored. */
function score(work: Plane, pts: Points, px: number, py: number, blocked: Int32Array | null): Score {
  if (px < 0 || py < 0 || px + pts.w > work.width || py + pts.h > work.height) return { score: -1, visible: 0 };
  const n = pts.o.length, m = visibleLight(work, pts, py * work.width + px, blocked);
  if (!m || m < MIN_VISIBLE * n) return { score: -1, visible: m };
  // Mean similarity of the best (1 - TRIM) share: a 64-bin histogram keeps it linear.
  const bins = scratch.bins.fill(0);
  let total = 0;
  for (let j = 0; j < m; j++) {
    const s = 1 - litDistance(pts, scratch.i[j]!, work, scratch.k[j]!) / COLOR_RANGE;
    if (s <= 0) { bins[0]!++; continue; }
    bins[Math.round(s * 64)]!++; total += s;
  }
  const dropped = Math.floor(m * TRIM);
  for (let bin = 0, drop = dropped; bin <= 64 && drop > 0; bin++) { const take = Math.min(drop, bins[bin]!); total -= take * bin / 64; drop -= take; }
  let result = total / (m - dropped) - lit.penalty;
  if (pts.textured && m > 1) {
    const { st, sr, stt, srr, str } = lit;
    const vt = stt / m - (st / m) ** 2, vr = srr / m - (sr / m) ** 2, cov = str / m - (st / m) * (sr / m);
    const ncc = vt > 1 && vr > 1 ? cov / Math.sqrt(vt * vr) : 0;
    result -= STRUCTURE_PENALTY * (1 - Math.max(0, ncc));
  }
  return { score: result, visible: m };
}

/** One-pass approximation of {@link score} for scanning: the same light model and structure term, but the colour
 * term is 1 − RMS distance (closed form from sums, no clamping or trimming), which is never more lenient. */
function quickScore(work: Plane, pts: Points, px: number, py: number, blocked: Int32Array | null, structure = STRUCTURE_PENALTY): number {
  if (px < 0 || py < 0 || px + pts.w > work.width || py + pts.h > work.height) return -1;
  const n = pts.o.length, base = py * work.width + px;
  let m = 0, st = 0, sr = 0, stt = 0, srr = 0, str = 0;
  let tr = 0, tg = 0, tb = 0, rr = 0, rg = 0, rb = 0, ttr = 0, ttg = 0, ttb = 0, qr = 0, qg = 0, qb = 0, xr = 0, xg = 0, xb = 0;
  for (let i = 0; i < n; i++) {
    const k = base + pts.o[i]!;
    if (!work.valid[k] || (blocked !== null && blocked[k]! >= 0)) continue;
    const lt = pts.l[i]!, lr = work.l[k]!, ar = pts.r[i]!, ag = pts.g[i]!, ab = pts.b[i]!, br = work.r[k]!, bg = work.g[k]!, bb = work.b[k]!;
    st += lt; sr += lr; stt += lt * lt; srr += lr * lr; str += lt * lr;
    tr += ar; tg += ag; tb += ab; rr += br; rg += bg; rb += bb;
    ttr += ar * ar; ttg += ag * ag; ttb += ab * ab; qr += br * br; qg += bg * bg; qb += bb * bb; xr += ar * br; xg += ag * bg; xb += ab * bb;
    m++;
  }
  if (!m || m < MIN_VISIBLE * n) return -1;
  const mt = st / m, mr = sr / m, vt = stt / m - mt * mt;
  let gain: number, or = 0, og = 0, ob = 0, penalty: number;
  if (vt <= 25) { gain = st > m ? clamp(sr / st, MIN_GAIN, MAX_GAIN) : 1; penalty = GAIN_PENALTY * Math.abs(Math.log(gain)); }
  else {
    gain = clamp((str / m - mt * mr) / vt, MIN_GAIN, MAX_GAIN);
    or = clamp((rr - gain * tr) / m, MIN_OFFSET, MAX_OFFSET); og = clamp((rg - gain * tg) / m, MIN_OFFSET, MAX_OFFSET); ob = clamp((rb - gain * tb) / m, MIN_OFFSET, MAX_OFFSET);
    const mean = (or + og + ob) / 3;
    penalty = GAIN_PENALTY * Math.abs(Math.log(gain)) + OFFSET_PENALTY * Math.abs(mean) / 255 + chromaPenalty(or, og, ob, mean);
  }
  // Σ(g·t + o − r)² per channel.
  const sq = (t: number, tt: number, q: number, x: number, r: number, o: number) => gain * gain * tt + m * o * o + q + 2 * gain * o * t - 2 * gain * x - 2 * o * r;
  const rms = Math.sqrt(Math.max(0, sq(tr, ttr, qr, xr, rr, or) + sq(tg, ttg, qg, xg, rg, og) + sq(tb, ttb, qb, xb, rb, ob)) / m);
  let result = 1 - rms / COLOR_RANGE - penalty;
  if (pts.textured && m > 1) {
    const vr = srr / m - mr * mr, cov = str / m - mt * mr;
    result -= structure * (1 - Math.max(0, vt > 1 && vr > 1 ? cov / Math.sqrt(vt * vr) : 0));
  }
  return result;
}

/** Cheapest look, luminance only: 1 − RMS after the gain/offset fit, structure term, gain penalty. */
function gateScore(work: Plane, pts: Points, px: number, py: number, blocked: Int32Array | null): number {
  if (px < 0 || py < 0 || px + pts.w > work.width || py + pts.h > work.height) return -1;
  const n = pts.o.length, base = py * work.width + px;
  let m = 0, st = 0, sr = 0, stt = 0, srr = 0, str = 0;
  for (let i = 0; i < n; i++) {
    const k = base + pts.o[i]!;
    if (!work.valid[k] || (blocked !== null && blocked[k]! >= 0)) continue;
    const lt = pts.l[i]!, lr = work.l[k]!;
    st += lt; sr += lr; stt += lt * lt; srr += lr * lr; str += lt * lr; m++;
  }
  if (!m || m < MIN_VISIBLE * n) return -1;
  const mt = st / m, mr = sr / m, vt = stt / m - mt * mt, vr = srr / m - mr * mr, cov = str / m - mt * mr;
  const textured = vt > 25, gain = textured ? clamp(cov / vt, MIN_GAIN, MAX_GAIN) : st > m ? clamp(sr / st, MIN_GAIN, MAX_GAIN) : 1;
  const offset = textured ? clamp(mr - gain * mt, MIN_OFFSET, MAX_OFFSET) : 0;
  // Mean of (g·t + o − r)² over the visible points, from the sums.
  const mse = gain * gain * stt / m + offset * offset + srr / m + 2 * gain * offset * mt - 2 * gain * str / m - 2 * offset * mr;
  let result = 1 - Math.sqrt(3 * Math.max(0, mse)) / COLOR_RANGE - GAIN_PENALTY * Math.abs(Math.log(gain)) - OFFSET_PENALTY * Math.abs(offset) / 255;
  if (pts.textured && m > 1) result -= STRUCTURE_PENALTY * (1 - Math.max(0, vt > 1 && vr > 1 ? cov / Math.sqrt(vt * vr) : 0));
  return result;
}

/** Alpha inverted (transparent pixels become the scored ones). */
function invertAlpha(image: RgbaImage): RgbaImage {
  const data = new Uint8Array(image.data);
  for (let i = 3; i < data.length; i += 4) data[i] = 255 - data[i]!;
  return { width: image.width, height: image.height, data };
}
/** Flat-coloured art (a net, a rope) only counts when the picture under it differs from the picture in its holes:
 * otherwise plain ground of a similar colour would pass for it. */
function standsOut(work: Plane, p: Prepared, px: number, py: number): boolean {
  if (!p.holes) return true;
  const mean = (pts: Points) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < pts.o.length; i++) { const k = (py * work.width + px) + pts.o[i]!; if (!work.valid[k]) continue; r += work.r[k]!; g += work.g[k]!; b += work.b[k]!; n++; }
    return n ? [r / n, g / n, b / n] : null;
  };
  const art = mean(p.refine), behind = mean(p.holes);
  return !art || !behind || Math.hypot(art[0]! - behind[0]!, art[1]! - behind[1]!, art[2]! - behind[2]!) >= FLAT_CONTRAST;
}

interface Candidate { t: number; px: number; py: number; score: number; visible: number; dirty: boolean; dead: boolean }

export async function detectObjects(input: DetectInput): Promise<DetectOutput> {
  const { tileWidth, tileHeight, minScore } = input;
  const pause = async () => { const p = input.checkpoint?.(); if (p) await p; };
  // Coarse level ≈ 8 px per cell.
  const f = Math.max(1, Math.floor(Math.min(tileWidth, tileHeight) / 8));
  const work = plane(input.work), coarseWork = plane(soften(f > 1 ? shrink(input.work, f) : input.work));
  const prepared: Prepared[] = [];
  for (const t of input.templates) {
    if (t.image.width > work.width || t.image.height > work.height) continue;
    let threshold = 200, all = points(t.image, threshold, work.width);
    if (all.o.length < 12) { threshold = 64; all = points(t.image, threshold, work.width); }
    if (all.o.length < 4) continue;
    const small = soften(f > 1 ? shrink(t.image, f) : t.image);
    // Coarse pixels whose whole 3×3 neighbourhood is covered: softening the picture mixes the background into the
    // object's rim, so the rim is left out (thin art keeps it rather than having too few pixels).
    let coarse: Points | null = points(erode(small), 160, coarseWork.width, COARSE_POINTS);
    if (coarse.o.length < 6) coarse = points(small, 160, coarseWork.width, COARSE_POINTS);
    if (coarse.o.length < 6) coarse = points(small, 96, coarseWork.width, COARSE_POINTS);
    if (coarse.o.length < 6) coarse = null;
    const refine = points(t.image, threshold, work.width, REFINE_POINTS), probe = points(t.image, threshold, work.width, PROBE_POINTS), gate = points(t.image, threshold, work.width, GATE_POINTS);
    // Transparent pixels inside the box: flat-coloured art must stand out from what shows through them.
    const holes = all.textured ? null : points(invertAlpha(t.image), 192, work.width, 256);
    prepared.push({ id: t.id, family: t.family ?? t.id, cellsW: t.cellsW, cellsH: t.cellsH, width: t.image.width, height: t.image.height, holes: holes && holes.o.length >= 8 ? holes : null, all, refine, probe, gate, coarse, cw: small.width, ch: small.height });
  }
  const owner = new Int32Array(work.width * work.height).fill(-1);
  const coarseOwner = new Int32Array(coarseWork.width * coarseWork.height).fill(-1);
  const accepted: Candidate[] = [];
  let truncated = false;

  /** Every coarse position, local maxima kept, refined to the exact pixel. changed: picture areas newly owned
   * since the last scan (null: everything); elsewhere no score could have changed. */
  async function propose(changed: readonly { x: number; y: number; w: number; h: number }[] | null): Promise<Candidate[]> {
    const found: Candidate[] = [];
    const columns = Math.floor(work.width / f) + 1, rows = Math.floor(work.height / f) + 1;
    const suppressed = new Uint8Array(columns * rows);
    for (let t = 0; t < prepared.length; t++) {
      const p = prepared[t]!;
      const hits: { x: number; y: number; s: number }[] = [];
      // Coarse level, or (art too thin to survive blurring) full resolution at the coarse step.
      const lastX = Math.floor((work.width - p.width) / f), lastY = Math.floor((work.height - p.height) / f);
      let near: Uint8Array | null = null;
      if (changed) {
        near = new Uint8Array((lastX + 1) * (lastY + 1));
        for (const r of changed) for (let y = Math.max(0, Math.floor((r.y - p.height) / f)); y <= Math.min(lastY, Math.ceil((r.y + r.h) / f)); y++)
          near.fill(1, y * (lastX + 1) + Math.max(0, Math.floor((r.x - p.width) / f)), y * (lastX + 1) + Math.min(lastX, Math.ceil((r.x + r.w) / f)) + 1);
      }
      for (let y = 0; y <= lastY; y++) {
        await pause();
        for (let x = 0; x <= lastX; x++) {
          if (near && !near[y * (lastX + 1) + x]) continue;
          const s = p.coarse ? quickScore(coarseWork, p.coarse, x, y, coarseOwner, COARSE_STRUCTURE) : quickScore(work, p.refine, x * f, y * f, owner, COARSE_STRUCTURE);
          if (s >= minScore - COARSE_SLACK) hits.push({ x, y, s });
        }
      }
      hits.sort((a, b) => b.s - a.s || a.y - b.y || a.x - b.x);
      // Local maxima: a kept hit suppresses its neighbourhood (half the coarse template).
      suppressed.fill(0);
      const kept: { x: number; y: number }[] = [];
      const rx = Math.max(1, Math.floor(p.cw / 2)), ry = Math.max(1, Math.floor(p.ch / 2));
      for (const h of hits) {
        if (kept.length >= COARSE_PER_TEMPLATE) break;
        if (suppressed[h.y * columns + h.x]) continue;
        kept.push(h);
        for (let y = Math.max(0, h.y - ry + 1); y < Math.min(rows, h.y + ry); y++) suppressed.fill(1, y * columns + Math.max(0, h.x - rx + 1), y * columns + Math.min(columns, h.x + rx));
      }
      // Coarse maxima can sit a coarse step or two off (thin art, glow): probe ±2 steps with a few pixels, refine
      // around the best with more, score it with all.
      for (let i = 0; i < kept.length; i++) {
        if (!(i & 63)) await pause();
        const k = kept[i]!;
        let bx = 0, by = 0, bs = -Infinity;
        // Gate: the whole window with a handful of sharp pixels, luminance only (most maxima are ground).
        for (let dy = -2 * f; dy <= 2 * f; dy++) for (let dx = -2 * f; dx <= 2 * f; dx++) {
          const s = gateScore(work, p.gate, k.x * f + dx, k.y * f + dy, owner);
          if (s > bs) { bs = s; bx = k.x * f + dx; by = k.y * f + dy; }
        }
        if (bs < minScore - GATE_SLACK) continue;
        // Probe around the gate's best with more pixels, then refine around the probe's best with more still.
        for (const [pts, radius, slack] of [[p.probe, 2, 0.25], [p.refine, 1, 0.1]] as const) {
          const cx = bx, cy = by;
          bs = -Infinity;
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            const s = score(work, pts, cx + dx, cy + dy, owner).score;
            if (s > bs) { bs = s; bx = cx + dx; by = cy + dy; }
          }
          if (bs < minScore - slack) break;
        }
        if (bs < minScore - 0.1) continue;
        const exact = score(work, p.all, bx, by, owner);
        if (exact.score >= minScore && standsOut(work, p, bx, by)) found.push({ t, px: bx, py: by, score: exact.score, visible: exact.visible, dirty: false, dead: false });
      }
    }
    return found;
  }
  const overlaps = (a: Candidate, b: Candidate) => {
    const pa = prepared[a.t]!, pb = prepared[b.t]!;
    return a.px < b.px + pb.width && b.px < a.px + pa.width && a.py < b.py + pb.height && b.py < a.py + pa.height;
  };
  const overlapArea = (a: Candidate, b: Candidate) => {
    const pa = prepared[a.t]!, pb = prepared[b.t]!;
    return Math.max(0, Math.min(a.px + pa.width, b.px + pb.width) - Math.max(a.px, b.px)) * Math.max(0, Math.min(a.py + pa.height, b.py + pb.height) - Math.max(a.py, b.py));
  };
  /** The accepted object owns the visible picture pixels it explains. */
  function own(c: Candidate, index: number): void {
    const p = prepared[c.t]!, m = visibleLight(work, p.all, c.py * work.width + c.px, owner);
    const inliers: number[] = [];
    for (let j = 0; j < m; j++) if (litDistance(p.all, scratch.i[j]!, work, scratch.k[j]!) < INLIER_DISTANCE) inliers.push(scratch.k[j]!);
    for (const k of inliers) owner[k] = index;
    if (f === 1) { coarseOwner.set(owner); return; }
    // A coarse pixel is hidden once a quarter of its full-resolution pixels are owned.
    const x0 = Math.floor(c.px / f), y0 = Math.floor(c.py / f), x1 = Math.min(coarseWork.width, Math.ceil((c.px + p.width) / f)), y1 = Math.min(coarseWork.height, Math.ceil((c.py + p.height) / f));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      let n = 0;
      for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) if (owner[(y * f + yy) * work.width + x * f + xx]! >= 0) n++;
      if (n * 4 > f * f) coarseOwner[y * coarseWork.width + x] = index;
    }
  }

  let changed: { x: number; y: number; w: number; h: number }[] | null = null;
  for (let round = 0; round < ROUNDS && !truncated; round++) {
    const candidates = await propose(changed);
    changed = [];
    let added = 0;
    for (;;) {
      await pause();
      for (const c of candidates) if (c.dirty && !c.dead) {
        const s = score(work, prepared[c.t]!.all, c.px, c.py, owner);
        c.score = s.score; c.visible = s.visible; c.dirty = false;
        if (s.score < minScore) c.dead = true;
      }
      // Big and confident first; ties in reading order.
      let best: Candidate | undefined;
      for (const c of candidates) {
        if (c.dead) continue;
        const a = c.score * c.visible, b = best ? best.score * best.visible : -Infinity;
        if (a > b || (a === b && best && (c.py - best.py || c.px - best.px || c.t - best.t) < 0)) best = c;
      }
      if (!best) break;
      if (accepted.length >= input.maxMatches) { truncated = true; break; }
      best.dead = true;
      own(best, accepted.length);
      accepted.push(best);
      changed.push({ x: best.px, y: best.py, w: prepared[best.t]!.width, h: prepared[best.t]!.height });
      added++;
      // Another variant (mirror) of the same object over most of this one is the same find.
      const family = prepared[best.t]!.family, area = prepared[best.t]!.width * prepared[best.t]!.height;
      for (const c of candidates) if (!c.dead && prepared[c.t]!.family === family && overlapArea(c, best) * 2 > Math.min(area, prepared[c.t]!.width * prepared[c.t]!.height)) c.dead = true;
      for (const c of candidates) if (!c.dead && overlaps(c, best)) c.dirty = true;
    }
    if (!added) break;
  }
  const columns = Math.floor(work.width / tileWidth), rows = Math.floor(work.height / tileHeight);
  const matches = accepted.map(c => {
    const p = prepared[c.t]!;
    const x = clamp(Math.round(c.px / tileWidth), 0, Math.max(0, columns - p.cellsW)), y = clamp(Math.round(c.py / tileHeight), 0, Math.max(0, rows - p.cellsH));
    return { id: p.id, x, y, dx: c.px - x * tileWidth, dy: c.py - y * tileHeight, px: c.px, py: c.py, width: p.width, height: p.height, score: Math.round(c.score * 1000) / 1000 };
  });
  return { matches, truncated };
}
