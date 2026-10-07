import { create } from "zustand";

/**
 * Panel/dialog state that only the React UI cares about (the canvas never
 * reads it). Shared editor state lives in `state/editorStore.ts`.
 */
export interface UiState {
  panelsHidden: boolean;
  paletteOpen: boolean;
  newProjectOpen: boolean;
  /** Tileset shown in the tileset panel. */
  activeTilesetId: string | null;
  /** True while a save/open is running (disables repeated triggers). */
  busy: boolean;
  /** True while files are being dragged over the window. */
  draggingFiles: boolean;

  togglePanels(): void;
  setPaletteOpen(open: boolean): void;
  setNewProjectOpen(open: boolean): void;
  setActiveTileset(id: string | null): void;
  setBusy(busy: boolean): void;
  setDraggingFiles(dragging: boolean): void;
}

export const useUiStore = create<UiState>()((set) => ({
  panelsHidden: false,
  paletteOpen: false,
  newProjectOpen: false,
  activeTilesetId: null,
  busy: false,
  draggingFiles: false,

  togglePanels: () => set((s) => ({ panelsHidden: !s.panelsHidden })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setActiveTileset: (activeTilesetId) => set({ activeTilesetId }),
  setBusy: (busy) => set({ busy }),
  setDraggingFiles: (draggingFiles) => set({ draggingFiles }),
}));
