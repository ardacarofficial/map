import { describe, expect, it } from "vitest";
import { defaultDockLayout, hidePanel, locatePanel, movePanel, normalizeLayout, revealInLayout } from "../layout/dockModel";

describe("optional AI activity dock", () => {
  it("stays hidden on first use and old layouts, then opens beside Recent", () => {
    const initial = defaultDockLayout();
    expect(initial.hiddenPanels).toContain("aiActivity");
    expect(locatePanel(initial, "aiActivity")).toBeNull();
    const old = { ...initial, hiddenPanels: [], hiddenHomes: {} };
    const normalized = normalizeLayout(old)!;
    expect(normalized.hiddenPanels).toContain("aiActivity");
    const visible = revealInLayout(normalized, "aiActivity");
    expect(locatePanel(visible, "aiActivity")?.zone).toBe("bottom");
    expect(visible.zones.bottom.groups[0]?.tabs).toEqual(["recent", "aiActivity"]);
  });
  it("restores a moved activity panel's home after hide and reload", () => {
    const moved = movePanel(defaultDockLayout(), "aiActivity", { zone: "right", split: "end" });
    const restored = revealInLayout(normalizeLayout(hidePanel(moved, "aiActivity"))!, "aiActivity");
    expect(locatePanel(restored, "aiActivity")).toEqual(locatePanel(moved, "aiActivity"));
  });
});
