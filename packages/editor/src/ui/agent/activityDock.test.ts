import { describe, expect, it } from "vitest";
import { defaultDockLayout, movePanel } from "../layout/dockModel";
import { activityDockLayout } from "./activityDock";
describe("activity dock reveal", () => {
  it("provides room for the toolbar, table headings and four rows in the compact default bottom dock", () => {
    const next = activityDockLayout(defaultDockLayout());
    expect(next.zones.bottom.expandedPx).toBeGreaterThanOrEqual(176);
    expect(next.zones.bottom.groups[0]?.active).toBe("aiActivity");
  });
  it("keeps custom heights and moved panel homes", () => {
    const saved = defaultDockLayout(); saved.zones.bottom.expandedPx = 230;
    expect(activityDockLayout(saved).zones.bottom.expandedPx).toBe(230);
    const moved = movePanel(defaultDockLayout(), "aiActivity", { zone: "right" });
    expect(activityDockLayout(moved).zones.bottom.expandedPx).toBe(68);
  });
});
