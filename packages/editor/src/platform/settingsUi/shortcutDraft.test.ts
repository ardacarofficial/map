import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "../../shortcuts/shortcuts";
import { mergeShortcuts, parseSettings } from "../settings";
import { assignKeys, conflictsFor, compactOverrides, recordedChord, resetCommand } from "./shortcutDraft";

describe("shortcut draft", () => {
  it("detects defaults and every alias, replacing only conflicting keys", () => {
    const draft = new Map();
    expect(conflictsFor(draft, "tool.brush", ["Cmd+Y", "Ctrl+Shift+Z"])).toEqual(["edit.redo"]);
    const next = assignKeys(draft, "tool.brush", ["Ctrl+Y"], true);
    expect(next.get("edit.redo")).toEqual(["Ctrl+Shift+Z"]);
    expect(conflictsFor(next, "tool.brush", ["Ctrl+Y"])).toEqual([]);
    expect(draft.size).toBe(0);
  });
  it("preserves explicit empty arrays, removes defaults, resets conflicting overrides safely", () => {
    let draft = assignKeys(new Map(), "tool.eraser", ["B"], true);
    expect(draft.get("tool.brush")).toEqual([]);
    draft = resetCommand(draft, "tool.brush");
    expect(draft.has("tool.brush")).toBe(false);
    expect(draft.get("tool.eraser")).toEqual([]);
    const json = compactOverrides(new Map([["tool.brush", ["B"]], ["tool.fill", []]]));
    expect(json).toEqual({ "tool.fill": [] });
    expect(mergeShortcuts(SHORTCUTS, parseSettings(JSON.stringify({ shortcuts: json }), SHORTCUTS).settings.shortcuts).find(s => s.command === "tool.fill")?.keys).toEqual([]);
  });
  it.each([
    [{ key: "İ", code: "KeyI" }, "I"],
    [{ key: "ı", code: "KeyI" }, "I"],
    [{ key: "ş", code: "Semicolon" }, "Semicolon"],
    [{ key: "<", code: "IntlBackslash" }, "IntlBackslash"],
    [{ key: "[", code: "Digit8", ctrlKey: true, altKey: true, getModifierState: () => true }, "BracketLeft"],
    [{ key: "-", code: "Equal", ctrlKey: true }, "Ctrl+Minus"],
    [{ key: "Meta", code: "MetaLeft" }, null],
    [{ key: "b", code: "KeyB", repeat: true }, null],
  ])("records layout-aware key %j", (extra, expected) => {
    expect(recordedChord({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra })).toBe(expected);
  });
});

it("compacts only differences from legacy files containing every default binding", () => {
  const legacy = new Map(SHORTCUTS.filter(row => row.command !== "view.pan").map(row => [row.command, row.keys]));
  expect(compactOverrides(legacy)).toEqual({});
});
it("detects numpad aliases of default zoom keys", () => {
  expect(conflictsFor(new Map(), "tool.brush", ["Ctrl+NumpadAdd"])).toContain("view.zoomIn");
});

it("records and matches AltGr characters outside the default punctuation list", async () => {
  const { matchesChord, parseChord } = await import("../../commands/keymap");
  const event = { key: "@", code: "KeyQ", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, getModifierState: () => true };
  const keys = recordedChord(event);
  expect(keys).toBe("@");
  expect(matchesChord(event, parseChord(keys!))).toBe(true);
});
it("uses the actual recorded event to catch physical aliases alongside character bindings", () => {
  const event = { key: "!", code: "Digit1", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true };
  expect(conflictsFor(new Map(), "tool.brush", ["Shift+!"], event)).toContain("view.frameMap");
  expect(assignKeys(new Map(), "tool.brush", ["Shift+!"], true, event).get("view.frameMap")).toEqual([]);
});
it("detects character shortcuts that match with or without Shift, including reset and file defaults", () => {
  const draft = assignKeys(new Map(), "tool.brush", ["Ctrl+Shift+Plus"], true);
  expect(draft.get("view.zoomIn")).toEqual(["Ctrl+Equal"]);
  expect(resetCommand(draft, "view.zoomIn").get("tool.brush")).toEqual([]);
  const parsed = parseSettings('{"shortcuts":{"tool.brush":["Ctrl+Shift+Plus"]}}', SHORTCUTS);
  expect(parsed.problems.some(problem => problem.reason === "conflict")).toBe(true);
  expect(parsed.settings.shortcuts.get("tool.brush")).toEqual([]);
});
