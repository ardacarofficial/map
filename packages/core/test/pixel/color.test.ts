import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalRgba, formatHex, hslToHsv, hslToRgb, hsvToHsl, hsvToRgb, parseHex, rgbToHsl, rgbToHsv } from "../../src/pixel/color";

const byte = fc.integer({ min: 0, max: 255 });
const rgba = fc.record({ r: byte, g: byte, b: byte, a: byte });

describe("pixel colour", () => {
  it("round trips every RGB8 channel through HSV and HSL without quantizing polar channels", () => {
    fc.assert(fc.property(rgba, c => {
      const expected = canonicalRgba(c);
      expect(hsvToRgb(rgbToHsv(c))).toEqual(expected);
      expect(hslToRgb(rgbToHsl(c))).toEqual(expected);
      expect(hslToRgb(hsvToHsl(rgbToHsv(c)))).toEqual(expected);
      expect(hsvToRgb(hslToHsv(rgbToHsl(c)))).toEqual(expected);
    }), { numRuns: 3000 });
  }, 15_000);

  it("round trips HEX, including straight alpha and canonical transparent black", () => {
    fc.assert(fc.property(rgba, c => { expect(parseHex(formatHex(c))).toEqual(canonicalRgba(c)); }), { numRuns: 2000 });
    for (const [hex, expected] of [
      ["#abc", "#aabbccff"], ["#1234", "#11223344"], ["#ABCDEF", "#abcdefff"],
      ["#12345678", "#12345678"], ["#ff000000", "#00000000"],
    ]) expect(formatHex(parseHex(hex!)!)).toBe(expected);
    expect(formatHex({ r: 1, g: 2, b: 3, a: 255 }, false)).toBe("#010203");
    for (const bad of ["red", "123", "#12", "#12345", "#1234567", "#ggg", "#123456789"]) expect(parseHex(bad)).toBeNull();
  });

  it("round trips direct HSV/HSL coordinates where saturation is defined", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 359 }), byte, fc.integer({ min: 1, max: 254 }), (h, s8, v8) => {
      const hsv = { h, s: s8 / 255, v: v8 / 255, a: 128 };
      const hsvAgain = hslToHsv(hsvToHsl(hsv));
      expect(hsvAgain.h).toBe(h);
      expect(hsvAgain.s).toBeCloseTo(hsv.s, 10);
      expect(hsvAgain.v).toBeCloseTo(hsv.v, 10);
      expect(hsvAgain.a).toBe(128);
      const hsl = { h, s: s8 / 255, l: v8 / 255, a: 64 };
      const hslAgain = hsvToHsl(hslToHsv(hsl));
      expect(hslAgain.h).toBe(h);
      expect(hslAgain.s).toBeCloseTo(hsl.s, 10);
      expect(hslAgain.l).toBeCloseTo(hsl.l, 10);
      expect(hslAgain.a).toBe(64);
    }), { numRuns: 500 });
  });

  it("retains remembered hue for greys, black, white and transparent input", () => {
    fc.assert(fc.property(byte, fc.integer({ min: 0, max: 359 }), (v, h) => {
      const c = { r: v, g: v, b: v, a: 255 };
      expect(rgbToHsv(c, h).h).toBe(h);
      expect(rgbToHsl(c, h).h).toBe(h);
      expect(hsvToHsl({ h, s: 0, v: v / 255, a: 255 }).h).toBe(h);
      expect(hslToHsv({ h, s: 0, l: v / 255, a: 255 }).h).toBe(h);
    }));
    expect(rgbToHsv({ r: 255, g: 0, b: 0, a: 0 }, 270).h).toBe(270);
  });

  it("preserves fractional remembered hue exactly within the canonical range", () => {
    fc.assert(fc.property(fc.double({ min: Number.MIN_VALUE, max: 359.999, noNaN: true }), h => {
      expect(rgbToHsv({ r: 80, g: 80, b: 80, a: 255 }, h).h).toBe(h);
      expect(rgbToHsl({ r: 80, g: 80, b: 80, a: 255 }, h).h).toBe(h);
      expect(hsvToHsl({ h, s: 0, v: 0.5, a: 255 }).h).toBe(h);
      expect(hslToHsv({ h, s: 0, l: 0.5, a: 255 }).h).toBe(h);
    }));
  });

  it("clamps derived saturation at RGB edges and subnormal HSV values", () => {
    expect(hsvToHsl({ h: 42.5, s: 1, v: 5 * Number.MIN_VALUE, a: 255 }).s).toBeLessThanOrEqual(1);
    const normalized = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(fc.property(normalized, normalized, (s, v) => {
      const hsl = hsvToHsl({ h: 42.5, s, v, a: 255 });
      const hsv = hslToHsv({ h: 42.5, s, l: v, a: 255 });
      for (const value of [hsl.s, hsl.l, hsv.s, hsv.v]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }));
    for (let n = 0; n < 255; n++) {
      const hsl = rgbToHsl({ r: n, g: 255, b: n, a: 255 });
      expect(hsl.s).toBeGreaterThanOrEqual(0);
      expect(hsl.s).toBeLessThanOrEqual(1);
    }
  });

  it("always wraps hue below 360, including tiny negative and non-finite inputs", () => {
    const grey = { r: 80, g: 80, b: 80, a: 255 };
    expect(rgbToHsv(grey, -Number.MIN_VALUE).h).toBe(0);
    fc.assert(fc.property(fc.double(), h => {
      const normalized = rgbToHsv(grey, h).h;
      expect(normalized).toBeGreaterThanOrEqual(0);
      expect(normalized).toBeLessThan(360);
    }));
  });

  it("clamps, rounds, wraps hue, and never premultiplies alpha", () => {
    expect(canonicalRgba({ r: -5, g: 12.6, b: Infinity, a: 128 })).toEqual({ r: 0, g: 13, b: 255, a: 128 });
    expect(canonicalRgba({ r: NaN, g: 2, b: 3, a: NaN })).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(hsvToRgb({ h: -120, s: 2, v: 2, a: 128 })).toEqual({ r: 0, g: 0, b: 255, a: 128 });
    expect(hslToRgb({ h: 720, s: 1, l: 0.5, a: 64 })).toEqual({ r: 255, g: 0, b: 0, a: 64 });
    expect(hsvToRgb({ h: 12, s: 1, v: 1, a: 0 })).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
