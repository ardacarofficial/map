import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_COLORS, readThemeColors } from "./colors";

function theme(tokens: Record<string, string>) {
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (name: string) => tokens[name] ?? "" }));
  return readThemeColors({} as Element);
}

afterEach(() => vi.unstubAllGlobals());

describe("canvas theme colours", () => {
  it("uses map, popup and label tokens independently of the surround", () => {
    const colors = theme({
      "--color-canvas": "#010203",
      "--color-map-bg": " #aAbBcC ",
      "--color-popup": "#102030",
      "--color-line-strong": "#405060",
      "--color-text": "#d0e0f0",
      "--color-muted": "#a0b0c0",
    });
    expect(colors.outside).toBe(0x010203);
    expect(colors.mapBackground).toBe(0xaabbcc);
    expect(colors.popup).toBe(0x102030);
    expect(colors.lineStrong).toBe(0x405060);
    expect(colors.text).toBe(0xd0e0f0);
    expect(colors.muted).toBe(0xa0b0c0);
  });

  it("falls back when tokens are absent or cannot be parsed as opaque hex", () => {
    expect(theme({ "--color-map-bg": "transparent", "--color-popup": "#abc" })).toEqual(CANVAS_COLORS);
  });

  it("reads the accent token", () => {
    const colors = theme({ "--color-accent": "#123456" });
    expect(colors.accent).toBe(0x123456);
  });
});
