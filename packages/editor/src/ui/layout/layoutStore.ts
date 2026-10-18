/** Compatibility API for callers that predate docking. All state and persistence
 * belong to dockStore; this facade only projects names and forwards actions. */
import { create } from "zustand";
import { COLUMNS, widenLibraryTarget, type ColumnId } from "./columns";
import { clampZoneSize, copyLayout, defaultDockLayout, locatePanel, ZONE_SIZES, type DockLayout, type PanelId } from "./dockModel";
import { revealPanel, useDockStore } from "./dockStore";
import { DEFAULT_SECTIONS, type SectionId, type SectionsState } from "./sections";

export const INSPECTOR_COLLAPSED_KEY = "smap.layout.inspectorCollapsed";
export const RECENT_HIDDEN_KEY = "smap.layout.recentHidden";
export const DOCK_HEIGHT_KEY = "smap.layout.dockHeight";
export const LEFT_PANEL_KEY = "smap.layout.leftPanel";
export const RULERS_HIDDEN_KEY = "smap.layout.rulersHidden";
export const DOCK = ZONE_SIZES.bottom;
export type LeftPanel = "library" | "project";
export type LeftPanelTab = "stamps" | "project";
export type RightTab = "inspector" | "history";
export const clampDockHeight = (value: number): number => clampZoneSize("bottom", value);
export interface LayoutState {
  /** Library width; null = the default for the window width ({@link defaultLibraryWidth}). */
  libraryWidth: number | null;
  rightWidth: number;
  libraryCollapsed: boolean;
  /** Right column (Denetçi | Geçmiş · Katmanlar) hidden. */
  inspectorCollapsed: boolean;
  /** Bottom dock (Tileset | Son kullanılanlar) under the canvas hidden. */
  recentHidden: boolean;
  /** Bottom dock height the user dragged (CSS px); null = the content-based default (dock/contentHeight.ts). */
  dockHeight: number | null;
  /** Selected bottom dock tab id (null = the first registered). */
  dockTab: string | null;
  /** What the left column shows. */
  leftPanel: LeftPanel;
  /** Library tabs, persisted under LEFT_PANEL_KEY; kept in sync with leftPanel (stamps ⇔ library). */
  leftPanelTab: LeftPanelTab;
  /** Selects and persists a tab; opens a collapsed column and never collapses it. */
  setLeftPanelTab(tab: LeftPanelTab): void;
  /** Selected right column tab. */
  rightTab: RightTab;
  /** Rulers along the canvas' top and left edges. */
  rulersVisible: boolean;
  sections: SectionsState;
  /** Sets a column width (clamped) without storing it (during a drag). */
  setWidth(column: ColumnId, width: number): void;
  /** Stores the current width of a column (end of a drag). */
  commitWidth(column: ColumnId): void;
  /** Back to the default width (Home on the handle). */
  resetWidth(column: ColumnId): void;
  setLibraryCollapsed(collapsed: boolean): void;
  toggleLibrary(): void;
  setInspectorCollapsed(collapsed: boolean): void;
  toggleInspector(): void;
  setRecentHidden(hidden: boolean): void;
  /** Sets the dock height (clamped; null = back to the default for the window); `commit` stores it (end of a drag). */
  setDockHeight(height: number | null, commit?: boolean): void;
  setDockTab(id: string): void;
  /**
   * Rail button: shows `panel` in the left column; pressing the panel that
   * is already shown hides the column (VS Code activity bar).
   */
  showLeftPanel(panel: LeftPanel): void;
  setRightTab(tab: RightTab): void;
  setRulersVisible(visible: boolean): void;
  setSectionHidden(id: SectionId, hidden: boolean): void;
  setSectionCollapsed(id: SectionId, collapsed: boolean): void;
  /** Sets a section height (already clamped by the caller); `null` = content height. `commit` stores it. */
  setSectionHeight(id: SectionId, height: number | null, commit?: boolean, startHeight?: number): void;
  /** Restores the pre-resize split (legacy stored layouts fall back to automatic sizing). */
  resetSectionHeight(id: SectionId): void;
  /** Stores the sections state (end of a splitter drag). */
  commitSections(): void;
  /** Everything back to the defaults ("Düzeni sıfırla"). */
  resetLayout(): void;
  /**
   * Widens the library by `extra` CSS px when that fits (see
   * {@link widenLibraryTarget}): the user's explicit "Paneli genişlet".
   * Calls with a tileset id (the old automatic widening) do nothing: the
   * layout never jumps on its own. True when it widened.
   */
  widenLibrary(extra: number, tilesetId?: string): boolean;
}

