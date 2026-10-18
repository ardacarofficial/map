import { modalOpen } from "../../commands/modal";

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

const targets: Record<FocusRegion, string> = {
  canvas: "[data-canvas-host]",
  dock: "[data-tileset-viewport]",
  inspector: "[data-right-tab][aria-selected=true]",
  layers: "[data-layers-list]",
  library: "[data-left-panel] [role=tab][aria-selected=true]",
};
const containers: Record<FocusRegion, string> = {
  canvas: "[data-canvas-host]",
  dock: "[data-dock]",
  inspector: "[data-section=properties]",
  layers: "[data-section=layers]",
  library: "[data-left-panel]",
};

export function focusRegion(direction: 1 | -1): void {
  if (modalOpen() || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
  // Any dialog that holds focus (e.g. "Stamp olarak kaydet") keeps it: F6 never escapes behind it.
  if (document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')) return;
  const visible = (element: HTMLElement) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  const found = new Map<FocusRegion, HTMLElement>();
  for (const region of FOCUS_REGIONS) {
    const el = [...document.querySelectorAll<HTMLElement>(targets[region])].find(visible);
    // A folded dock retains its tabs but isn't a grid region.
    if (el && !(region === "dock" && !document.querySelector<HTMLElement>("[data-tileset-viewport]")?.getClientRects().length)) found.set(region, el);
  }
  const current = FOCUS_REGIONS.find(region => document.activeElement?.closest(containers[region])) ?? null;
  const next = nextFocusRegion(current, [...found.keys()], direction);
  if (!next) return;
  const target = found.get(next)!;
  if (next === "canvas") target.dataset.focusInset = "";
  target.focus({ preventScroll: true });
}
