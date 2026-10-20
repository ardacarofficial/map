import { locatePanel, revealInLayout, ZONE_SIZES, type DockLayout } from "../layout/dockModel";
import { revealPanel, useDockStore } from "../layout/dockStore";

export function activityDockLayout(layout: DockLayout): DockLayout {
  const next = revealInLayout(layout, "aiActivity");
  const at = locatePanel(next, "aiActivity");
  if (at?.zone === "bottom" && next.zones.bottom.expandedPx === ZONE_SIZES.bottom.initial) {
    // Tab header + toolbar + table header + four standard 24 px activity rows.
    next.zones.bottom.expandedPx = 28 + 28 + 24 + 4 * 24;
  }
  return next;
}
export function revealAiActivity(): void {
  revealPanel("aiActivity");
  const current = useDockStore.getState().layout;
  const next = activityDockLayout(current);
  if (next.zones.bottom.expandedPx !== current.zones.bottom.expandedPx) useDockStore.getState().update(next);
}
