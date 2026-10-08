import { create } from "zustand";

import {
  clampWidth,
  clearWidth,
  COLUMNS,
  defaultLibraryWidth,
  LIBRARY_COLLAPSED_KEY,
  LIBRARY_MANUAL_KEY,
  LIBRARY_WIDENED_KEY,
  readFlag,
  readList,
  readStoredWidth,
  readWidth,
  widenLibraryTarget,
  writeFlag,
  writeList,
  writeWidth,
  type ColumnId,
  type WidthStorage,
} from "./columns";

function storage(): WidthStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Keep the "already widened for" list short. */
const MAX_WIDENED = 64;

/**
 * Sizes of the editor frame that only the layout cares about: the widths the
 * user dragged the side columns to, and whether the library is collapsed.
 * Remembered per browser (localStorage), like a window layout.
 */
export interface LayoutState {
  /** Library width; null = the default for the window width ({@link defaultLibraryWidth}). */
  libraryWidth: number | null;
  rightWidth: number;
  libraryCollapsed: boolean;
  /** The user resized the library by hand: auto-widening no longer acts on its own. */
  libraryManual: boolean;
  /** Tileset ids the library was auto-widened for. */
  widenedFor: readonly string[];
  /** Sets a column width (clamped) without storing it (during a drag). */
  setWidth(column: ColumnId, width: number): void;
  /** Stores the current width of a column (end of a drag): a manual size. */
  commitWidth(column: ColumnId): void;
  /** Back to the default width (double-click on the handle). */
  resetWidth(column: ColumnId): void;
  setLibraryCollapsed(collapsed: boolean): void;
  toggleLibrary(): void;
  /**
   * Widens the library by `extra` CSS px when that fits (see
   * {@link widenLibraryTarget}). With a tileset id it is the automatic,
   * once-per-tileset widening and does nothing after a manual resize;
   * without one it is the user's explicit request. True when it widened.
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
  libraryManual: readFlag(LIBRARY_MANUAL_KEY, storage()),
  widenedFor: readList(LIBRARY_WIDENED_KEY, storage()),
  setWidth: (column, width) =>
    column === "library" ? set({ libraryWidth: clampWidth(COLUMNS.library, width) }) : set({ rightWidth: clampWidth(COLUMNS.right, width) }),
  commitWidth: (column) => {
    if (column === "right") {
      writeWidth(COLUMNS.right, storage(), get().rightWidth);
      return;
    }
    writeWidth(COLUMNS.library, storage(), wantedLibraryWidth(get(), viewportWidth()));
    set({ libraryManual: true });
    writeFlag(LIBRARY_MANUAL_KEY, storage(), true);
  },
  resetWidth: (column) => {
    if (column === "right") {
      set({ rightWidth: COLUMNS.right.initial });
      writeWidth(COLUMNS.right, storage(), COLUMNS.right.initial);
      return;
    }
    set({ libraryWidth: null, libraryManual: false });
    clearWidth(COLUMNS.library, storage());
    writeFlag(LIBRARY_MANUAL_KEY, storage(), false);
  },
  setLibraryCollapsed: (libraryCollapsed) => {
    set({ libraryCollapsed });
    writeFlag(LIBRARY_COLLAPSED_KEY, storage(), libraryCollapsed);
  },
  toggleLibrary: () => get().setLibraryCollapsed(!get().libraryCollapsed),
  widenLibrary: (extra, tilesetId) => {
    const s = get();
    if (tilesetId !== undefined && (s.libraryManual || s.widenedFor.includes(tilesetId))) return false;
    const viewport = viewportWidth();
    const target = widenLibraryTarget(viewport, { library: wantedLibraryWidth(s, viewport), right: s.rightWidth }, extra);
    if (target === null) return false;
    const widenedFor = tilesetId === undefined ? s.widenedFor : [...s.widenedFor, tilesetId].slice(-MAX_WIDENED);
    set({ libraryWidth: target, widenedFor });
    writeWidth(COLUMNS.library, storage(), target);
    writeList(LIBRARY_WIDENED_KEY, storage(), widenedFor);
    return true;
  },
}));
