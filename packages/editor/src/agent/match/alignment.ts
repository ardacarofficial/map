/** K1: reference picture ↔ map cell grid. Detection finds the pixel scale (nearest-upscaled blocks) and the
 * tile phase (which offset makes cells match real tiles best), with fitted candidates for downscaled pictures.
 * Pure and deterministic (no DOM). */
import { autoTrim, type Rect, type ReferenceAlignHint, type ReferenceAlignment } from "@smap/agent";
import type { RgbaImage } from "@smap/core";
import { matchResampled } from "./matchCell";
import type { Resampled, TileIndex } from "./tileIndex";

export const cellHeightPx = (a: ReferenceAlignment, tileWidth: number, tileHeight: number): number => a.cellPxY ?? a.cellPx * tileHeight / tileWidth;

/** Box-sample a fractional rectangle of the picture onto outW×outH (pixels outside the picture or clip get alpha 0). */
export function boxSample(ref: RgbaImage, x0: number, y0: number, w: number, h: number, outW: number, outH: number, clip?: Rect): Resampled & { width: number; height: number } {
  const rgb = new Float32Array(outW * outH * 3), alpha = new Float32Array(outW * outH);
  const cx0 = Math.max(0, clip?.x ?? 0), cy0 = Math.max(0, clip?.y ?? 0);
  const cx1 = Math.min(ref.width, clip ? clip.x + clip.width : ref.width), cy1 = Math.min(ref.height, clip ? clip.y + clip.height : ref.height);
  const sx = w / outW, sy = h / outH;
  const axis = (start: number, step: number, n: number, lo: number, hi: number) => {
    const out: { from: number; w: number[]; area: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = start + i * step, b = a + step, from = Math.max(lo, Math.floor(a)), to = Math.min(hi, Math.ceil(b)), ws: number[] = [];
      for (let p = from; p < to; p++) ws.push(Math.max(0, Math.min(b, p + 1) - Math.max(a, p)));
      out.push({ from, w: ws, area: step });
    }
    return out;
  };
  const ax = axis(x0, sx, outW, cx0, cx1), ay = axis(y0, sy, outH, cy0, cy1), d = ref.data;
  for (let j = 0; j < outH; j++) {
    const ry = ay[j]!;
    for (let i = 0; i < outW; i++) {
      const rx = ax[i]!;
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = 0; yy < ry.w.length; yy++) {
        const fy = ry.w[yy]!, row = (ry.from + yy) * ref.width;
        for (let xx = 0; xx < rx.w.length; xx++) {
          const p = (row + rx.from + xx) * 4, k = fy * rx.w[xx]! * d[p + 3]! / 255;
          r += d[p]! * k; g += d[p + 1]! * k; b += d[p + 2]! * k; a += k;
        }
      }
      const o = j * outW + i;
      alpha[o] = Math.min(1, a / (rx.area * ry.area));
      if (a > 0) { rgb[o * 3] = r / a; rgb[o * 3 + 1] = g / a; rgb[o * 3 + 2] = b / a; }
    }
  }
  return { size: outW, width: outW, height: outH, rgb, alpha };
}

/** K1 helper: the picture area of map cell (x, y), resampled to the map tile size (default cellPx / scale).
 * Integer scales sample exactly each source pixel's footprint (nearest; a box mean only removes noise). */
export function samplePatch(ref: RgbaImage, a: ReferenceAlignment, x: number, y: number, tile?: { width: number; height: number }, clip?: Rect): RgbaImage {
  const tw = tile?.width ?? Math.max(1, Math.round(a.cellPx / a.scale)), th = tile?.height ?? tw;
  const ch = a.cellPxY ?? a.cellPx * th / tw;
  const s = boxSample(ref, a.offsetX + x * a.cellPx, a.offsetY + y * ch, a.cellPx, ch, tw, th, clip);
  const data = new Uint8Array(tw * th * 4);
  for (let i = 0; i < tw * th; i++) {
    data[i * 4] = Math.round(s.rgb[i * 3]!); data[i * 4 + 1] = Math.round(s.rgb[i * 3 + 1]!); data[i * 4 + 2] = Math.round(s.rgb[i * 3 + 2]!);
    data[i * 4 + 3] = Math.round(s.alpha[i]! * 255);
  }
  return { width: tw, height: th, data };
}

