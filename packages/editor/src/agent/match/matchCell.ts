/** K3: one reference cell → best opaque ground and optional transparent overlay.
 * Error = mean Lab ΔE over visible patch pixels + an L-gradient (edge) term. Pure and deterministic. */
import type { RgbaImage } from "@smap/core";
import { gradients, labOf } from "./color";
import { coarseGrid, resample, type IndexedTile, type Resampled, type TileIndex, type TileRef } from "./tileIndex";

/** Per-channel affine light: reference ≈ tile × gain + offset. */
export interface Light { gain: [number, number, number]; offset: [number, number, number] }
export interface MatchOptions {
  /** Fit a per-channel gain for every candidate (lit/shaded pictures). */
  normalizeLight?: boolean;
  /** Best opaque ground first, then a transparent overlay composited over it. */
  layered?: boolean;
  /** Alternatives returned (default 4). */
  topK?: number;
  /** A known light (e.g. smoothed from neighbours): the patch is corrected before matching. */
  light?: Light;
  /** Extra ground tile indices tried under overlays (e.g. neighbours' grounds). */
  groundHints?: readonly number[];
}
export interface CellMatch {
  ground: { ref: TileRef; err: number } | null;
  overlay?: { ref: TileRef; err: number };
  err: number;
  confidence: number;
  alternatives: { ground: TileRef; overlay?: TileRef; err: number }[];
  /** Index into TileIndex.tiles (-1 = none). */
  groundIndex: number; overlayIndex: number;
  /** Gain fitted for the chosen ground (normalizeLight). */
  gain?: [number, number, number];
  /** Fraction of the patch inside the picture. */
  coverage: number;
}

const EDGE_WEIGHT = 0.5;
const LIGHT_PENALTY = 6;
const GAIN_MIN = 0.5, GAIN_MAX = 2;
/** Overlay must lower the error to this fraction of plain ground and by an absolute ΔE. */
const OVERLAY_RATIO = 0.85, OVERLAY_GAIN = 0.75;
const NO_GAIN: [number, number, number] = [1, 1, 1];

interface Prepared { r: Resampled; w: Float32Array; wsum: number; coarse: Float32Array; coarseW: Float32Array; coverage: number }
interface Scored { g: number; o: number; err: number; groundErr: number; gain: [number, number, number] }

/** Patch (any size) → working resolution, with an optional light correction. */
export function preparePatch(patch: Resampled, index: TileIndex, light?: Light): Prepared {
  const n = index.size * index.size;
  let rgb = patch.rgb;
  if (light) {
    rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.max(0, Math.min(255, (patch.rgb[i * 3 + c]! - light.offset[c]!) / light.gain[c]!));
  }
  const r: Resampled = { size: patch.size, rgb, alpha: patch.alpha };
  let wsum = 0;
  for (let i = 0; i < n; i++) wsum += patch.alpha[i]!;
  const [coarse, coarseW] = coarseGrid(r, index.coarse);
  // Straight colour per coarse block (weights kept separately).
  for (let k = 0; k < coarseW.length; k++) if (coarseW[k]! > 0) for (let c = 0; c < 3; c++) coarse[k * 3 + c]! /= coarseW[k]!;
  return { r, w: patch.alpha, wsum, coarse, coarseW, coverage: wsum / n };
}

/** Mean ΔE + edge term of a patch (Lab + gradients) against a reference image of the same grid. */
function fineError(plab: Float32Array, pgx: Float32Array, pgy: Float32Array, w: Float32Array, wsum: number, tlab: Float32Array, tgx: Float32Array, tgy: Float32Array): number {
  let de = 0, edge = 0;
  for (let i = 0; i < w.length; i++) {
    const wi = w[i]!;
    if (!wi) continue;
    const dl = plab[i * 3]! - tlab[i * 3]!, da = plab[i * 3 + 1]! - tlab[i * 3 + 1]!, db = plab[i * 3 + 2]! - tlab[i * 3 + 2]!;
    de += wi * Math.sqrt(dl * dl + da * da + db * db);
    edge += wi * (Math.abs(pgx[i]! - tgx[i]!) + Math.abs(pgy[i]! - tgy[i]!));
  }
  return (de + EDGE_WEIGHT * edge / 2) / wsum;
}

