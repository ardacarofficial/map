import { describe, expect, it } from "vitest";

import { SHORTCUTS } from "../shortcuts/shortcuts";
import { formatChord, matchesChord, parseChord } from "./keymap";
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
    expect(formatChord("Ctrl+Equal")).toBe("Ctrl +");
    expect(formatChord("Ctrl+K", true)).toBe("⌘ K");
  });

  it("maps events to commands from the shortcut list", () => {
    expect(commandForEvent(ev("KeyB"))).toBe("tool.brush");
    expect(commandForEvent(ev("KeyE"))).toBe("tool.eraser");
    expect(commandForEvent(ev("KeyK", { ctrl: true }))).toBe("palette.open");
    expect(commandForEvent(ev("KeyP", { ctrl: true, shift: true }))).toBe("palette.open");
    expect(commandForEvent(ev("KeyS", { ctrl: true }))).toBe("file.save");
    expect(commandForEvent(ev("KeyS", { ctrl: true, shift: true }))).toBe("file.saveAs");
    expect(commandForEvent(ev("KeyB", { ctrl: true }))).toBeNull();
  });

  it("has no duplicate bindings", () => {
    const all = SHORTCUTS.flatMap((s) => s.keys.map((k) => JSON.stringify(parseChord(k))));
    expect(new Set(all).size).toBe(all.length);
  });
});
