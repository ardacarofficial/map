/** Candidate tiles prepared once for cell matching: resampled colour, alpha, Lab, L gradients and a coarse
 * colour grid for fast ranking. Pure TypeScript (no DOM); deterministic. */
import { gradients, labOf } from "./color";

export interface TileRef { tilesetId: string; tileId: number }
export interface TileSource { ref: TileRef; rgba: ArrayLike<number>; w: number; h: number }
export interface IndexedTile {
  ref: TileRef;
  /** Every pixel has alpha ≥ 250: usable as ground. */
  opaque: boolean;
  /** size×size straight sRGB (0–255) and alpha (0–1). */
  rgb: Float32Array; alpha: Float32Array;
  /** Lab and L gradients of rgb (meaningful for opaque tiles). */
  lab: Float32Array; gx: Float32Array; gy: Float32Array;
  /** coarse×coarse premultiplied sRGB means, their alpha, and Σ coarse² per channel. */
  coarse: Float32Array; coarseAlpha: Float32Array; coarseSq: Float64Array;
  /** Standard deviation of L (0 = flat colour). */
  texture: number;
}
export interface TileIndex {
  /** Working resolution per side; patches are resampled to it. */
  size: number; coarse: number;
  tiles: IndexedTile[];
  /** Indices of opaque tiles and of visible transparent (overlay) tiles. */
  ground: number[]; overlay: number[];
}
export interface Resampled { size: number; rgb: Float32Array; alpha: Float32Array }

/** Box-filter weights mapping n source samples onto m output samples (fractional coverage). */
function weights(n: number, m: number): { from: number; to: number; w: number[] }[] {
  const out: { from: number; to: number; w: number[] }[] = [], step = n / m;
  for (let i = 0; i < m; i++) {
    const a = i * step, b = (i + 1) * step, from = Math.floor(a), to = Math.min(n, Math.ceil(b)), w: number[] = [];
    for (let s = from; s < to; s++) w.push(Math.max(0, Math.min(b, s + 1) - Math.max(a, s)));
    out.push({ from, to, w });
  }
  return out;
}
const weightCache = new Map<string, ReturnType<typeof weights>>();
function cachedWeights(n: number, m: number) {
  const key = `${n}:${m}`;
  let w = weightCache.get(key);
  if (!w) { w = weights(n, m); if (weightCache.size > 64) weightCache.clear(); weightCache.set(key, w); }
  return w;
}

/** RGBA (w×h, straight alpha) → size×size straight sRGB + alpha, premultiplied box filter. */
export function resample(rgba: ArrayLike<number>, w: number, h: number, size: number): Resampled {
  const rgb = new Float32Array(size * size * 3), alpha = new Float32Array(size * size);
  const wx = cachedWeights(w, size), wy = cachedWeights(h, size);
  for (let j = 0; j < size; j++) {
    const ry = wy[j]!;
    for (let i = 0; i < size; i++) {
      const rx = wx[i]!;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = ry.from; y < ry.to; y++) {
        const fy = ry.w[y - ry.from]!;
        for (let x = rx.from; x < rx.to; x++) {
          const k = fy * rx.w[x - rx.from]!, p = (y * w + x) * 4, al = rgba[p + 3]! / 255 * k;
          r += rgba[p]! * al; g += rgba[p + 1]! * al; b += rgba[p + 2]! * al; a += al; n += k;
        }
      }
      const o = j * size + i;
      alpha[o] = n ? a / n : 0;
      if (a > 0) { rgb[o * 3] = r / a; rgb[o * 3 + 1] = g / a; rgb[o * 3 + 2] = b / a; }
    }
  }
  return { size, rgb, alpha };
}

/** Premultiplied coarse grid of a resampled image. */
export function coarseGrid(r: Resampled, coarse: number, out = new Float32Array(coarse * coarse * 3), outAlpha = new Float32Array(coarse * coarse)): [Float32Array, Float32Array] {
  out.fill(0); outAlpha.fill(0);
  const s = r.size, cell = s / coarse;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const k = Math.min(coarse - 1, Math.floor(y / cell)) * coarse + Math.min(coarse - 1, Math.floor(x / cell)), i = y * s + x, a = r.alpha[i]!;
    out[k * 3]! += r.rgb[i * 3]! * a; out[k * 3 + 1]! += r.rgb[i * 3 + 1]! * a; out[k * 3 + 2]! += r.rgb[i * 3 + 2]! * a; outAlpha[k]! += a;
  }
  const n = (s / coarse) ** 2;
  for (let k = 0; k < coarse * coarse; k++) { out[k * 3]! /= n; out[k * 3 + 1]! /= n; out[k * 3 + 2]! /= n; outAlpha[k]! /= n; }
  return [out, outAlpha];
}

/** K3: build the candidate index. Fully transparent tiles are skipped. */
export function buildTileIndex(tiles: readonly TileSource[], options: { size?: number } = {}): TileIndex {
  const size = options.size ?? 16, coarse = Math.min(4, size);
  const index: TileIndex = { size, coarse, tiles: [], ground: [], overlay: [] };
  for (const t of tiles) {
    let opaque = true, visible = false;
    for (let i = 3; i < t.w * t.h * 4; i += 4) { const a = t.rgba[i]!; if (a < 250) opaque = false; if (a > 8) visible = true; }
    if (!visible) continue;
    const r = resample(t.rgba, t.w, t.h, size);
    const lab = labOf(r.rgb, size * size), [gx, gy] = gradients(lab, size);
    const [c, ca] = coarseGrid(r, coarse);
    const sq = new Float64Array(3);
    for (let k = 0; k < coarse * coarse; k++) for (let ch = 0; ch < 3; ch++) sq[ch]! += c[k * 3 + ch]! ** 2;
    let m = 0, m2 = 0;
    for (let i = 0; i < size * size; i++) { m += lab[i * 3]!; m2 += lab[i * 3]! ** 2; }
    m /= size * size;
    const entry: IndexedTile = { ref: { tilesetId: t.ref.tilesetId, tileId: t.ref.tileId }, opaque, rgb: r.rgb, alpha: r.alpha, lab, gx, gy, coarse: c, coarseAlpha: ca, coarseSq: sq, texture: Math.sqrt(Math.max(0, m2 / (size * size) - m * m)) };
    (opaque ? index.ground : index.overlay).push(index.tiles.length);
    index.tiles.push(entry);
  }
  return index;
}