class PatchViews {
  readonly #cache = new Map<string, [Float32Array, Float32Array, Float32Array]>();
  constructor(readonly p: Prepared, readonly size: number) {}
  /** Lab + gradients of the patch divided by a gain (cached per gain). */
  get(gain: readonly number[]): [Float32Array, Float32Array, Float32Array] {
    const key = gain.map(v => v.toFixed(3)).join();
    let v = this.#cache.get(key);
    if (!v) {
      const n = this.size * this.size, src = this.p.r.rgb;
      let rgb = src;
      if (gain[0] !== 1 || gain[1] !== 1 || gain[2] !== 1) {
        rgb = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.min(255, src[i * 3 + c]! / gain[c]!);
      }
      const lab = labOf(rgb, n), [gx, gy] = gradients(lab, this.size);
      v = [lab, gx, gy];
      this.#cache.set(key, v);
    }
    return v;
  }
}

const lightPenalty = (gain: readonly number[]) => LIGHT_PENALTY * (Math.abs(Math.log(gain[0]!)) + Math.abs(Math.log(gain[1]!)) + Math.abs(Math.log(gain[2]!))) / 3;

/** Coarse ranking distance of the patch against an opaque tile (optionally with a fitted gain). */
function coarseGround(p: Prepared, t: IndexedTile, normalize: boolean, gainOut: number[]): number {
  const k = p.coarseW.length;
  let e = 0;
  for (let c = 0; c < 3; c++) {
    let g = 1;
    if (normalize) {
      let pt = 0;
      for (let i = 0; i < k; i++) pt += p.coarse[i * 3 + c]! * t.coarse[i * 3 + c]! * p.coarseW[i]!;
      let tt = 0;
      for (let i = 0; i < k; i++) tt += t.coarse[i * 3 + c]! ** 2 * p.coarseW[i]!;
      g = tt > 1e-6 ? Math.max(GAIN_MIN, Math.min(GAIN_MAX, pt / tt)) : 1;
    }
    gainOut[c] = g;
    for (let i = 0; i < k; i++) { const d = p.coarse[i * 3 + c]! / g - t.coarse[i * 3 + c]!; e += d * d * p.coarseW[i]!; }
  }
  return e;
}

/** Fine composite error of overlay o over ground g against the (gain-corrected) patch. */
function compositeError(view: [Float32Array, Float32Array, Float32Array], p: Prepared, ground: IndexedTile, overlay: IndexedTile, size: number, scratch: Float32Array): number {
  const n = size * size;
  for (let i = 0; i < n; i++) {
    const a = overlay.alpha[i]!, keep = 1 - a;
    for (let c = 0; c < 3; c++) scratch[i * 3 + c] = overlay.rgb[i * 3 + c]! * a + ground.rgb[i * 3 + c]! * keep;
  }
  const lab = labOf(scratch, n), [gx, gy] = gradients(lab, size);
  return fineError(view[0], view[1], view[2], p.w, p.wsum, lab, gx, gy);
}

