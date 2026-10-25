/** render_compare helpers (pure, no DOM): where the picture lies on the map grid, per-cell perceptual error
 * and a simple local nearest-tile scorer for alternatives. Read-only; the agent applies any fix. */
import { autoTrim, referencePlacement, type Rect, type ReferenceAlignment, type ReferenceFit, type Tile } from "@smap/agent";
import type { RgbaImage } from "@smap/core";

/** The picture on the map grid. `placement` is in absolute map cells, so any region crops the same cells. */
export interface ReferenceFrame { sourceRect: Rect; placement: Rect; pxX: number; pxY: number }
interface MapGeometry { width: number; height: number; tileWidth: number; tileHeight: number }

export function referenceFrame(pixels: RgbaImage, map: MapGeometry, options: { alignment?: ReferenceAlignment | undefined; fit?: ReferenceFit | undefined; sourceRect?: Rect | undefined }): ReferenceFrame {
  const a = options.alignment;
  if (a) {
    const pxX = a.cellPx, pxY = a.cellPx * map.tileHeight / map.tileWidth;
    return { sourceRect: { x: 0, y: 0, width: pixels.width, height: pixels.height }, placement: { x: 0 - a.offsetX / pxX + 0, y: 0 - a.offsetY / pxY + 0, width: pixels.width / pxX, height: pixels.height / pxY }, pxX, pxY };
  }
  const sourceRect = options.sourceRect ?? autoTrim(pixels);
  const placement = referencePlacement(sourceRect, { x: 0, y: 0, width: map.width, height: map.height }, options.fit ?? "stretch", map.tileWidth / map.tileHeight);
  return { sourceRect, placement, pxX: sourceRect.width / placement.width, pxY: sourceRect.height / placement.height };
}
/** Placement relative to a region's top-left cell (for drawing a cropped view). */
export const regionPlacement = (frame: ReferenceFrame, region: Rect): Rect => ({ ...frame.placement, x: frame.placement.x - region.x, y: frame.placement.y - region.y });
/** Whether map cell (x, y) has its centre on the picture. */
export function cellCovered(frame: ReferenceFrame, x: number, y: number): boolean {
  const { placement: p } = frame;
  return x + 0.5 >= p.x && y + 0.5 >= p.y && x + 0.5 <= p.x + p.width && y + 0.5 <= p.y + p.height;
}
/** Reference pixels of map cell (x, y). */
export const cellSource = (frame: ReferenceFrame, x: number, y: number): Rect =>
  ({ x: frame.sourceRect.x + (x - frame.placement.x) * frame.pxX, y: frame.sourceRect.y + (y - frame.placement.y) * frame.pxY, width: frame.pxX, height: frame.pxY });

/** Reference pixels `rect` resampled to w×h: area average when shrinking (exact for integer scales), nearest when enlarging.
 * Pixels off the picture count as transparent. */
export function samplePatch(image: RgbaImage, rect: Rect, w: number, h: number): RgbaImage {
  const out = new Uint8Array(w * h * 4), kx = rect.width / w, ky = rect.height / h;
  for (let j = 0; j < h; j++) {
    const v0 = rect.y + j * ky, y0 = ky >= 1 ? Math.floor(v0 + 1e-6) : Math.floor(v0 + ky / 2), y1 = ky >= 1 ? Math.max(y0 + 1, Math.floor(v0 + ky + 1e-6)) : y0 + 1;
    for (let i = 0; i < w; i++) {
      const u0 = rect.x + i * kx, x0 = kx >= 1 ? Math.floor(u0 + 1e-6) : Math.floor(u0 + kx / 2), x1 = kx >= 1 ? Math.max(x0 + 1, Math.floor(u0 + kx + 1e-6)) : x0 + 1;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        n++;
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        const p = (y * image.width + x) * 4, al = image.data[p + 3]!;
        r += image.data[p]! * al; g += image.data[p + 1]! * al; b += image.data[p + 2]! * al; a += al;
      }
      const q = (j * w + i) * 4;
      if (a) { out[q] = Math.round(r / a); out[q + 1] = Math.round(g / a); out[q + 2] = Math.round(b / a); }
      out[q + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, data: out };
}

const LINEAR = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
/** CIE Lab (D65) per pixel, colours composited over black so transparency counts. */
export function toLab(data: ArrayLike<number>, pixels: number): Float32Array {
  const out = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const a = data[i * 4 + 3]! / 255, r = LINEAR[data[i * 4]!]! * a, g = LINEAR[data[i * 4 + 1]!]! * a, b = LINEAR[data[i * 4 + 2]!]! * a;
    const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b), fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    out[i * 3] = 116 * fy - 16; out[i * 3 + 1] = 500 * (fx - fy); out[i * 3 + 2] = 200 * (fy - fz);
  }
  return out;
}
/** Mean ΔE76 between two Lab images of equal size. */
export function meanDeltaE(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = a.length / 3;
  for (let i = 0; i < a.length; i += 3) sum += Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!);
  return n ? sum / n : 0;
}
/** `top` alpha-composited over `bottom` (same size). */
export function over(bottom: ArrayLike<number>, top: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(bottom.length);
  for (let p = 0; p < out.length; p += 4) {
    const sa = top[p + 3]! / 255, da = bottom[p + 3]! / 255, oa = sa + da * (1 - sa);
    if (oa) for (let c = 0; c < 3; c++) out[p + c] = Math.round((top[p + c]! * sa + bottom[p + c]! * da * (1 - sa)) / oa);
    out[p + 3] = Math.round(oa * 255);
  }
  return out;
}

