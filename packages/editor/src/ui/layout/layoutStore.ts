import { create } from "zustand";

import {
  clampWidth,
  clearWidth,
  COLUMNS,
  defaultLibraryWidth,
  LIBRARY_COLLAPSED_KEY,
  readFlag,
  readStoredWidth,
  readWidth,
  widenLibraryTarget,
  writeFlag,
  writeWidth,
  type ColumnId,
  type WidthStorage,
} from "./columns";
import { DEFAULT_SECTIONS, readSections, writeSections, type SectionId, type SectionsState } from "./sections";

function storage(): WidthStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** localStorage key of the right column's hidden flag. */
export const INSPECTOR_COLLAPSED_KEY = "smap.layout.inspectorCollapsed";
/** localStorage key of the bottom dock's hidden flag (was the recent tiles strip). */
export const RECENT_HIDDEN_KEY = "smap.layout.recentHidden";
/** localStorage key of the bottom dock's height. */
export const DOCK_HEIGHT_KEY = "smap.layout.dockHeight";
/** localStorage key of the left panel the rail shows. */
export const LEFT_PANEL_KEY = "smap.layout.leftPanel";
/** localStorage key of the rulers flag. */
export const RULERS_HIDDEN_KEY = "smap.layout.rulersHidden";

/**
 * Bottom dock height (CSS px, tab strip included): the range a drag may
 * reach, and the range of the default height ({@link defaultDockHeight}).
 */
export const DOCK = { initial: 180, min: 96, max: 480, autoMax: 340 } as const;

/**
 * Space the editor keeps for everything but the dock (app bar, tabs, tool
 * bar, status bar ≈ 146 px, canvas ≈ 445 px): the default dock grows into
 * what is left.
 */
const DOCK_RESERVE = 590;

/**
 * Default dock height for a window `viewportHeight` px tall: as tall as the
 * canvas can spare (it keeps ≈ 445 px), between 180 and 340 px — a whole
 * 8 × 8 tileset of 32 px tiles from 900 px up, the canvas first below that.
 */
export function defaultDockHeight(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight)) return DOCK.initial;
  return Math.min(DOCK.autoMax, Math.max(DOCK.initial, Math.round(viewportHeight - DOCK_RESERVE)));
}

/** The dock height to lay out: the user's (dragged) height, or the default for the window. */
export function effectiveDockHeight(dockHeight: number | null, viewportHeight: number): number {
  return dockHeight ?? defaultDockHeight(viewportHeight);
}

/** What the left column shows (rail buttons): the library, or the project tree on its own. */
export type LeftPanel = "library" | "project";
/** Right column tabs. */
export type RightTab = "inspector" | "history";

export function clampDockHeight(value: number): number {
  if (!Number.isFinite(value)) return DOCK.initial;
  return Math.min(DOCK.max, Math.max(DOCK.min, Math.round(value)));
}