/** Resampled patch → match (the quantizer reuses prepared patches across passes). */
export function matchResampled(patch: Resampled, index: TileIndex, opts: MatchOptions = {}): CellMatch {
  const topK = opts.topK ?? 4, size = index.size;
  const p = preparePatch(patch, index, opts.light);
  const empty: CellMatch = { ground: null, err: Infinity, confidence: 0, alternatives: [], groundIndex: -1, overlayIndex: -1, coverage: p.coverage };
  if (p.coverage < 0.05 || !index.ground.length) return empty;
  const normalize = !!opts.normalizeLight;
  // 1. Coarse ranking of every opaque tile.
  const keep = Math.max(16, topK * 2), coarse: { g: number; e: number; gain: [number, number, number] }[] = [];
  const gain = [1, 1, 1];
  for (const g of index.ground) {
    let e = coarseGround(p, index.tiles[g]!, normalize, gain);
    if (normalize) e *= 1 + 0.25 * lightPenalty(gain);
    if (coarse.length < keep || e < coarse[coarse.length - 1]!.e) {
      coarse.push({ g, e, gain: [gain[0]!, gain[1]!, gain[2]!] });
      coarse.sort((a, b) => a.e - b.e || a.g - b.g);
      if (coarse.length > keep) coarse.pop();
    }
  }
  // Hinted grounds are always evaluated finely (overlay search uses them).
  for (const g of opts.groundHints ?? []) if (index.tiles[g]?.opaque && !coarse.some(c => c.g === g)) {
    coarseGround(p, index.tiles[g]!, normalize, gain);
    coarse.push({ g, e: Infinity, gain: [gain[0]!, gain[1]!, gain[2]!] });
  }
  // 2. Fine ΔE of the shortlist.
  const views = new PatchViews(p, size), results: Scored[] = [];
  for (const c of coarse) {
    const t = index.tiles[c.g]!, g = normalize ? c.gain : NO_GAIN, view = views.get(g);
    const err = fineError(view[0], view[1], view[2], p.w, p.wsum, t.lab, t.gx, t.gy) + (normalize ? lightPenalty(g) : 0);
    results.push({ g: c.g, o: -1, err, groundErr: err, gain: g });
  }
  results.sort((a, b) => a.err - b.err || a.g - b.g);
  const bestGround = results[0]!;
  // 3. Layered: transparent overlays over the best few grounds (and hints) …
  if (opts.layered && index.overlay.length) {
    const scoredGround = (g: number): Scored => {
      let r = results.find(x => x.g === g && x.o < 0);
      if (!r) {
        const t = index.tiles[g]!, gn = normalize ? bestGround.gain : NO_GAIN, view = views.get(gn);
        const err = fineError(view[0], view[1], view[2], p.w, p.wsum, t.lab, t.gx, t.gy) + (normalize ? lightPenalty(gn) : 0);
        r = { g, o: -1, err, groundErr: err, gain: gn };
        results.push(r);
      }
      return r;
    };
    const k = p.coarseW.length, maxPairs = 12;
    const composite = (gt: IndexedTile, ot: IndexedTile, gain: readonly number[], limit: number) => {
      let e = 0;
      for (let i = 0; i < k; i++) {
        const keepA = 1 - ot.coarseAlpha[i]!, w = p.coarseW[i]!;
        for (let c = 0; c < 3; c++) { const d = p.coarse[i * 3 + c]! / gain[c]! - (ot.coarse[i * 3 + c]! + gt.coarse[i * 3 + c]! * keepA); e += d * d * w; }
        if (e > limit) return Infinity;
      }
      return e;
    };
    const grounds = results.slice(0, 4);
    for (const h of opts.groundHints ?? []) { const r = results.find(x => x.g === h); if (r && !grounds.includes(r)) grounds.push(r); }
    const pairs: { g: Scored; o: number; e: number }[] = [];
    const offer = (g: Scored, o: number, e: number) => {
      if (pairs.some(q => q.g.g === g.g && q.o === o)) return;
      pairs.push({ g, o, e }); pairs.sort((a, b) => a.e - b.e || a.o - b.o || a.g.g - b.g.g);
    };
    for (const gr of grounds) {
      const gt = index.tiles[gr.g]!;
      for (const o of index.overlay) {
        const e = composite(gt, index.tiles[o]!, gr.gain, pairs.length >= maxPairs ? pairs[maxPairs - 1]!.e : Infinity);
        if (e < Infinity) { offer(gr, o, e); if (pairs.length > maxPairs) pairs.pop(); }
      }
    }
    // … and, for the most likely overlays, the grounds that fit under them best (heavily covered cells).
    const overlays = [...new Set(pairs.map(q => q.o))].slice(0, 3), gain0 = normalize ? bestGround.gain : NO_GAIN;
    for (const o of overlays) {
      const ot = index.tiles[o]!, under: { g: number; e: number }[] = [];
      for (const g of index.ground) {
        const e = composite(index.tiles[g]!, ot, gain0, under.length >= 3 ? under[2]!.e : Infinity);
        if (e < Infinity) { under.push({ g, e }); under.sort((a, b) => a.e - b.e || a.g - b.g); if (under.length > 3) under.pop(); }
      }
      for (const u of under) offer(scoredGround(u.g), o, u.e);
    }
    const scratch = new Float32Array(size * size * 3);
    for (const pair of pairs.slice(0, maxPairs + 9)) {
      const err = compositeError(views.get(pair.g.gain), p, index.tiles[pair.g.g]!, index.tiles[pair.o]!, size, scratch) + (normalize ? lightPenalty(pair.g.gain) : 0);
      results.push({ g: pair.g.g, o: pair.o, err, groundErr: pair.g.err, gain: pair.g.gain });
    }
  }
  // Overlays must clearly beat plain ground.
  const accepted = results.filter(r => r.o < 0 || (r.err < bestGround.err * OVERLAY_RATIO && bestGround.err - r.err > OVERLAY_GAIN));
  accepted.sort((a, b) => a.err - b.err || a.g - b.g || a.o - b.o);
  const best = accepted[0]!;
  const second = accepted.find(r => r.g !== best.g || r.o !== best.o);
  const fit = Math.max(0, Math.min(1, 1 - best.err / 25));
  const margin = second ? Math.min(1, 2 * (second.err - best.err) / Math.max(1, best.err)) : 1;
  const seen = new Set<string>(), alternatives: CellMatch["alternatives"] = [];
  for (const r of accepted) {
    const key = `${r.g}:${r.o}`;
    if (seen.has(key)) continue;
    seen.add(key);
    alternatives.push({ ground: index.tiles[r.g]!.ref, ...(r.o >= 0 ? { overlay: index.tiles[r.o]!.ref } : {}), err: round(r.err) });
    if (alternatives.length >= topK) break;
  }
  return {
    ground: { ref: index.tiles[best.g]!.ref, err: round(best.groundErr) },
    ...(best.o >= 0 ? { overlay: { ref: index.tiles[best.o]!.ref, err: round(best.err) } } : {}),
    err: round(best.err), confidence: round(fit * (0.4 + 0.6 * margin)), alternatives,
    groundIndex: best.g, overlayIndex: best.o, ...(normalize ? { gain: best.gain } : {}), coverage: p.coverage,
  };
}
const round = (v: number) => Math.round(v * 1000) / 1000;