/** Same footprint straight to the matcher's working resolution (no 8-bit round trip). */
export function sampleCell(ref: RgbaImage, a: ReferenceAlignment, x: number, y: number, tileWidth: number, tileHeight: number, size: number, clip?: Rect): Resampled {
  const ch = cellHeightPx(a, tileWidth, tileHeight);
  return boxSample(ref, a.offsetX + x * a.cellPx, a.offsetY + y * ch, a.cellPx, ch, size, size, clip);
}

/** A cell is covered when its centre lies inside the picture content. */
export function cellCovered(a: ReferenceAlignment, x: number, y: number, tileWidth: number, tileHeight: number, content: Rect): boolean {
  if (x < 0 || y < 0 || x >= a.cols || y >= a.rows) return false;
  const ch = cellHeightPx(a, tileWidth, tileHeight), cx = a.offsetX + (x + 0.5) * a.cellPx, cy = a.offsetY + (y + 0.5) * ch;
  return cx >= content.x && cy >= content.y && cx < content.x + content.width && cy < content.y + content.height;
}

/** Picture content: autoTrim plus uniform dark gutters on any single side (editor chrome at right/bottom). */
export function pictureContent(ref: RgbaImage): Rect {
  const r = autoTrim(ref), d = ref.data;
  let { x: left, y: top } = r, right = r.x + r.width, bottom = r.y + r.height;
  const uniformDark = (horizontal: boolean, index: number, from: number, to: number) => {
    const at = (i: number) => (horizontal ? index * ref.width + i : i * ref.width + index) * 4;
    const mid = at(Math.floor((from + to) / 2)), base = [d[mid]!, d[mid + 1]!, d[mid + 2]!];
    if (Math.max(...base) >= 72 || Math.max(...base) - Math.min(...base) >= 28) return false;
    let same = 0;
    for (let i = from; i < to; i++) { const p = at(i); if (Math.abs(d[p]! - base[0]!) + Math.abs(d[p + 1]! - base[1]!) + Math.abs(d[p + 2]! - base[2]!) <= 12) same++; }
    return same >= (to - from) * 0.95;
  };
  const maxX = ref.width * 0.25, maxY = ref.height * 0.25;
  while (right - left > 8 && ref.width - right < maxX && uniformDark(false, right - 1, top, bottom)) right--;
  while (bottom - top > 8 && ref.height - bottom < maxY && uniformDark(true, bottom - 1, left, right)) bottom--;
  while (right - left > 8 && left < maxX && uniformDark(false, left, top, bottom)) left++;
  while (bottom - top > 8 && top < maxY && uniformDark(true, top, left, right)) top++;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Nearest-upscale detection along one axis: block size s and the residue where blocks start. */
export function blockScale(ref: RgbaImage, content: Rect, horizontal: boolean): { s: number; phase: number; ratio: number; phases: number[] } {
  const along = horizontal ? content.width : content.height, across = horizontal ? content.height : content.width;
  const phases = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  if (along < 16) return { s: 1, phase: 0, ratio: 1, phases };
  const lines = Math.min(across, 384), sums = new Float64Array(along), d = ref.data;
  const luma = (x: number, y: number) => { const p = (y * ref.width + x) * 4; return d[p]! * 0.299 + d[p + 1]! * 0.587 + d[p + 2]! * 0.114; };
  for (let l = 0; l < lines; l++) {
    const c = Math.floor((l + 0.5) * across / lines);
    let prev = horizontal ? luma(content.x, content.y + c) : luma(content.x + c, content.y);
    for (let i = 1; i < along; i++) {
      const v = horizontal ? luma(content.x + i, content.y + c) : luma(content.x + c, content.y + i);
      sums[i]! += Math.abs(v - prev); prev = v;
    }
  }
  const start = horizontal ? content.x : content.y;
  let best = { s: 1, phase: 0, ratio: 1 };
  for (let s = 2; s <= 8; s++) {
    const total = new Float64Array(s), count = new Float64Array(s);
    for (let i = 1; i < along; i++) { const r = (start + i) % s; total[r]! += sums[i]!; count[r]!++; }
    let peak = 0, at = 0;
    for (let r = 0; r < s; r++) { const m = count[r] ? total[r]! / count[r]! : 0; if (m > peak) { peak = m; at = r; } }
    let rest = 0;
    for (let r = 0; r < s; r++) if (r !== at) rest += count[r] ? total[r]! / count[r]! : 0;
    rest /= s - 1;
    const ratio = peak / Math.max(rest, 0.05);
    phases[s] = at;
    if (ratio > best.ratio * 1.05) best = { s, phase: at, ratio };
  }
  return best.ratio >= 1.6 ? { ...best, phases } : { s: 1, phase: 0, ratio: best.ratio, phases };
}

/** Summed-area table (straight colour weighted by alpha) for fast coarse cell features. */
class Integral {
  readonly sums: Float64Array[];
  readonly stride: number;
  constructor(readonly ref: RgbaImage) {
    this.stride = ref.width + 1;
    this.sums = [0, 1, 2, 3].map(() => new Float64Array(this.stride * (ref.height + 1)));
    const [r, g, b, a] = this.sums as [Float64Array, Float64Array, Float64Array, Float64Array], d = ref.data;
    for (let y = 0; y < ref.height; y++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let x = 0; x < ref.width; x++) {
        const p = (y * ref.width + x) * 4, al = d[p + 3]! / 255;
        sr += d[p]! * al; sg += d[p + 1]! * al; sb += d[p + 2]! * al; sa += al;
        const i = (y + 1) * this.stride + x + 1, up = y * this.stride + x + 1;
        r[i] = r[up]! + sr; g[i] = g[up]! + sg; b[i] = b[up]! + sb; a[i] = a[up]! + sa;
      }
    }
  }
  /** Straight mean colour + alpha of a box rounded to whole pixels. */
  box(x0: number, y0: number, x1: number, y1: number, out: number[]): void {
    const ax = Math.max(0, Math.min(this.ref.width - 1, Math.round(x0))), ay = Math.max(0, Math.min(this.ref.height - 1, Math.round(y0)));
    const bx = Math.max(ax + 1, Math.min(this.ref.width, Math.round(x1))), by = Math.max(ay + 1, Math.min(this.ref.height, Math.round(y1)));
    const s = this.stride, n = (bx - ax) * (by - ay), at = (c: number) => { const t = this.sums[c]!; return t[by * s + bx]! - t[ay * s + bx]! - t[by * s + ax]! + t[ay * s + ax]!; };
    const alpha = at(3);
    out[3] = alpha / n;
    for (let c = 0; c < 3; c++) out[c] = alpha > 0 ? at(c) / alpha : 0;
  }
}

