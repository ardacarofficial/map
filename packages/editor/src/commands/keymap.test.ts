import { afterEach, describe, expect, it } from "vitest";

import { keysFor, SHORTCUTS } from "../shortcuts/shortcuts";
import { formatChord, isReachable, matchesChord, parseChord, setKeyboardLayout } from "./keymap";
import { commandForEvent } from "./registry";

const ev = (code: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({
  code,
  ctrlKey: mods.ctrl ?? false,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe("keymap", () => {
  it("parses key strings into codes", () => {
    expect(parseChord("B")).toEqual({ ctrl: false, shift: false, alt: false, code: "KeyB" });
    expect(parseChord("Ctrl+Shift+P")).toEqual({ ctrl: true, shift: true, alt: false, code: "KeyP" });
    expect(parseChord("Ctrl+Digit0").code).toBe("Digit0");
    expect(parseChord("Space").code).toBe("Space");
  });

  it("matches Ctrl or Cmd, and requires exact modifiers", () => {
    const chord = parseChord("Ctrl+K");
    expect(matchesChord(ev("KeyK", { ctrl: true }), chord)).toBe(true);
    expect(matchesChord(ev("KeyK", { meta: true }), chord)).toBe(true);
    expect(matchesChord(ev("KeyK"), chord)).toBe(false);
    expect(matchesChord(ev("KeyK", { ctrl: true, shift: true }), chord)).toBe(false);
  });

  it("formats chords for display", () => {
    expect(formatChord("Ctrl+K")).toBe("Ctrl K");
    expect(formatChord("Ctrl+Shift+P")).toBe("Ctrl Shift P");
    expect(formatChord("Ctrl+Equal")).toBe("Ctrl =");
    expect(formatChord("Ctrl+Plus")).toBe("Ctrl +");
    expect(formatChord("Ctrl+Minus")).toBe("Ctrl −");
    expect(formatChord("Ctrl+K", true)).toBe("⌘ K");
  });

  it("maps events to commands from the shortcut list", () => {
    expect(commandForEvent(ev("KeyB"))).toBe("tool.brush");
    expect(commandForEvent(ev("KeyE"))).toBe("tool.eraser");
    expect(commandForEvent(ev("KeyK", { ctrl: true }))).toBe("palette.open");
    expect(commandForEvent(ev("KeyP", { ctrl: true, shift: true }))).toBe("palette.open");
    expect(commandForEvent(ev("KeyS", { ctrl: true }))).toBe("file.save");
    expect(commandForEvent(ev("KeyS", { ctrl: true, shift: true }))).toBe("file.saveAs");
    expect(commandForEvent(ev("KeyB", { ctrl: true }))).toBe("view.toggleLibrary");
    expect(commandForEvent(ev("KeyQ", { ctrl: true }))).toBeNull();
  });

  it("scopes tileset clipboard and rename without stealing map bindings", () => {
    for (const [key, id] of [["KeyC", "copy"], ["KeyX", "cut"], ["KeyV", "paste"]]) {
      expect(commandForEvent(ev(key!, { ctrl: true }), "tileset")).toBe(`tileset.${id}`);
      expect(commandForEvent(ev(key!, { ctrl: true }))).toBe(`edit.${id}`);
    }
    expect(commandForEvent(ev("F2"), "tileset")).toBe("tileset.rename");
    expect(commandForEvent(ev("F2"))).toBe("layer.rename");
  });

  it("has no duplicate bindings", () => {
    const all = SHORTCUTS.flatMap((s) => s.keys.map((k) => JSON.stringify([s.scope ?? "global", parseChord(k)])));
    expect(new Set(all).size).toBe(all.length);
  });
});

/** A key event as a browser reports it: `key` is the typed character, `code` the physical key. */
const typed = (
  key: string,
  code: string,
  mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; altGraph: boolean }> = {},
) => ({
  key,
  code,
  ctrlKey: mods.ctrl ?? mods.altGraph ?? false,
  metaKey: false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? mods.altGraph ?? false,
  getModifierState: (name: string) => name === "AltGraph" && (mods.altGraph ?? false),
});

/** Unshifted characters of Turkish-Q (what `navigator.keyboard.getLayoutMap()` returns, abridged). */
const TURKISH_Q = new Map([
  ["KeyQ", "q"], ["KeyW", "w"], ["KeyE", "e"], ["KeyR", "r"], ["KeyT", "t"], ["KeyY", "y"], ["KeyU", "u"], ["KeyI", "ı"],
  ["KeyO", "o"], ["KeyP", "p"], ["BracketLeft", "ğ"], ["BracketRight", "ü"], ["KeyA", "a"], ["KeyS", "s"], ["KeyD", "d"],
  ["KeyF", "f"], ["KeyG", "g"], ["KeyH", "h"], ["KeyJ", "j"], ["KeyK", "k"], ["KeyL", "l"], ["Semicolon", "ş"], ["Quote", "i"],
  ["Backslash", ","], ["KeyZ", "z"], ["KeyX", "x"], ["KeyC", "c"], ["KeyV", "v"], ["KeyB", "b"], ["KeyN", "n"], ["KeyM", "m"],
  ["Comma", "ö"], ["Period", "ç"], ["Slash", "."], ["Minus", "*"], ["Equal", "-"], ["Backquote", "\""],
  ...[..."1234567890"].map((d) => [`Digit${d}`, d] as [string, string]),
]);

describe("layout-aware shortcuts (Turkish-Q)", () => {
  afterEach(() => setKeyboardLayout(null));

  it("zooms with Ctrl+'+' and Ctrl+'-' wherever those characters are", () => {
    // TR: "+" is Shift+4, "-" sits on the US "=" key, "*" on the US "-" key.
    expect(commandForEvent(typed("+", "Digit4", { ctrl: true, shift: true }))).toBe("view.zoomIn");
    expect(commandForEvent(typed("-", "Equal", { ctrl: true }))).toBe("view.zoomOut");
    expect(commandForEvent(typed("*", "Minus", { ctrl: true }))).toBeNull();
    // US: Ctrl+= and Ctrl+Shift+= ("+") both zoom in, Ctrl+- zooms out.
    expect(commandForEvent(typed("=", "Equal", { ctrl: true }))).toBe("view.zoomIn");
    expect(commandForEvent(typed("+", "Equal", { ctrl: true, shift: true }))).toBe("view.zoomIn");
    expect(commandForEvent(typed("-", "Minus", { ctrl: true }))).toBe("view.zoomOut");
  });

  it("zooms with the numpad, NumLock on or off", () => {
    expect(commandForEvent(typed("+", "NumpadAdd", { ctrl: true }))).toBe("view.zoomIn");
    expect(commandForEvent(typed("-", "NumpadSubtract", { ctrl: true }))).toBe("view.zoomOut");
    expect(commandForEvent(typed("0", "Numpad0", { ctrl: true }))).toBe("view.zoomReset");
    expect(commandForEvent(typed("Insert", "Numpad0", { ctrl: true }))).toBe("view.zoomReset");
  });

  it("matches letters by character, and by key position for non-Latin characters", () => {
    // TR "i" is on the US quote key; "ı" on the US I key: both pick the eyedropper.
    expect(commandForEvent(typed("i", "Quote"))).toBe("tool.eyedropper");
    expect(commandForEvent(typed("ı", "KeyI"))).toBe("tool.eyedropper");
    // Cyrillic layout: Ctrl+"я" on the Z key is still undo.
    expect(commandForEvent(typed("я", "KeyZ", { ctrl: true }))).toBe("edit.undo");
    // AZERTY: "z" is on the US W key; the character wins.
    expect(commandForEvent(typed("z", "KeyW", { ctrl: true }))).toBe("edit.undo");
  });

  it("changes the brush size with AltGr brackets, ğ/ü and , .", () => {
    expect(commandForEvent(typed("[", "Digit8", { altGraph: true }))).toBe("brush.smaller");
    expect(commandForEvent(typed("]", "Digit9", { altGraph: true }))).toBe("brush.larger");
    expect(commandForEvent(typed("ğ", "BracketLeft"))).toBe("brush.smaller");
    expect(commandForEvent(typed("ü", "BracketRight"))).toBe("brush.larger");
    expect(commandForEvent(typed(",", "Backslash"))).toBe("brush.smaller");
    expect(commandForEvent(typed(".", "Slash"))).toBe("brush.larger");
    // Ctrl+ğ / Ctrl+ü move layers (Ctrl+[ ] on US).
    expect(commandForEvent(typed("ğ", "BracketLeft", { ctrl: true }))).toBe("layer.moveDown");
  });

  it("keeps digits and named keys on their physical key", () => {
    expect(commandForEvent(typed("!", "Digit1", { shift: true }))).toBe("view.frameMap");
    expect(commandForEvent(typed("F2", "F2"))).toBe("layer.rename");
    expect(commandForEvent(typed("Tab", "Tab"))).toBe("view.togglePanels");
  });

  it("shows keys reachable on the layout", () => {
    setKeyboardLayout(TURKISH_Q);
    expect(isReachable("BracketLeft")).toBe(true); // via ğ
    expect(formatChord("BracketLeft")).toBe("Ğ");
    expect(formatChord("Ctrl+BracketRight")).toBe("Ctrl Ü");
    expect(formatChord("Ctrl+Plus")).toBe("Ctrl +");
    expect(keysFor("view.zoomIn")[0]).toBe("Ctrl+Plus");
    setKeyboardLayout(new Map([["KeyA", "a"], ["Comma", ","]]));
    expect(isReachable("BracketLeft")).toBe(false);
    expect(keysFor("brush.smaller")[0]).toBe("Comma");
    setKeyboardLayout(null);
    expect(formatChord("BracketLeft")).toBe("[");
    expect(keysFor("brush.smaller")[0]).toBe("BracketLeft");
  });
});
