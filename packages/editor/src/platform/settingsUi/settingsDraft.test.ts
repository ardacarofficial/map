import { expect, it } from "vitest";
import fc from "fast-check";
import { defaultDockLayout, PANEL_IDS, ZONE_IDS, hidePanel, movePanel, orderedPanels } from "../../ui/layout/dockModel";
import { editDraft, draftObject } from "./settingsDraft";

it("shares structured and Advanced drafts, preserves future fields, rejects invalid roots", () => {
  const text = editDraft('{"$future":{"a":1},"locale":"tr"}', { shortcuts: { "tool.brush": [] }, layout: defaultDockLayout() });
  expect(draftObject(text).$future).toEqual({ a: 1 });
  expect(draftObject(text).shortcuts).toEqual({ "tool.brush": [] });
  for (const text of ["{", "[]", "null"]) expect(() => draftObject(text)).toThrow();
});
it("keeps a unique home after arbitrary Settings add/hide/move/reset operations", () => {
  fc.assert(fc.property(fc.array(fc.record({ panel: fc.constantFrom(...PANEL_IDS), zone: fc.constantFrom(...ZONE_IDS), action: fc.integer({ min: 0, max: 4 }) }), { maxLength: 150 }), operations => {
    let layout = defaultDockLayout();
    for (const { panel, zone, action } of operations) {
      layout = action === 0 ? defaultDockLayout() : action === 1 ? hidePanel(layout, panel) : movePanel(layout, panel, { zone, ...(action === 4 ? { split: "end" as const } : {}) });
      const panels = [...ZONE_IDS.flatMap(z => orderedPanels(layout.zones[z])), ...layout.hiddenPanels];
      expect(panels.length).toBe(PANEL_IDS.length);
      expect(new Set(panels).size).toBe(PANEL_IDS.length);
    }
  }));
});
it("keeps unknown future shortcut entries when editing known command overrides", async () => {
  const { editShortcutDraft } = await import("./settingsDraft");
  const text = editShortcutDraft('{"$future":1,"shortcuts":{"future.command":["Ctrl+Q"],"tool.brush":["B"]}}', new Map([["tool.brush", ["Q"]]]));
  expect(draftObject(text)).toEqual({ $future: 1, shortcuts: { "future.command": ["Ctrl+Q"], "tool.brush": ["Q"] } });
});
