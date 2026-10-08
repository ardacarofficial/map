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
/** localStorage key of the recent tiles strip's hidden flag. */
export const RECENT_HIDDEN_KEY = "smap.layout.recentHidden";

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
  /** Right column (Level'lar · Özellik · Katmanlar) hidden. */
  inspectorCollapsed: boolean;
  /** Recent tiles strip under the canvas hidden. */
  recentHidden: boolean;
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
      sections: DEFAULT_SECTIONS,
    });
    const s = storage();
    clearWidth(COLUMNS.library, s);
    writeWidth(COLUMNS.right, s, COLUMNS.right.initial);
    writeFlag(LIBRARY_COLLAPSED_KEY, s, false);
    writeFlag(INSPECTOR_COLLAPSED_KEY, s, false);
    writeFlag(RECENT_HIDDEN_KEY, s, false);
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
 * Makes a right-column section visible and open (and the column shown), e.g.
 * before F2 renames a layer or "Özellikler" shows an entity. Returns true
 * when something had to change.
 */
export function revealSection(id: SectionId): boolean {
  const s = useLayoutStore.getState();
  let changed = false;
  if (s.inspectorCollapsed) {
    s.setInspectorCollapsed(false);
    changed = true;
  }
  if (s.sections[id].hidden) {
    s.setSectionHidden(id, false);
    changed = true;
  }
  if (s.sections[id].collapsed === true || (id === "levels" && s.sections[id].collapsed === null)) {
    s.setSectionCollapsed(id, false);
    changed = true;
  }
  return changed;
}
