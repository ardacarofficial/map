/** render_compare helpers (pure, no DOM): per-cell perceptual error (Lab ΔE76) and the heatmap colour scale.
 * Cell geometry comes from the K1 alignment (match/alignment.ts). Read-only; the agent applies any fix. */

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
const GAIN_MIN = 0.6, GAIN_MAX = 1.7, OFFSET_MIN = -64, OFFSET_MAX = 96;
/** Mean ΔE76 of `tile` against the picture patch after fitting the picture's light per channel
 * (picture ≈ gain·tile + offset, least squares), so glows and shading do not count as errors. Channels needing
 * different gains (a recolour, not light), strong gains and large offsets are penalised. Only picture pixels
 * (alpha ≥ 128) count. refLab = toLab(ref). */
export function litDeltaE(tile: ArrayLike<number>, ref: ArrayLike<number>, pixels: number, refLab: Float32Array): number {
  const sw = [0, 0, 0], st = [0, 0, 0], sr = [0, 0, 0], stt = [0, 0, 0], str = [0, 0, 0];
  for (let i = 0; i < pixels; i++) {
    if (ref[i * 4 + 3]! < 128) continue;
    const w = tile[i * 4 + 3]! / 255;
    for (let c = 0; c < 3; c++) { const t = tile[i * 4 + c]!, r = ref[i * 4 + c]!; sw[c]! += w; st[c]! += w * t; sr[c]! += w * r; stt[c]! += w * t * t; str[c]! += w * t * r; }
  }
  if (!sw[0]) return 0;
  const gain = [1, 1, 1], offset = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const mt = st[c]! / sw[c]!, mr = sr[c]! / sw[c]!, vt = stt[c]! / sw[c]! - mt * mt;
    gain[c] = vt > 25 ? Math.min(GAIN_MAX, Math.max(GAIN_MIN, (str[c]! / sw[c]! - mt * mr) / vt)) : 1;
    offset[c] = Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, mr - gain[c]! * mt));
  }
  const lit = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) lit[i * 4 + c] = Math.max(0, Math.min(255, Math.round(tile[i * 4 + c]! * gain[c]! + offset[c]!)));
    lit[i * 4 + 3] = tile[i * 4 + 3]!;
  }
  const litLab = toLab(lit, pixels);
  let sum = 0, n = 0;
  for (let i = 0; i < pixels; i++) {
    if (ref[i * 4 + 3]! < 128) continue;
    sum += Math.hypot(litLab[i * 3]! - refLab[i * 3]!, litLab[i * 3 + 1]! - refLab[i * 3 + 1]!, litLab[i * 3 + 2]! - refLab[i * 3 + 2]!); n++;
  }
  const logs = gain.map(Math.log), mean = (logs[0]! + logs[1]! + logs[2]!) / 3;
  const spread = Math.max(...logs.map(l => Math.abs(l - mean)));
  return (n ? sum / n : 0) + 20 * spread + 4 * Math.abs(mean) + 0.04 * (Math.abs(offset[0]!) + Math.abs(offset[1]!) + Math.abs(offset[2]!)) / 3;
}