/** K3: patch (RGBA at any size, usually the map tile size) → best ground / overlay. */
export function matchCell(patch: RgbaImage, index: TileIndex, opts: MatchOptions = {}): CellMatch {
  return matchResampled(resample(patch.data, patch.width, patch.height, index.size), index, opts);
}

/** Per-channel affine light of a raw patch against a tile (overlay composited when given). */
export function estimateLight(patch: Resampled, ground: IndexedTile, overlay?: IndexedTile): Light {
  const n = patch.size * patch.size, gain: [number, number, number] = [1, 1, 1], offset: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let sw = 0, st = 0, sp = 0, stt = 0, stp = 0;
    for (let i = 0; i < n; i++) {
      const w = patch.alpha[i]!;
      if (!w) continue;
      const a = overlay ? overlay.alpha[i]! : 0, t = overlay ? overlay.rgb[i * 3 + c]! * a + ground.rgb[i * 3 + c]! * (1 - a) : ground.rgb[i * 3 + c]!;
      const v = patch.rgb[i * 3 + c]!;
      sw += w; st += w * t; sp += w * v; stt += w * t * t; stp += w * t * v;
    }
    if (!sw) continue;
    const mt = st / sw, mp = sp / sw, vt = stt / sw - mt * mt;
    // Textured channel: affine fit; flat channel: gain only.
    if (vt > 100) {
      const g = Math.max(0.4, Math.min(2.5, (stp / sw - mt * mp) / vt));
      gain[c] = g; offset[c] = Math.max(-96, Math.min(96, mp - g * mt));
    } else gain[c] = mt > 4 ? Math.max(0.4, Math.min(2.5, mp / mt)) : 1;
  }
  return { gain, offset };
}
