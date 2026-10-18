import { create } from "zustand";

/**
 * What the library column shows. Built-in tabs: "tileset", "stamps",
 * "entities"; more can be added with `registerLibraryTab` (ui/panels/LibraryPanel).
 */
export type LibraryTab = "tileset" | "stamps" | "entities" | (string & {});

/**
 * Panel/dialog state that only the React UI cares about (the canvas never
 * reads it). Shared editor state lives in `state/editorStore.ts`.
 */
export interface UiState {
  panelsHidden: boolean;
  paletteOpen: boolean;
  newProjectOpen: boolean;
  resizeOpen: boolean;
  backupsOpen: boolean;
  /** Tileset shown in the tileset panel. */
  activeTilesetId: string | null;
  /** True while a save/open is running (disables repeated triggers). */
  busy: boolean;
  /** True while files are being dragged over the window. */
  draggingFiles: boolean;
  /** True while the project passed at start-up is opening (the editor frame shows instead of the welcome screen). */
  startupOpening: boolean;
  libraryTab: LibraryTab;
  saveStampOpen: boolean;
  entityTypesOpen: boolean;
  /** The entity types dialog opens on a new, unsaved type ("Yeni tür"). */
  entityTypesStartNew: boolean;
  /** Type the entity types dialog opens on (null = the first one). */
  entityTypesSelect: string | null;

  togglePanels(): void;
  setPaletteOpen(open: boolean): void;
  setNewProjectOpen(open: boolean): void;
  setResizeOpen(open: boolean): void;
  setBackupsOpen(open: boolean): void;
  setActiveTileset(id: string | null): void;
  setBusy(busy: boolean): void;
  setDraggingFiles(dragging: boolean): void;
  setStartupOpening(opening: boolean): void;
  setLibraryTab(tab: LibraryTab): void;
  setSaveStampOpen(open: boolean): void;
  /** Opens / closes the entity types dialog; `startNew` opens it on a new type. */
  setEntityTypesOpen(open: boolean, startNew?: boolean, selectId?: string | null): void;
}

export const useUiStore = create<UiState>()((set) => ({
  panelsHidden: false,
  paletteOpen: false,
  newProjectOpen: false,
  resizeOpen: false,
  backupsOpen: false,
  activeTilesetId: null,
  busy: false,
  draggingFiles: false,
  startupOpening: false,
  libraryTab: "tileset",
  saveStampOpen: false,
  entityTypesOpen: false,
  entityTypesStartNew: false,
  entityTypesSelect: null,

  togglePanels: () => set((s) => ({ panelsHidden: !s.panelsHidden })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setResizeOpen: (resizeOpen) => set({ resizeOpen }),
  setBackupsOpen: (backupsOpen) => set({ backupsOpen }),
  setActiveTileset: (activeTilesetId) => set({ activeTilesetId }),
  setBusy: (busy) => set({ busy }),
  setDraggingFiles: (draggingFiles) => set({ draggingFiles }),
  setStartupOpening: (startupOpening) => set({ startupOpening }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  setSaveStampOpen: (saveStampOpen) => set({ saveStampOpen }),
  setEntityTypesOpen: (entityTypesOpen, startNew = false, selectId = null) =>
    set({ entityTypesOpen, entityTypesStartNew: entityTypesOpen && startNew, entityTypesSelect: entityTypesOpen ? selectId : null }),
}));
