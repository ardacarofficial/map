import { create } from "zustand";
import type { PointerEvent as ReactPointerEvent } from "react";

import { useEditorStore } from "../../state/editorStore";
import { isZoneId, type DockDestination, type PanelId } from "./dockModel";
import { useDockStore } from "./dockStore";

interface Drop { destination: DockDestination; rect: { x: number; y: number; width: number; height: number }; caret: boolean }
interface DragState { panel: PanelId | null; drop: Drop | null }
export const useDockDrag = create<DragState>(() => ({ panel: null, drop: null }));
function hitTest(x: number, y: number): Drop | null {
  const hit = document.elementFromPoint(x, y);
  // Splitters extend outside their owner. Prefer the zone geometrically
  // under the pointer so a neighbouring splitter cannot steal an edge drop.
  const geometric = [...document.querySelectorAll<HTMLElement>("[data-dock-zone]")].find(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  });
  const zoneEl = hit?.closest<HTMLElement>("[data-dock-drop-zone]") ?? geometric ?? hit?.closest<HTMLElement>("[data-dock-zone]");
  const zone = zoneEl?.dataset.dockZone ?? zoneEl?.dataset.dockDropZone;
  if (!zoneEl || !isZoneId(zone)) return null;
  const box = zoneEl.getBoundingClientRect();
  const rect = { x: box.x, y: box.y, width: box.width, height: box.height };
  const belongsToZone = hit?.closest("[data-dock-zone]") === zoneEl;
  const strip = belongsToZone ? hit?.closest<HTMLElement>("[data-dock-strip]") : null;
  const atSplitEdge = zone === "bottom" ? Math.min(x - box.left, box.right - x) < 6 : Math.min(y - box.top, box.bottom - y) < 6;
  if (strip && !atSplitEdge) {
    const tabs = [...strip.querySelectorAll<HTMLElement>("[data-panel-tab]")];
    const vertical = zoneEl.dataset.zoneState === "collapsed" && zone !== "bottom";
    let index = tabs.findIndex(tab => {
      const r = tab.getBoundingClientRect(); return vertical ? y < r.y + r.height / 2 : x < r.x + r.width / 2;
    });
    if (index < 0) index = tabs.length;
    const tab = tabs[index] ?? tabs.at(-1);
    const b = tab?.getBoundingClientRect() ?? strip.getBoundingClientRect();
    const groupIndex = Number(strip.dataset.dockStrip);
    const groupTabs = useDockStore.getState().layout.zones[zone].groups[groupIndex]?.tabs ?? [];
    const neighbour = tabs[index]?.dataset.panelTab ?? tabs.at(-1)?.dataset.panelTab;
    const modelIndex = neighbour ? groupTabs.findIndex(p => p === neighbour) + (index === tabs.length ? 1 : 0) : groupTabs.length;
    return { destination: { zone, group: groupIndex, index: Math.max(0, modelIndex) }, rect: vertical ? { x: b.x, y: index === tabs.length ? b.bottom : b.y, width: b.width, height: 0 } : { x: index === tabs.length ? b.right : b.x, y: b.y, width: 0, height: b.height }, caret: true };
  }
  // Zone-edge split targets are deliberately smaller than a tab strip.
  const horizontal = zone === "bottom";
  const start = horizontal ? x - box.left : y - box.top;
  const end = horizontal ? box.right - x : box.bottom - y;
  const edge = Number.parseFloat(getComputedStyle(zoneEl).getPropertyValue("--dock-drop-edge")) || 24;
  if (start < edge || end < edge) {
    const split = start < end ? "start" : "end";
    return { destination: { zone, split }, rect: horizontal ? { ...rect, x: split === "start" ? box.x : box.right - edge, width: edge } : { ...rect, y: split === "start" ? box.y : box.bottom - edge, height: edge }, caret: false };
  }
  const group = belongsToZone ? hit?.closest<HTMLElement>("[data-dock-group]") : null;
  const b = group?.getBoundingClientRect() ?? box;
  return { destination: { zone, group: Number(group?.dataset.dockGroup ?? 0) }, rect: { x: b.x, y: b.y, width: b.width, height: b.height }, caret: false };
}
/** Source remains unchanged until a valid release. Esc/cancel/outside never mutate layout. */
export function startPanelDrag(event: ReactPointerEvent<HTMLButtonElement>, panel: PanelId): void {
  if (event.button !== 0 || useEditorStore.getState().project?.store.inTransaction) return;
  const source = event.currentTarget;
  const pointerId = event.pointerId;
  const startX = event.clientX, startY = event.clientY;
  let active = false;
  let finished = false;
  source.setPointerCapture(pointerId);
  useDockStore.getState().beginGesture();
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (!active && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
    active = true;
    e.preventDefault();
    useDockDrag.setState({ panel, drop: hitTest(e.clientX, e.clientY) });
  };
  const cleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", cancel);
    document.removeEventListener("keydown", key, true);
    source.removeEventListener("lostpointercapture", cancel);
    if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
    useDockDrag.setState({ panel: null, drop: null });
    useDockStore.getState().endGesture();
  };
  const swallowClick = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const finish = (drop: Drop | null) => {
    if (finished) return;
    finished = true;
    if (active) {
      source.addEventListener("click", swallowClick, { capture: true, once: true });
      // A canceled pointer may generate no click; do not swallow a later deliberate click.
      setTimeout(() => source.removeEventListener("click", swallowClick, true), 0);
    }
    if (active && drop) useDockStore.getState().move(panel, drop.destination);
    cleanup();
  };
  const up = (e: PointerEvent) => { if (e.pointerId === pointerId) finish(hitTest(e.clientX, e.clientY)); };
  const cancel = () => finish(null);
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } };
  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", cancel);
  document.addEventListener("keydown", key, true);
  source.addEventListener("lostpointercapture", cancel);
}
export function DockDropIndicator() {
  const drop = useDockDrag(s => s.drop);
  if (!drop) return null;
  return <div aria-hidden data-dock-indicator className={drop.caret ? "dock-insertion" : "dock-drop-indicator"} style={{ left: drop.rect.x, top: drop.rect.y, width: drop.rect.width || "var(--dock-caret)", height: drop.rect.height || "var(--dock-caret)" }} />;
}
