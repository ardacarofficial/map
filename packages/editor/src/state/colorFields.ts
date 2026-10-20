import { parseHex, rgbToHsl, hsvToHsl, hslToHsv, hsvToRgb, rgbToHsv, type Hsva } from '@smap/core';
export type ColorFieldMode = 'rgb' | 'hsl';
export function colorFields(hex: string, mode: ColorFieldMode, hue: number): number[] {
  const c = parseHex(hex)!;
  if (mode === 'rgb') return [c.r, c.g, c.b, c.a];
  const h = rgbToHsl(c, hue);
  return [Math.min(359, Math.round(h.h)), Math.round(h.s * 100), Math.round(h.l * 100), c.a];
}
/** Change only the edited channel; untouched HSV/HSL channels keep their full precision. */
export function hsvFromField(hsv: Hsva, mode: ColorFieldMode, index: number, text: string): Hsva | null {
  if (!text.trim() || !Number.isFinite(Number(text))) return null;
  const max = index === 3 || mode === 'rgb' ? 255 : index === 0 ? 359 : 100;
  const value = Math.max(0, Math.min(max, Number(text)));
  if (index === 3) return { ...hsv, a: Math.round(value) };
  if (mode === 'rgb') {
    const rgb = hsvToRgb(hsv), channel = (['r', 'g', 'b'] as const)[index];
    return channel ? rgbToHsv({ ...rgb, [channel]: value }, hsv.h) : null;
  }
  const hsl = hsvToHsl(hsv), channel = (['h', 's', 'l'] as const)[index];
  return channel ? hslToHsv({ ...hsl, [channel]: index === 0 ? value : value / 100 }) : null;
}