function readDockHeight(s: WidthStorage | null): number | null {
  try {
    const raw = s?.getItem(DOCK_HEIGHT_KEY);
    if (raw == null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? clampDockHeight(value) : null;
  } catch {
    return null;
  }
}

function readLeftPanel(s: WidthStorage | null): LeftPanel {
  try {
    return s?.getItem(LEFT_PANEL_KEY) === "project" ? "project" : "library";
  } catch {
    return "library";
  }
}

function writeRaw(s: WidthStorage | null, key: string, value: string): void {
  try {
    s?.setItem(key, value);
  } catch {
    // Not remembered.
  }
}

/**
 * Sizes and visibility of the editor frame that only the layout cares
 * about: column widths, which columns / sections are shown, folded or how
 * tall they were dragged. Remembered per browser (localStorage), like a
 * window layout. Nothing here moves on its own: every change is the user's.
 */
export interface LayoutState {
  /** Library width; null = the default for the window width ({@link defaultLibraryWidth}). */
  libraryWidth: number | null;
  rightWidth: number;
  libraryCollapsed: boolean;
  /** Right column (Denetçi | Geçmiş · Katmanlar) hidden. */
  inspectorCollapsed: boolean;
  /** Bottom dock (Tileset | Son kullanılanlar) under the canvas hidden. */
  recentHidden: boolean;
  /** Bottom dock height the user dragged (CSS px); null = the default for the window ({@link effectiveDockHeight}). */
  dockHeight: number | null;
  /** Selected bottom dock tab id (null = the first registered). */
  dockTab: string | null;
  /** What the left column shows. */
  leftPanel: LeftPanel;
  /** Selected right column tab. */
  rightTab: RightTab;
  /** Rulers along the canvas' top and left edges. */
  rulersVisible: boolean;
  sections: SectionsState;
  /** Sets a column width (clamped) without storing it (during a drag). */
  setWidth(column: ColumnId, width: number): void;
  /** Stores the current width of a column (end of a drag). */
  commitWidth(column: ColumnId): void;
  /** Back to the default width (double-click on the handle). */
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
  setSectionHeight(id: SectionId, height: number | null, commit?: boolean): void;
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

/** The library width the layout asks for. */
export function wantedLibraryWidth(s: Pick<LayoutState, "libraryWidth">, viewport: number): number {
  return s.libraryWidth ?? defaultLibraryWidth(viewport);
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 1366 : window.innerWidth;
}

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  libraryWidth: readStoredWidth(COLUMNS.library, storage()),
  rightWidth: readWidth(COLUMNS.right, storage()),
  libraryCollapsed: readFlag(LIBRARY_COLLAPSED_KEY, storage()),
  inspectorCollapsed: readFlag(INSPECTOR_COLLAPSED_KEY, storage()),
  recentHidden: readFlag(RECENT_HIDDEN_KEY, storage()),
  dockHeight: readDockHeight(storage()),
  dockTab: null,
  leftPanel: readLeftPanel(storage()),
  rightTab: "inspector",
  rulersVisible: !readFlag(RULERS_HIDDEN_KEY, storage()),
  sections: readSections(storage()),
  setWidth: (column, width) =>
    column === "library" ? set({ libraryWidth: clampWidth(COLUMNS.library, width) }) : set({ rightWidth: clampWidth(COLUMNS.right, width) }),
  commitWidth: (column) => {
    if (column === "right") writeWidth(COLUMNS.right, storage(), get().rightWidth);
    else writeWidth(COLUMNS.library, storage(), wantedLibraryWidth(get(), viewportWidth()));
  },
  resetWidth: (column) => {
    if (column === "right") {
      set({ rightWidth: COLUMNS.right.initial });
      writeWidth(COLUMNS.right, storage(), COLUMNS.right.initial);
      return;
    }
    set({ libraryWidth: null });
    clearWidth(COLUMNS.library, storage());
  },
  setLibraryCollapsed: (libraryCollapsed) => {
    set({ libraryCollapsed });
    writeFlag(LIBRARY_COLLAPSED_KEY, storage(), libraryCollapsed);
  },
  toggleLibrary: () => get().setLibraryCollapsed(!get().libraryCollapsed),
  setInspectorCollapsed: (inspectorCollapsed) => {
    set({ inspectorCollapsed });
    writeFlag(INSPECTOR_COLLAPSED_KEY, storage(), inspectorCollapsed);
  },
  toggleInspector: () => get().setInspectorCollapsed(!get().inspectorCollapsed),
  setRecentHidden: (recentHidden) => {
    set({ recentHidden });
    writeFlag(RECENT_HIDDEN_KEY, storage(), recentHidden);
  },
  setDockHeight: (height, commit = false) => {
    const dockHeight = height === null ? null : clampDockHeight(height);
    if (dockHeight !== get().dockHeight) set({ dockHeight });
    if (commit) writeRaw(storage(), DOCK_HEIGHT_KEY, dockHeight === null ? "" : String(dockHeight));
  },
  setDockTab: (dockTab) => set({ dockTab }),
  showLeftPanel: (panel) => {
    const s = get();
    if (s.leftPanel === panel && !s.libraryCollapsed) {
      s.setLibraryCollapsed(true);
      return;
    }
    set({ leftPanel: panel });
    writeRaw(storage(), LEFT_PANEL_KEY, panel);
    if (s.libraryCollapsed) s.setLibraryCollapsed(false);
  },
  setRightTab: (rightTab) => set({ rightTab }),
  setRulersVisible: (rulersVisible) => {
    set({ rulersVisible });
    writeFlag(RULERS_HIDDEN_KEY, storage(), !rulersVisible);
  },
  setSectionHidden: (id, hidden) => {
    const sections = { ...get().sections, [id]: { ...get().sections[id], hidden } };
    set({ sections });
    writeSections(storage(), sections);
  },
  setSectionCollapsed: (id, collapsed) => {
    const sections = { ...get().sections, [id]: { ...get().sections[id], collapsed } };
    set({ sections });
    writeSections(storage(), sections);
  },
  setSectionHeight: (id, height, commit = false) => {
    const current = get().sections[id];
    if (current.height !== height) set({ sections: { ...get().sections, [id]: { ...current, height } } });
    if (commit) writeSections(storage(), get().sections);
  },
  commitSections: () => writeSections(storage(), get().sections),
  resetLayout: () => {
    set({
      libraryWidth: null,
      rightWidth: COLUMNS.right.initial,
      libraryCollapsed: false,
      inspectorCollapsed: false,
      recentHidden: false,
      dockHeight: null,
      leftPanel: "library",
      rulersVisible: true,
      sections: DEFAULT_SECTIONS,
    });
    const s = storage();
    clearWidth(COLUMNS.library, s);
    writeWidth(COLUMNS.right, s, COLUMNS.right.initial);
    writeFlag(LIBRARY_COLLAPSED_KEY, s, false);
    writeFlag(INSPECTOR_COLLAPSED_KEY, s, false);
    writeFlag(RECENT_HIDDEN_KEY, s, false);
    writeRaw(s, DOCK_HEIGHT_KEY, "");
    writeRaw(s, LEFT_PANEL_KEY, "library");
    writeFlag(RULERS_HIDDEN_KEY, s, false);
    writeSections(s, DEFAULT_SECTIONS);
  },
  widenLibrary: (extra, tilesetId) => {
    if (tilesetId !== undefined) return false;
    const s = get();
    const viewport = viewportWidth();
    const target = widenLibraryTarget(viewport, { library: wantedLibraryWidth(s, viewport), right: s.rightWidth }, extra);
    if (target === null) return false;
    set({ libraryWidth: target });
    writeWidth(COLUMNS.library, storage(), target);
    return true;
  },
}));

/**
 * Makes a section visible and open (and its column shown), e.g. before F2
 * renames a layer or "Özellikler" shows an entity (which also selects the
 * Denetçi tab). "levels" is the library's PROJE tree. Returns true when
 * something had to change.
 */
export function revealSection(id: SectionId): boolean {
  const s = useLayoutStore.getState();
  let changed = false;
  if (id === "levels") {
    if (s.libraryCollapsed) {
      s.setLibraryCollapsed(false);
      changed = true;
    }
    if (s.sections.levels.hidden) {
      s.setSectionHidden("levels", false);
      changed = true;
    }
    if (s.sections.levels.collapsed === true) {
      s.setSectionCollapsed("levels", false);
      changed = true;
    }
    return changed;
  }
  if (id === "properties" && s.rightTab !== "inspector") {
    s.setRightTab("inspector");
    changed = true;
  }
  if (s.inspectorCollapsed) {
    s.setInspectorCollapsed(false);
    changed = true;
  }
  if (s.sections[id].hidden) {
    s.setSectionHidden(id, false);
    changed = true;
  }
  if (s.sections[id].collapsed === true) {
    s.setSectionCollapsed(id, false);
    changed = true;
  }
  return changed;
}