/** Repeating tile grid period along one axis (reference px, fractional): identical tiles recur at multiples of
 * the cell size, so the mean difference between pixels d apart dips at d = k·period. */
export function gridPeriod(ref: RgbaImage, content: Rect, horizontal: boolean, minPeriod: number, maxPeriod: number): { period: number; dip: number } | null {
  const along = horizontal ? content.width : content.height, across = horizontal ? content.height : content.width;
  const maxD = Math.min(Math.floor(along / 2), Math.ceil(maxPeriod * 12));
  if (maxD < minPeriod * 2 + 2) return null;
  const lines = Math.min(across, 160), d = ref.data, L = new Float32Array(lines * along);
  for (let l = 0; l < lines; l++) {
    const c = Math.floor((l + 0.5) * across / lines);
    for (let i = 0; i < along; i++) {
      const x = horizontal ? content.x + i : content.x + c, y = horizontal ? content.y + c : content.y + i, p = (y * ref.width + x) * 4;
      L[l * along + i] = d[p]! * 0.299 + d[p + 1]! * 0.587 + d[p + 2]! * 0.114;
    }
  }
  const D = new Float64Array(maxD + 2);
  for (let dist = 1; dist <= maxD + 1 && dist < along; dist++) {
    let sum = 0, n = 0;
    for (let l = 0; l < lines; l++) { const row = l * along; for (let i = 0; i + dist < along; i += 2) { sum += Math.abs(L[row + i]! - L[row + i + dist]!); n++; } }
    D[dist] = n ? sum / n : 0;
  }
  const at = (v: number) => { const i = Math.floor(v), f = v - i; return i + 1 > maxD + 1 ? Infinity : D[i]! * (1 - f) + D[i + 1]! * f; };
  /** Mean dip ratio of D at the multiples of p against nearby distances (dips are narrow). */
  const dip = (p: number) => {
    const w = Math.max(2, p * 0.15);
    let sum = 0, n = 0;
    for (let k = 1; k * p + w <= maxD; k++) { sum += at(k * p) / ((at(k * p - w) + at(k * p + w)) / 2 || 1); n++; }
    return n >= 2 ? sum / n : Infinity;
  };
  const ratios: [number, number][] = [];
  for (let p = minPeriod; p <= Math.min(maxPeriod, maxD / 2.5); p += 0.25) ratios.push([p, dip(p)]);
  const lowest = Math.min(...ratios.map(r => r[1]));
  // Multiples of the period dip as deeply; the fundamental is the smallest period that dips (almost) as much.
  const first = ratios.find(r => r[1] <= lowest + Math.max(0.01, (1 - lowest) * 0.15));
  const best = first ? { period: first[0], dip: first[1] } : { period: 0, dip: Infinity };
  if (!Number.isFinite(best.dip) || best.dip > 0.95) return null;
  // Precise period: minimise D over all multiples near the rough estimate.
  let fine = best.period, fineScore = Infinity;
  for (let p = best.period - 0.3; p <= best.period + 0.3; p += 0.005) {
    let sum = 0, n = 0;
    for (let k = 1; k * p <= maxD; k++) { sum += at(k * p); n++; }
    if (n && sum / n < fineScore) { fineScore = sum / n; fine = p; }
  }
  return { period: fine, dip: best.dip };
}

