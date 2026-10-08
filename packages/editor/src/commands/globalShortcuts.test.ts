import { describe, expect, it } from "vitest";

import { isReservedBrowserKey } from "./globalShortcuts";

const key = (k: string, code: string, mods: Partial<{ ctrl: boolean; shift: boolean }> = {}) => ({
  key: k,
  code,
  ctrlKey: mods.ctrl ?? false,
  metaKey: false,
  shiftKey: mods.shift ?? false,
  altKey: false,
});

describe("reserved browser keys", () => {
  it("swallows reload, print, find, caret browsing and view source", () => {
    expect(isReservedBrowserKey(key("F5", "F5"))).toBe(true);
    expect(isReservedBrowserKey(key("r", "KeyR", { ctrl: true }))).toBe(true);
    expect(isReservedBrowserKey(key("R", "KeyR", { ctrl: true, shift: true }))).toBe(true);
    expect(isReservedBrowserKey(key("p", "KeyP", { ctrl: true }))).toBe(true);
    expect(isReservedBrowserKey(key("f", "KeyF", { ctrl: true }))).toBe(true);
    expect(isReservedBrowserKey(key("F7", "F7"))).toBe(true);
    expect(isReservedBrowserKey(key("u", "KeyU", { ctrl: true }))).toBe(true);
  });

  it("leaves typing and editor shortcuts alone", () => {
    expect(isReservedBrowserKey(key("r", "KeyR"))).toBe(false);
    expect(isReservedBrowserKey(key("f", "KeyF"))).toBe(false);
    expect(isReservedBrowserKey(key("P", "KeyP", { ctrl: true, shift: true }))).toBe(false); // command palette
    expect(isReservedBrowserKey(key("c", "KeyC", { ctrl: true }))).toBe(false);
  });
});
