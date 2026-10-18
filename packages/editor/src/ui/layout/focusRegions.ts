import { modalOpen } from "../../commands/modal";
import { isPanelId, ZONE_IDS } from "./dockModel";
import { revealPanel } from "./dockStore";
import { PANELS } from "./panels";

export const FOCUS_REGIONS = ["canvas", "dock", "inspector", "layers", "library"] as const;
export type FocusRegion = typeof FOCUS_REGIONS[number];

/** Wrap in either direction, retaining the canonical order when regions disappear. */
export function nextFocusRegion(current: FocusRegion | null, available: readonly FocusRegion[], direction: 1 | -1): FocusRegion | null {
  const start = current === null ? (direction === 1 ? -1 : 0) : FOCUS_REGIONS.indexOf(current);
  for (let step = 1; step <= FOCUS_REGIONS.length; step++) {
    const region = FOCUS_REGIONS[(start + direction * step + FOCUS_REGIONS.length) % FOCUS_REGIONS.length]!;
    if (available.includes(region)) return region;
  }
  return null;
}

/** Cycle the actual visible groups in physical left/right/bottom order.
 * A collapsed rail remains reachable; revealing it keeps the panel's current home. */
export function focusRegion(direction: 1 | -1): void {
  if (modalOpen() || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
  if (document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')) return;
  const visible = (element: HTMLElement) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  const canvas = document.querySelector<HTMLElement>("[data-canvas-host]");
  const targets: { element: HTMLElement; panel?: string | undefined }[] = canvas ? [{ element: canvas }] : [];
  for (const zone of ZONE_IDS) {
    for (const tab of document.querySelectorAll<HTMLElement>(`[data-dock-zone="${zone}"] [data-panel-tab][aria-selected=true]`)) {
      if (visible(tab)) targets.push({ element: tab, panel: tab.dataset.panelTab });
    }
  }
  if (!targets.length) return;
  const currentPanel = document.activeElement?.closest<HTMLElement>("[data-panel]")?.dataset.panel;
  const currentGroup = document.activeElement?.closest("[data-dock-group]");
  const current = targets.findIndex(target => target.element === document.activeElement || !!(target.panel && target.panel === currentPanel) || !!(currentGroup && currentGroup.contains(target.element)));
  const at = current < 0 ? (direction === 1 ? 0 : targets.length - 1) : (current + direction + targets.length) % targets.length;
  const next = targets[at]!;
  if (next.panel && isPanelId(next.panel)) {
    const panel = next.panel;
    revealPanel(panel);
    requestAnimationFrame(() => {
      const host = document.querySelector<HTMLElement>(`[data-panel="${panel}"]`);
      const target = host?.querySelector<HTMLElement>(PANELS[panel].focus);
      (target && visible(target) ? target : next.element).focus({ preventScroll: true });
    });
  } else {
    next.element.dataset.focusInset = "";
    next.element.focus({ preventScroll: true });
  }
}
