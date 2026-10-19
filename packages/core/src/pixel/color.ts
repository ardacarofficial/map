/** Straight (unpremultiplied) RGBA8. Public inputs are rounded/clamped to bytes. */
export interface Rgba8 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Hue in degrees [0,360), saturation/value in [0,1], alpha in [0,255]. */
export interface Hsva {
  readonly h: number;
  readonly s: number;
  readonly v: number;
  readonly a: number;
}

/** Hue in degrees [0,360), saturation/lightness in [0,1], alpha in [0,255]. */
export interface Hsla {
  readonly h: number;
  readonly s: number;
  readonly l: number;
  readonly a: number;
}

function clamp(value: number, max: number): number {
  return Number.isNaN(value) ? 0 : Math.max(0, Math.min(max, value));
}
function byte(value: number): number { return Math.round(clamp(value, 255)); }
function unit(value: number): number { return clamp(value, 1); }
function hue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 360;
  // Avoid adding 360 to a valid hue: it loses fractional precision.
  if (wrapped >= 0) return wrapped === 0 ? 0 : wrapped;
  const positive = wrapped + 360;
  return positive === 360 ? 0 : positive;
}

/** Alpha zero always has zero RGB; alpha never scales the RGB channels. */
export function canonicalRgba(c: Rgba8): Rgba8 {
  const a = byte(c.a);
  return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: byte(c.r), g: byte(c.g), b: byte(c.b), a };
}

/** Byte equality; views supplied to tools must already contain canonical RGBA8. */
export function equalRgba(a: Rgba8, b: Rgba8): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function rgbPolar(c: Rgba8, rememberedHue: number): { h: number; min: number; max: number; delta: number; a: number } {
  const { r, g, b, a } = canonicalRgba(c);
  const min = Math.min(r, g, b) / 255, max = Math.max(r, g, b) / 255;
  const delta = max - min;
  let h = hue(rememberedHue);
  if (delta > 0) {
    const d = Math.max(r, g, b) - Math.min(r, g, b);
    h = hue(60 * (max === r / 255 ? (g - b) / d : max === g / 255 ? (b - r) / d + 2 : (r - g) / d + 4));
  }
  return { h, min, max, delta, a };
}

/** Floating HSV channels retain enough precision for exact RGB8 round trips. */
export function rgbToHsv(c: Rgba8, rememberedHue = 0): Hsva {
  const { h, max, delta, a } = rgbPolar(c, rememberedHue);
  return { h, s: max === 0 ? 0 : delta / max, v: max, a };
}

export function rgbToHsl(c: Rgba8, rememberedHue = 0): Hsla {
  const { h, min, max, delta, a } = rgbPolar(c, rememberedHue);
  const l = (max + min) / 2;
  return { h, s: delta === 0 ? 0 : unit(delta / (1 - Math.abs(2 * l - 1))), l, a };
}

function polarRgb(h: number, chroma: number, m: number, a: number): Rgba8 {
  const sector = hue(h) / 60, x = chroma * (1 - Math.abs(sector % 2 - 1));
  const [r, g, b]: [number, number, number] = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0] : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma] : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return canonicalRgba({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a });
}

export function hsvToRgb(c: Hsva): Rgba8 {
  const v = unit(c.v), chroma = v * unit(c.s);
  return polarRgb(c.h, chroma, v - chroma, c.a);
}

export function hslToRgb(c: Hsla): Rgba8 {
  const l = unit(c.l), chroma = (1 - Math.abs(2 * l - 1)) * unit(c.s);
  return polarRgb(c.h, chroma, l - chroma / 2, c.a);
}

/** Direct conversions preserve hue without quantizing through RGB8. */
export function hsvToHsl(c: Hsva): Hsla {
  const a = byte(c.a), v = a === 0 ? 0 : unit(c.v), s = unit(c.s);
  const l = v * (1 - s / 2);
  return { h: hue(c.h), s: l === 0 || l === 1 ? 0 : unit((v - l) / Math.min(l, 1 - l)), l, a };
}

export function hslToHsv(c: Hsla): Hsva {
  const a = byte(c.a), l = a === 0 ? 0 : unit(c.l), s = unit(c.s);
  const v = l + s * Math.min(l, 1 - l);
  return { h: hue(c.h), s: v === 0 ? 0 : 2 * (1 - l / v), v, a };
}

/** Accepts #rgb, #rgba, #rrggbb or #rrggbbaa (case insensitive). */
export function parseHex(text: string): Rgba8 | null {
  const match = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(text.trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length <= 4) hex = [...hex].map(c => c + c).join("");
  return canonicalRgba({ r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255 });
}

/** Lowercase, full-width HEX; explicit alpha by default for palette persistence. */
export function formatHex(c: Rgba8, includeAlpha = true): string {
  const { r, g, b, a } = canonicalRgba(c);
  return "#" + (includeAlpha ? [r, g, b, a] : [r, g, b]).map(v => v.toString(16).padStart(2, "0")).join("");
}