const panelsForSection = (id: SectionId): PanelId[] => id === "properties" ? ["inspector", "history"] : [id === "levels" ? "project" : "layers"];
function view(layout: DockLayout) {
  const activeLeft = layout.zones.left.groups[0]?.active;
  const sections = {} as SectionsState;
  for (const id of ["levels", "properties", "layers"] as const) {
    const panels = panelsForSection(id), at = locatePanel(layout, panels[0]!);
    sections[id] = { ...DEFAULT_SECTIONS[id], hidden: panels.every(p => layout.hiddenPanels.includes(p)), collapsed: at ? layout.zones[at.zone].groups[at.group]!.collapsed : false };
  }
  return {
    libraryWidth: layout.zones.left.expandedPx, rightWidth: layout.zones.right.expandedPx, dockHeight: layout.zones.bottom.expandedPx,
    libraryCollapsed: layout.zones.left.state !== "expanded", inspectorCollapsed: layout.zones.right.state !== "expanded", recentHidden: layout.zones.bottom.state === "hidden",
    dockTab: layout.zones.bottom.groups[0]?.active ?? null,
    leftPanel: activeLeft === "project" ? "project" as const : "library" as const,
    leftPanelTab: activeLeft === "project" ? "project" as const : "stamps" as const,
    rightTab: Object.values(layout.zones).some(z => z.groups.some(g => g.active === "history")) ? "history" as const : "inspector" as const,
    rulersVisible: layout.rulersVisible, sections,
  };
}
const dock = () => useDockStore.getState();
export const useLayoutStore = create<LayoutState>()(() => ({
  ...view(dock().layout),
  setWidth: (column, px) => dock().setSize(column === "library" ? "left" : "right", px),
  commitWidth: () => dock().commit(),
  resetWidth: column => { const zone = column === "library" ? "left" : "right"; dock().setSize(zone, ZONE_SIZES[zone].initial, true); },
  setLibraryCollapsed: value => dock().setZoneState("left", value ? "collapsed" : "expanded"),
  toggleLibrary: () => dock().toggleZone("left"),
  setInspectorCollapsed: value => dock().setZoneState("right", value ? "collapsed" : "expanded"),
  toggleInspector: () => dock().toggleZone("right"),
  setRecentHidden: value => dock().setZoneState("bottom", value ? "hidden" : "expanded"),
  setDockHeight: (height, commit = false) => dock().setSize("bottom", height ?? DOCK.initial, commit),
  setDockTab: id => { if (id === "tileset" || id === "recent") revealPanel(id); },
  setLeftPanelTab: tab => { revealPanel(tab); },
  showLeftPanel: panel => { revealPanel(panel === "library" ? "stamps" : "project"); },
  setRightTab: tab => { revealPanel(tab); },
  setRulersVisible: visible => dock().update({ ...dock().layout, rulersVisible: visible }),
  setSectionHidden: (id, hidden) => {
    for (const panel of panelsForSection(id).reverse()) { if (hidden) dock().hidePanel(panel); else revealPanel(panel); }
  },
  setSectionCollapsed: (id, collapsed) => {
    const layout = copyLayout(dock().layout);
    for (const panel of panelsForSection(id)) {
      const at = locatePanel(layout, panel);
      if (at) layout.zones[at.zone].groups[at.group]!.collapsed = collapsed;
    }
    dock().update(layout);
  },
  // Legacy px API: project onto the flat group's weight. New chrome works
  // directly in ratios and resets to the default pair instead of content height.
  setSectionHeight: (id, height, commit = false) => {
    const layout = copyLayout(dock().layout), at = locatePanel(layout, panelsForSection(id)[0]!);
    if (!at) return;
    const groups = layout.zones[at.zone].groups;
    const selected = groups[at.group]!;
    const other = groups.find(g => g !== selected);
    if (!other) return;
    const defaults = defaultDockLayout().zones[at.zone].groups.find(g => g.id === selected.id)?.weight ?? .5;
    const fraction = height === null ? defaults : Math.max(.1, Math.min(.9, height / Math.max(1, (typeof window === "undefined" ? 768 : window.innerHeight) - 60)));
    const total = selected.weight + other.weight;
    selected.weight = total * fraction; other.weight = total - selected.weight;
    dock().update(layout, commit);
  },
  resetSectionHeight: id => useLayoutStore.getState().setSectionHeight(id, null, true),
  commitSections: () => dock().commit(),
  resetLayout: () => dock().reset(),
  widenLibrary: (extra, tilesetId) => {
    if (tilesetId !== undefined) return false;
    const viewport = typeof window === "undefined" ? 1366 : window.innerWidth;
    const target = widenLibraryTarget(viewport, { library: dock().layout.zones.left.expandedPx, right: dock().layout.zones.right.expandedPx }, extra);
    if (target === null) return false;
    dock().setSize("left", target, true); return true;
  },
}));
useDockStore.subscribe((state, before) => { if (state.layout !== before.layout) useLayoutStore.setState(view(state.layout)); });
export function wantedLibraryWidth(s: Pick<LayoutState, "libraryWidth">, _viewport: number): number { return s.libraryWidth ?? COLUMNS.library.initial; }
export function revealSection(id: SectionId): boolean { return revealPanel(panelsForSection(id)[0]!); }
