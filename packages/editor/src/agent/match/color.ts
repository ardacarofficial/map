/** sRGB (0–255, D65) → CIE L*a*b*. Pure; shared by the tile index and the cell matcher. */

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const E = 216 / 24389, K = 24389 / 27;
const f = (t: number) => t > E ? Math.cbrt(t) : (K * t + 16) / 116;
const linear = (v: number) => LINEAR[v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v)]!;

/** Writes L, a, b of one sRGB colour into out[o..o+2]. */
export function rgbToLab(r: number, g: number, b: number, out: Float32Array, o: number): void {
  const R = linear(r), G = linear(g), B = linear(b);
  const x = f((R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047);
  const y = f(R * 0.2126729 + G * 0.7151522 + B * 0.072175);
  const z = f((R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883);
  out[o] = 116 * y - 16; out[o + 1] = 500 * (x - y); out[o + 2] = 200 * (y - z);
}

/** Lab of n interleaved sRGB pixels. */
export function labOf(rgb: Float32Array, n: number, out = new Float32Array(n * 3)): Float32Array {
  for (let i = 0; i < n; i++) rgbToLab(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, out, i * 3);
  return out;
}

/** Forward-difference gradients of L on an s×s grid (last column/row 0). */
export function gradients(lab: Float32Array, s: number, gx = new Float32Array(s * s), gy = new Float32Array(s * s)): [Float32Array, Float32Array] {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, l = lab[i * 3]!;
    gx[i] = x + 1 < s ? lab[(i + 1) * 3]! - l : 0;
    gy[i] = y + 1 < s ? lab[(i + s) * 3]! - l : 0;
  }
  return [gx, gy];
}
