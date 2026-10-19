import { describe, expect, it } from "vitest";

import { availableLocales } from "../i18n";
import { parseChord } from "../commands/keymap";
import { SHORTCUTS, type CommandId } from "../shortcuts/shortcuts";
import { classifyChange, sameBytes } from "./fileChanges";
import { defaultSettingsText, isValidKeyString, mergeShortcuts, parseSettings, withLocale } from "./settings";

const keysOf = (defs: ReturnType<typeof mergeShortcuts>, command: CommandId) => defs.find((d) => d.command === command)?.keys;

describe("isValidKeyString", () => {
  it("accepts the syntax of shortcuts.ts", () => {
    for (const def of SHORTCUTS) for (const keys of def.keys) expect(isValidKeyString(keys), keys).toBe(true);
    for (const keys of ["b", "Alt+F4", "Ctrl+Shift+KeyQ", "Cmd+Digit1", "F12", "Shift+ArrowUp", "Ctrl+Numpad5"]) {
      expect(isValidKeyString(keys), keys).toBe(true);
    }
  });
  it("rejects garbage", () => {
    for (const keys of ["", " B", "Ctrl+", "Hyper+B", "Ctrl+Ctrl+B", "BB", "F25", "Ctrl+Shift", "Strg+B"]) {
      expect(isValidKeyString(keys), keys).toBe(false);
    }
  });
});

describe("parseSettings", () => {
  it("accepts every advertised locale id", () => {
    for (const { id } of availableLocales()) {
      const { settings, problems } = parseSettings(JSON.stringify({ locale: id }), SHORTCUTS);
      expect(settings.locale).toBe(id);
      expect(problems).toEqual([]);
    }
  });

  it("applies locale and per-command overrides over the defaults", () => {
    const { settings, problems } = parseSettings(
      JSON.stringify({ locale: "en", shortcuts: { "tool.brush": ["P"], "file.close": ["Ctrl+W"], "edit.redo": "Ctrl+Shift+Z" } }),
      SHORTCUTS,
    );
    expect(problems).toEqual([]);
    expect(settings.locale).toBe("en");
    const merged = mergeShortcuts(SHORTCUTS, settings.shortcuts);
    expect(keysOf(merged, "tool.brush")).toEqual(["P"]);
    expect(keysOf(merged, "file.close")).toEqual(["Ctrl+W"]);
    expect(keysOf(merged, "edit.redo")).toEqual(["Ctrl+Shift+Z"]);
    expect(keysOf(merged, "tool.eraser")).toEqual(["E"]);
  });

  it("an empty list unbinds a command", () => {
    const { settings, problems } = parseSettings('{"shortcuts":{"tool.fill":[]}}', SHORTCUTS);
    expect(problems).toEqual([]);
    expect(keysOf(mergeShortcuts(SHORTCUTS, settings.shortcuts), "tool.fill")).toEqual([]);
  });

  it("allows swapping two keys", () => {
    const { settings, problems } = parseSettings('{"shortcuts":{"tool.brush":["E"],"tool.eraser":["B"]}}', SHORTCUTS);
    expect(problems).toEqual([]);
    const merged = mergeShortcuts(SHORTCUTS, settings.shortcuts);
    expect(keysOf(merged, "tool.brush")).toEqual(["E"]);
    expect(keysOf(merged, "tool.eraser")).toEqual(["B"]);
  });

  it("reports and ignores invalid entries, keeping the rest", () => {
    const text = JSON.stringify({
      locale: "not_a_locale",
      color: "blue",
      shortcuts: {
        "tool.nope": ["N"],
        "tool.fill": 5,
        "tool.rect": ["Hyper+R", "Q"],
        "tool.select": ["Strg+S"],
        "view.pan": ["Alt+Space"],
        "tool.eyedropper": ["B"],
      },
    });
    const { settings, problems } = parseSettings(text, SHORTCUTS);
    expect(settings.locale).toBe("tr");
    expect(problems.map((p) => `${p.reason}:${p.entry}`).sort()).toEqual(
      [
        "badKey:shortcuts.tool.rect",
        "badKey:shortcuts.tool.select",
        "conflict:shortcuts.tool.eyedropper",
        "fixedKey:shortcuts.view.pan",
        "locale:locale",
        "notKeyList:shortcuts.tool.fill",
        "unknownCommand:shortcuts.tool.nope",
        "unknownField:color",
      ].sort(),
    );
    const merged = mergeShortcuts(SHORTCUTS, settings.shortcuts);
    expect(keysOf(merged, "tool.rect")).toEqual(["Q"]);
    // Every key bad → defaults kept rather than silently unbound.
    expect(keysOf(merged, "tool.select")).toEqual(["S"]);
    expect(keysOf(merged, "tool.fill")).toEqual(["F"]);
    // The conflicting key was dropped; the default holder keeps it.
    expect(keysOf(merged, "tool.eyedropper")).toEqual([]);
    expect(keysOf(merged, "tool.brush")).toEqual(["B"]);
    expect(keysOf(merged, "view.pan")).toEqual(["Space"]);
  });

  it("never throws on broken text", () => {
    for (const text of ["", "{", "[]", "null", '"x"', '{"shortcuts":[]}']) {
      const { settings, problems } = parseSettings(text, SHORTCUTS, "en");
      expect(settings.locale).toBe("en");
      expect(settings.shortcuts.size).toBe(0);
      expect(problems.length).toBeGreaterThan(0);
    }
  });

  it("leaves no chord on two commands", () => {
    const { settings } = parseSettings('{"shortcuts":{"file.close":["Ctrl+S"],"file.export":["Ctrl+G"],"map.resize":["Ctrl+R"]}}', SHORTCUTS);
    const merged = mergeShortcuts(SHORTCUTS, settings.shortcuts);
    const all = merged.flatMap((s) => s.keys.map((k) => JSON.stringify(parseChord(k))));
    expect(new Set(all).size).toBe(all.length);
    expect(keysOf(merged, "map.resize")).toEqual(["Ctrl+R"]);
  });
});

