import { describe, expect, it } from "vitest";

import { deriveSaveIndicator, type SaveIndicatorInput } from "./saveIndicator";

const base: SaveIndicatorInput = {
  hasProject: true,
  dirty: false,
  dirtyLevelCount: 0,
  saving: false,
  failed: false,
  lastSavedAt: null,
  hasFolder: false,
};
const at = (patch: Partial<SaveIndicatorInput>) => deriveSaveIndicator({ ...base, ...patch });

describe("save indicator (title dot, window title, status bar)", () => {
  it("never says saved while there are unsaved changes", () => {
    // Round 3 bug: "●" in the title, "Kaydedildi · 12:04" in the status bar.
    const s = at({ dirty: true, lastSavedAt: 1000, hasFolder: true });
    expect(s.unsaved).toBe(true);
    expect(s.text).toBe("notSaved");
  });

  it("says saved with the time once everything is written", () => {
    expect(at({ lastSavedAt: 1000, hasFolder: true })).toEqual({ unsaved: false, text: "savedAt", lastSavedAt: 1000 });
  });

  it("counts unsaved levels even when the editor flag is clear", () => {
    expect(at({ dirtyLevelCount: 1, lastSavedAt: 1000, hasFolder: true })).toMatchObject({ unsaved: true, text: "notSaved" });
  });

  it("shows saving and failure, and nothing for a fresh untouched project", () => {
    expect(at({ dirty: true, saving: true }).text).toBe("saving");
    expect(at({ dirty: true, failed: true }).text).toBe("saveFailed");
    expect(at({})).toEqual({ unsaved: false, text: null, lastSavedAt: null });
    expect(at({ hasProject: false, dirty: true })).toEqual({ unsaved: false, text: null, lastSavedAt: null });
  });

  it("ignores a save time from a previous folder", () => {
    expect(at({ lastSavedAt: 1000, hasFolder: false }).text).toBeNull();
  });
});