interface Candidate { cellPx: number; cellPxY: number; ox: number; oy: number; kind: "grid" | "fit"; grid: number; score?: number; fine?: number }
interface Grid { cellPx: number; cellPxY: number; baseX: number; baseY: number; unitX: number; unitY: number; stepX: number; stepY: number; refineX: number; refineY: number }
export interface DetectOptions {
  tileWidth: number; tileHeight: number;
  index: TileIndex;
  hint?: ReferenceAlignHint;
  /** Fitted candidates: the picture stretched onto region, or onto the whole map. */
  fit?: { region: Rect; mapWidth: number; mapHeight: number };
  content?: Rect;
  checkpoint?: () => Promise<void> | undefined;
}
export interface DetectResult { alignment: ReferenceAlignment; content: Rect; block: { x: number; y: number } }

const mod = (v: number, m: number) => ((v % m) + m) % m;

/** Detect (or complete from a hint) the alignment of a picture on the map grid. */
export async function detectAlignment(ref: RgbaImage, opts: DetectOptions): Promise<DetectResult> {
  const { tileWidth: tw, tileHeight: th, index, hint = {} } = opts;
  const content = opts.content ?? pictureContent(ref);
  const pause = async () => { const p = opts.checkpoint?.(); if (p) await p; };
  const bx = blockScale(ref, content, true), by = blockScale(ref, content, false);
  let s = bx.s;
  if (bx.s !== by.s) s = bx.ratio >= by.ratio ? bx.s : by.s;
  // A grid needs at least two cells per axis on the picture.
  if (s > 1 && (s * tw * 2 > content.width || s * th * 2 > content.height)) s = 1;
  const integral = new Integral(ref), candidates: Candidate[] = [], grids: Grid[] = [];
  const fixedScale = hint.cellPx ?? (hint.scale !== undefined ? hint.scale * tw : undefined);
  const fixedX = hint.offsetX !== undefined, fixedY = hint.offsetY !== undefined;
  const addGrid = (cellPx: number, cellPxY: number) => {
    if (grids.some(g => Math.abs(g.cellPx - cellPx) / cellPx < 0.004 && Math.abs(g.cellPxY - cellPxY) / cellPxY < 0.004)) return;
    const unitX = cellPx / tw, unitY = cellPxY / th;
    const blockX = Number.isInteger(unitX) && unitX >= 2 && bx.phases[unitX] !== undefined, blockY = Number.isInteger(unitY) && unitY >= 2 && by.phases[unitY] !== undefined;
    // Integer upscales: phases move in whole source pixels from the detected block start; otherwise in reference pixels.
    const stepX = Math.max(1, Math.floor(tw / 8)) * unitX, stepY = Math.max(1, Math.floor(th / 8)) * unitY;
    grids.push({ cellPx, cellPxY, unitX, unitY, stepX, stepY,
      baseX: fixedX ? hint.offsetX! : blockX ? mod(bx.phases[unitX]!, unitX) : 0, baseY: fixedY ? hint.offsetY! : blockY ? mod(by.phases[unitY]!, unitY) : 0,
      refineX: blockX || Number.isInteger(unitX) ? unitX : 1, refineY: blockY || Number.isInteger(unitY) ? unitY : 1 });
  };
  if (fixedScale !== undefined) addGrid(fixedScale, fixedScale * th / tw);
  else {
    addGrid(s * tw, s * th);
    const periodX = gridPeriod(ref, content, true, Math.max(4, tw * 0.4), tw * 8.5), periodY = gridPeriod(ref, content, false, Math.max(4, th * 0.4), th * 8.5);
    const scales = [periodX ? periodX.period / tw : 0, periodY ? periodY.period / th : 0].filter(v => v > 0);
    if (scales.length === 2 && Math.abs(scales[0]! - scales[1]!) / scales[0]! > 0.03) scales.splice(periodX!.dip <= periodY!.dip ? 1 : 0, 1);
    if (scales.length) {
      // Common resizes (k/8: 0.75, 1.5, 2.5 …) snap exactly; others keep the measured period.
      const k = scales.reduce((a, b) => a + b, 0) / scales.length, snapped = Math.round(k * 8) / 8;
      const scale = snapped > 0 && Math.abs(k - snapped) / snapped < 0.003 ? snapped : k;
      addGrid(scale * tw, scale * th);
    }
  }
  grids.forEach((g, gi) => {
    const xs: number[] = [], ys: number[] = [];
    if (fixedX) xs.push(g.baseX); else for (let v = g.baseX; v < g.baseX + g.cellPx - 1e-6; v += g.stepX) xs.push(v);
    if (fixedY) ys.push(g.baseY); else for (let v = g.baseY; v < g.baseY + g.cellPxY - 1e-6; v += g.stepY) ys.push(v);
    for (const ox of xs) for (const oy of ys) candidates.push({ cellPx: g.cellPx, cellPxY: g.cellPxY, ox, oy, kind: "grid", grid: gi });
  });
  if (fixedScale === undefined && opts.fit) {
    const { region, mapWidth, mapHeight } = opts.fit;
    for (const [w, h, x, y] of [[region.width, region.height, region.x, region.y], [mapWidth, mapHeight, 0, 0]] as const) {
      const cw = content.width / w, ch = content.height / h;
      if (cw < 2 || ch < 2) continue;
      const ox = fixedX ? hint.offsetX! : content.x - x * cw, oy = fixedY ? hint.offsetY! : content.y - y * ch;
      if (!candidates.some(c => Math.abs(c.cellPx - cw) < 0.01 && Math.abs(c.cellPxY - ch) < 0.01 && Math.abs(c.ox - ox) < 0.5 && Math.abs(c.oy - oy) < 0.5))
        candidates.push({ cellPx: cw, cellPxY: ch, ox, oy, kind: "fit", grid: -1 });
    }
  }
  // Stage A: coarse best-tile error at fixed picture points.
  const points: [number, number][] = [], n = 7;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) points.push([content.x + (i + 0.5) * content.width / n, content.y + (j + 0.5) * content.height / n]);
  const C = index.coarse, tmp = [0, 0, 0, 0], feature = new Float32Array(C * C * 3);
  const ground = index.ground.map(g => index.tiles[g]!);
  const coarseScore = (c: Candidate): number => {
    const errors: number[] = [];
    for (const [x, y] of points) {
      const cx = Math.floor((x - c.ox) / c.cellPx), cy = Math.floor((y - c.oy) / c.cellPxY);
      const x0 = c.ox + cx * c.cellPx, y0 = c.oy + cy * c.cellPxY;
      if (x0 < content.x - 0.5 || y0 < content.y - 0.5 || x0 + c.cellPx > content.x + content.width + 0.5 || y0 + c.cellPxY > content.y + content.height + 0.5) continue;
      let opaque = true;
      for (let k = 0; k < C * C; k++) {
        const bx0 = x0 + (k % C) * c.cellPx / C, by0 = y0 + Math.floor(k / C) * c.cellPxY / C;
        integral.box(bx0, by0, bx0 + c.cellPx / C, by0 + c.cellPxY / C, tmp);
        feature[k * 3] = tmp[0]!; feature[k * 3 + 1] = tmp[1]!; feature[k * 3 + 2] = tmp[2]!;
        if (tmp[3]! < 0.9) opaque = false;
      }
      if (!opaque) continue;
      let best = Infinity;
      for (const t of ground) {
        let e = 0;
        for (let ch = 0; ch < 3; ch++) {
          let pt = 0, tt = 0;
          for (let k = 0; k < C * C; k++) { pt += feature[k * 3 + ch]! * t.coarse[k * 3 + ch]!; tt += t.coarse[k * 3 + ch]! ** 2; }
          const g = tt > 1e-6 ? Math.max(0.5, Math.min(2, pt / tt)) : 1;
          for (let k = 0; k < C * C; k++) { const dd = feature[k * 3 + ch]! / g - t.coarse[k * 3 + ch]!; e += dd * dd; }
          e += 40 * Math.abs(Math.log(g));
          if (e >= best) break;
        }
        if (e < best) best = e;
      }
      errors.push(Math.sqrt(best / (C * C * 3)));
    }
    if (errors.length < 4) return Infinity;
    errors.sort((a, b) => a - b);
    const keep = Math.max(3, Math.ceil(errors.length * 0.7));
    return errors.slice(0, keep).reduce((a, b) => a + b, 0) / keep;
  };
  let evaluated = 0;
  for (const c of candidates) { c.score = coarseScore(c); if (++evaluated % 8 === 0) await pause(); }
  // Refine the best coarse phases of every grid (whole source pixels, or reference pixels for fractional scales).
  const near = (a: number, b: number, m: number) => Math.abs(mod(a - b + m / 2, m) - m / 2) < 1e-6;
  grids.forEach((g, gi) => {
    const top = candidates.filter(c => c.grid === gi && Number.isFinite(c.score)).sort((a, b) => a.score! - b.score!).slice(0, 3);
    for (const t of top) {
      const rx = fixedX ? 0 : Math.round(g.stepX / g.refineX), ry = fixedY ? 0 : Math.round(g.stepY / g.refineY);
      for (let dy = -ry + 1; dy < ry; dy++) for (let dx = -rx + 1; dx < rx; dx++) {
        if (!dx && !dy) continue;
        const ox = t.ox + dx * g.refineX, oy = t.oy + dy * g.refineY;
        if (candidates.some(c => c.grid === gi && near(c.ox, ox, g.cellPx) && near(c.oy, oy, g.cellPxY))) continue;
        const c: Candidate = { cellPx: g.cellPx, cellPxY: g.cellPxY, ox, oy, kind: "grid", grid: gi };
        c.score = coarseScore(c);
        candidates.push(c);
      }
    }
  });
  await pause();
  // Stage B: fine matcher on sample cells for the strongest candidates (best of each grid kept).
  const ranked = candidates.filter(c => Number.isFinite(c.score)).sort((a, b) => a.score! - b.score!);
  const finalists = ranked.slice(0, 4);
  for (const c of ranked) if (!finalists.some(f => f.grid === c.grid && f.kind === c.kind)) finalists.push(c);
  if (!finalists.length) finalists.push(candidates[0] ?? { cellPx: s * tw, cellPxY: s * th, ox: content.x, oy: content.y, kind: "grid", grid: 0 });
  for (const c of finalists) {
    await pause();
    const errors: number[] = [];
    const a: ReferenceAlignment = { cellPx: c.cellPx, cellPxY: c.cellPxY, scale: c.cellPx / tw, offsetX: c.ox, offsetY: c.oy, cols: 0, rows: 0, confidence: 0, method: "auto" };
    for (const [x, y] of points) {
      const cx = Math.floor((x - c.ox) / c.cellPx), cy = Math.floor((y - c.oy) / c.cellPxY);
      const x0 = c.ox + cx * c.cellPx, y0 = c.oy + cy * c.cellPxY;
      if (x0 + c.cellPx / 2 < content.x || y0 + c.cellPxY / 2 < content.y || x0 + c.cellPx / 2 > content.x + content.width || y0 + c.cellPxY / 2 > content.y + content.height) continue;
      const w = opts.checkpoint?.();
      if (w) await w;
      const m = matchResampled(sampleCell(ref, a, cx, cy, tw, th, index.size, content), index, { normalizeLight: true, topK: 1 });
      if (Number.isFinite(m.err)) errors.push(m.err);
    }
    errors.sort((p, q) => p - q);
    c.fine = errors.length >= 3 ? errors[Math.floor(errors.length * 0.4)]! : Infinity;
  }
  finalists.sort((a, b) => a.fine! - b.fine! || a.score! - b.score!);
  const best = finalists[0]!;
  const unitX = best.cellPx / tw, unitY = best.cellPxY / th;
  const distinct = finalists.find(c => c !== best && (Math.abs(c.cellPx - best.cellPx) > 0.01 || Math.abs(mod(c.ox - best.ox + c.cellPx / 2, c.cellPx) - c.cellPx / 2) > unitX * 1.5 || Math.abs(mod(c.oy - best.oy + c.cellPxY / 2, c.cellPxY) - c.cellPxY / 2) > unitY * 1.5));
  const fitQ = Number.isFinite(best.fine!) ? Math.max(0, Math.min(1, (20 - best.fine!) / 14)) : 0;
  const sep = distinct && Number.isFinite(distinct.fine!) ? Math.max(0, Math.min(1, 3 * (distinct.fine! - best.fine!) / Math.max(1, best.fine!))) : 1;
  let { ox, oy } = best;
  // Grid candidates: cell 0 is the first whole cell inside the content (unless the hint fixed the offset).
  if (best.kind === "grid") {
    if (!fixedX) { ox = mod(ox - content.x, best.cellPx) + content.x; if (ox - content.x > best.cellPx - 0.5) ox -= best.cellPx; }
    if (!fixedY) { oy = mod(oy - content.y, best.cellPxY) + content.y; if (oy - content.y > best.cellPxY - 0.5) oy -= best.cellPxY; }
  }
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const cellPx = r(best.cellPx), cellPxY = r(best.cellPxY);
  const alignment: ReferenceAlignment = {
    cellPx, ...(Math.abs(cellPxY - cellPx * th / tw) > 1e-3 ? { cellPxY } : {}), scale: r(best.cellPx / tw),
    offsetX: r(ox), offsetY: r(oy),
    cols: Math.max(0, Math.ceil((content.x + content.width - ox) / best.cellPx - 0.5)),
    rows: Math.max(0, Math.ceil((content.y + content.height - oy) / best.cellPxY - 0.5)),
    confidence: r(fitQ * (0.5 + 0.5 * sep)),
    method: fixedScale !== undefined && fixedX && fixedY ? "manual" : "auto",
  };
  return { alignment, content, block: { x: bx.s, y: by.s } };
}
