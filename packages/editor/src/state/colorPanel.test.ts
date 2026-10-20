import { formatHex, hsvToRgb, rgbToHsv } from '@smap/core';
import { beforeEach, expect, it } from 'vitest';
import { usePixelColors } from './pixelColors';
import { colorFields, hsvFromField } from './colorFields';

beforeEach(() => { usePixelColors.getState().reset(); usePixelColors.getState().clearRecent(); });
it('keeps RGB/HSL/HEX in parity and clamps numeric channels', () => {
  let c = rgbToHsv({ r: 0, g: 0, b: 40, a: 255 });
  c = hsvFromField(c, 'rgb', 0, '300')!; c = hsvFromField(c, 'rgb', 1, '-4')!; c = hsvFromField(c, 'rgb', 3, '999')!;
  expect(formatHex(hsvToRgb(c))).toBe('#ff0028ff');
  expect(formatHex(hsvToRgb(hsvFromField({ h: 0, s: 1, v: 1, a: 255 }, 'hsl', 0, '120')!))).toBe('#00ff00ff');
  expect(colorFields('#00ff0080', 'rgb', 120)).toEqual([0, 255, 0, 128]);
  expect(colorFields('#00ff0080', 'hsl', 120)).toEqual([120, 100, 50, 128]);
  expect(hsvFromField(c, 'rgb', 0, '')).toBeNull();
  expect(hsvFromField(c, 'rgb', 0, 'NaN')).toBeNull();
});
it('remembers hue at zero saturation, black and transparent, including swap', () => {
  const s = usePixelColors.getState();
  s.setHsv('fg', { h: 217, s: 0, v: .5, a: 255 });
  expect(usePixelColors.getState().fgHsv.h).toBe(217);
  s.setFg('#000000'); expect(usePixelColors.getState().fgHsv.h).toBe(217);
  s.setFg('#ffffff00'); expect(usePixelColors.getState().fgHsv.h).toBe(217);
  s.swap(); expect(usePixelColors.getState().bgHsv.h).toBe(217);
});
it('records only committed choices, deduplicates, caps at sixteen and ignores invalid values', () => {
  const s = usePixelColors.getState();
  for (let i = 0; i < 40; i++) s.setFg(`#${i.toString(16).padStart(2, '0')}0000ff`);
  expect(usePixelColors.getState().recent).toEqual([]);
  for (let i = 0; i < 20; i++) s.addRecent(`#${i.toString(16).padStart(2, '0')}0000ff`);
  s.addRecent('#100000ff'); s.addRecent('invalid');
  const recent = usePixelColors.getState().recent;
  expect(recent).toHaveLength(16); expect(new Set(recent).size).toBe(16); expect(recent[0]).toBe('#100000ff');
});

it('HSL hue edits retain exact hue and alpha edits leave the HSV cursor unchanged', () => {
  const hsv = { h: 217, s: .623, v: .713, a: 255 };
  expect(hsvFromField(hsv, 'hsl', 3, '128')).toEqual({ ...hsv, a: 128 });
  expect(hsvFromField(hsv, 'rgb', 3, '999')).toEqual({ ...hsv, a: 255 });
  expect(hsvFromField(hsv, 'hsl', 0, '67')?.h).toBe(67);
  expect(hsvFromField(hsv, 'hsl', 1, '-10')).toMatchObject({ h: 217, s: 0 });
  expect(hsvFromField(hsv, 'hsl', 0, '')).toBeNull();
});

it('preserves fractional HEX hue near 360 degrees while editing alpha and bounds field display', () => {
  const colors = usePixelColors.getState(); colors.setFg('#ff0001ff');
  const before = usePixelColors.getState().fgHsv;
  expect(before.h).toBeGreaterThan(359);
  colors.setHsv('fg', hsvFromField(before, 'hsl', 3, '128')!);
  expect(usePixelColors.getState().fg).toBe('#ff000180');
  expect(usePixelColors.getState().fgHsv.h).toBe(before.h);
  expect(colorFields('#ff0001ff', 'hsl', 0)[0]).toBeLessThanOrEqual(359);
});
