import { create } from "zustand";

import { clampWidth, COLUMNS, LIBRARY_COLLAPSED_KEY, readFlag, readWidth, writeFlag, writeWidth, type ColumnId, type WidthStorage } from "./columns";

function storage(): WidthStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Sizes of the editor frame that only the layout cares about: the widths the
 * user dragged the side columns to, and whether the library is collapsed.
 * Remembered per browser (localStorage), like a window layout.
 */
export interface LayoutState {
  libraryWidth: number;
  rightWidth: number;
  libraryCollapsed: boolean;
  /** Sets a column width (clamped) without storing it (during a drag). */
  setWidth(column: ColumnId, width: number): void;
  /** Stores the current width of a column (end of a drag). */
  commitWidth(column: ColumnId): void;
  /** Back to the initial width (double-click on the handle). */
  resetWidth(column: ColumnId): void;
  setLibraryCollapsed(collapsed: boolean): void;
  toggleLibrary(): void;
}

const field = (column: ColumnId) => (column === "library" ? "libraryWidth" : "rightWidth");

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  libraryWidth: readWidth(COLUMNS.library, storage()),
  rightWidth: readWidth(COLUMNS.right, storage()),
  libraryCollapsed: readFlag(LIBRARY_COLLAPSED_KEY, storage()),
  setWidth: (column, width) => set({ [field(column)]: clampWidth(COLUMNS[column], width) }),
  commitWidth: (column) => writeWidth(COLUMNS[column], storage(), get()[field(column)]),
  resetWidth: (column) => {
    set({ [field(column)]: COLUMNS[column].initial });
    writeWidth(COLUMNS[column], storage(), COLUMNS[column].initial);
  },
  setLibraryCollapsed: (libraryCollapsed) => {
    set({ libraryCollapsed });
    writeFlag(LIBRARY_COLLAPSED_KEY, storage(), libraryCollapsed);
  },
  toggleLibrary: () => get().setLibraryCollapsed(!get().libraryCollapsed),
}));