export interface CompareCandidate { tile: Tile; rgba: Uint8Array; opaque: boolean; lab?: Float32Array }
export function candidate(tile: Tile, rgba: Uint8Array): CompareCandidate | null {
  let visible = false, opaque = true;
  for (let i = 3; i < rgba.length; i += 4) { if (rgba[i]) visible = true; if (rgba[i]! < 250) opaque = false; }
  return visible ? { tile, rgba, opaque } : null;
}
const round1 = (v: number) => Math.round(v * 10) / 10;
const key = (t: Tile) => `${t.tilesetId}\u0000${t.tileId}`;
/** Local nearest-tile scorer: best opaque grounds, then transparent overlays over the best and the current ground.
 * Only options clearly better than `currentErr` are returned. */
export function rankAlternatives(patchLab: Float32Array, candidates: readonly CompareCandidate[], currentErr: number, currentGround: CompareCandidate | undefined, limit = 3): { tile: Tile; overlay?: Tile; err: number }[] {
  const pixels = patchLab.length / 3;
  const labOf = (c: CompareCandidate) => c.lab ??= toLab(c.rgba, pixels);
  const grounds = candidates.filter(c => c.opaque).map(c => ({ c, err: meanDeltaE(labOf(c), patchLab) })).sort((a, b) => a.err - b.err);
  const options: { tile: Tile; overlay?: Tile; err: number }[] = grounds.slice(0, limit).map(g => ({ tile: g.c.tile, err: g.err }));
  const bases = [grounds[0]?.c, currentGround].filter((c, i, all): c is CompareCandidate => !!c && all.findIndex(o => o && key(o.tile) === key(c.tile)) === i);
  for (const base of bases) for (const c of candidates) {
    if (c.opaque) continue;
    options.push({ tile: base.tile, overlay: c.tile, err: meanDeltaE(toLab(over(base.rgba, c.rgba), pixels), patchLab) });
  }
  options.sort((a, b) => a.err - b.err);
  const seen = new Set<string>(), out: { tile: Tile; overlay?: Tile; err: number }[] = [];
  for (const o of options) {
    if (o.err >= currentErr - 0.5 || out.length >= limit) break;
    const k = key(o.tile) + (o.overlay ? "|" + key(o.overlay) : "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ tile: o.tile, ...(o.overlay ? { overlay: o.overlay } : {}), err: round1(o.err) });
  }
  return out;
}
/** Heatmap colour: green below ΔE 5, yellow around 10, red from 20. */
export function heatColor(err: number): [number, number, number, number] {
  const stops: [number, [number, number, number]][] = [[0, [46, 160, 103]], [5, [120, 190, 90]], [10, [230, 196, 76]], [20, [226, 84, 84]]];
  if (err >= 20) return [226, 84, 84, 255];
  for (let i = 1; i < stops.length; i++) if (err <= stops[i]![0]) {
    const [e0, c0] = stops[i - 1]!, [e1, c1] = stops[i]!, t = (err - e0) / (e1 - e0);
    return [Math.round(c0[0] + (c1[0] - c0[0]) * t), Math.round(c0[1] + (c1[1] - c0[1]) * t), Math.round(c0[2] + (c1[2] - c0[2]) * t), 255];
  }
  return [226, 84, 84, 255];
}