describe("default settings file", () => {
  it("round-trips to no overrides changes", () => {
    const text = defaultSettingsText(SHORTCUTS, "tr");
    expect(text.endsWith("\n")).toBe(true);
    const { settings, problems } = parseSettings(text, SHORTCUTS);
    expect(problems).toEqual([]);
    expect(mergeShortcuts(SHORTCUTS, settings.shortcuts)).toEqual(SHORTCUTS);
  });

  it("withLocale keeps the user's shortcuts and refuses to overwrite a broken file", () => {
    const next = withLocale('{"shortcuts":{"tool.brush":["P"]},"locale":"tr"}', "en", SHORTCUTS);
    expect(JSON.parse(next ?? "")).toEqual({ shortcuts: { "tool.brush": ["P"] }, locale: "en" });
    expect(withLocale("{ broken", "en", SHORTCUTS)).toBeNull();
    expect(JSON.parse(withLocale(null, "en", SHORTCUTS) ?? "").locale).toBe("en");
  });
});

describe("file change hints", () => {
  it("classifies project paths", () => {
    expect(classifyChange({ path: "tilesets/grass.png", kind: "modified" })).toBe("tileset");
    expect(classifyChange({ path: "tilesets/Grass.PNG", kind: "created" })).toBe("tileset");
    expect(classifyChange({ path: "tilesets/grass.png", kind: "removed" })).toBe("ignore");
    expect(classifyChange({ path: "levels/main.json", kind: "modified" })).toBe("level");
    expect(classifyChange({ path: "project.smap", kind: "modified" })).toBe("level");
    expect(classifyChange({ path: "backups/main-1.json", kind: "modified" })).toBe("ignore");
  });
  it("compares bytes", () => {
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(sameBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe("formatSettings", () => {
  it("writes one line per shortcut and stays valid JSON", async () => {
    const { formatSettings } = await import("./settings");
    const value = { locale: "tr", shortcuts: { "tool.brush": ["B"], "edit.redo": ["Ctrl+Y", "Ctrl+Shift+Z"], "tool.fill": [] }, $note: { a: [1] } };
    const text = formatSettings(value);
    expect(JSON.parse(text)).toEqual(value);
    expect(text).toContain('    "edit.redo": ["Ctrl+Y", "Ctrl+Shift+Z"],\n');
    expect(text).toContain('    "tool.fill": []\n');
    expect(JSON.parse(formatSettings({ shortcuts: {} }))).toEqual({ shortcuts: {} });
  });
});
