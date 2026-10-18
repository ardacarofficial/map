import { create } from "zustand";
import { clampZoneSize, copyLayout, defaultDockLayout, hidePanel, locatePanel, movePanel, revealInLayout, type DockDestination, type DockLayout, type PanelId, type ZoneId, type ZoneState } from "./dockModel";
import { layoutStorage, readLayout, writeLayout } from "./layoutPersistence";

interface DockState {
  layout: DockLayout;
  revision: number;
  gestures: number;
  pendingExternal: DockLayout | null;
  update(layout: DockLayout, commit?: boolean): void;
  commit(): void;
  beginGesture(): void;
  endGesture(): void;
  applyExternal(layout: DockLayout): void;
  setZoneState(zone: ZoneId, state: ZoneState): void;
  toggleZone(zone: ZoneId): void;
  setSize(zone: ZoneId, size: number, commit?: boolean): void;
  move(panel: PanelId, destination: DockDestination): void;
  hidePanel(panel: PanelId): void;
  reveal(panel: PanelId): void;
  reset(): void;
}
let revealListener: (() => void) | null = null;
/** Bootstrap restores temporary canvas mode without coupling this model to UI state. */
export function onDockReveal(listener: () => void): void { revealListener = listener; }
let commitListener: ((layout: DockLayout) => void) | null = null;
/** Settings installs one serialized writer after startup has finished reading. */
export function onLayoutCommit(listener: ((layout: DockLayout) => void) | null): void { commitListener = listener; }
export const useDockStore = create<DockState>()((set, get) => ({
  layout: readLayout(layoutStorage()), revision: 0, gestures: 0, pendingExternal: null,
  update: (layout, commit = true) => {
    set({ layout });
    if (commit) get().commit();
  },
  commit: () => {
    const layout = get().layout;
    writeLayout(layoutStorage(), layout);
    set({ revision: get().revision + 1 });
    commitListener?.(layout);
  },
  beginGesture: () => set({ gestures: get().gestures + 1 }),
  endGesture: () => {
    const gestures = Math.max(0, get().gestures - 1);
    set({ gestures });
    if (!gestures && get().pendingExternal) {
      const layout = get().pendingExternal!;
      set({ pendingExternal: null });
      get().applyExternal(layout);
      commitListener?.(layout);
    }
  },
  applyExternal: (layout) => {
    if (get().gestures) { set({ pendingExternal: layout }); return; }
    set({ layout });
    writeLayout(layoutStorage(), layout);
  },
  setZoneState: (zone, state) => {
    if (state === "expanded") revealListener?.();
    const layout = copyLayout(get().layout);
    layout.zones[zone].state = state;
    get().update(layout);
  },
  toggleZone: (zone) => get().setZoneState(zone, get().layout.zones[zone].state === "expanded" ? "collapsed" : "expanded"),
  setSize: (zone, size, commit = false) => {
    const layout = copyLayout(get().layout);
    layout.zones[zone].expandedPx = clampZoneSize(zone, size);
    get().update(layout, commit);
  },
  move: (panel, destination) => { revealListener?.(); get().update(movePanel(get().layout, panel, destination)); },
  hidePanel: (panel) => get().update(hidePanel(get().layout, panel)),
  reveal: (panel) => {
    revealListener?.();
    const before = get().layout;
    const after = revealInLayout(before, panel);
    if (JSON.stringify(before) !== JSON.stringify(after)) get().update(after);
  },
  reset: () => get().update(defaultDockLayout()),
}));
/** Reveal the current or remembered home, including after a panel was hidden. */
export function revealPanel(panel: PanelId): boolean {
  const before = useDockStore.getState().layout;
  const at = locatePanel(before, panel);
  const changed = !at || before.zones[at.zone].state !== "expanded" || before.zones[at.zone].groups[at.group]!.active !== panel || before.zones[at.zone].groups[at.group]!.collapsed;
  useDockStore.getState().reveal(panel);
  return changed;
}
