import { DEFAULT_TERRAIN_TEMPLATE, type TerrainTemplate } from "@smap/core";
import { create } from "zustand";

/**
 * What a click in the tileset panel does: pick tiles (default), toggle
 * "katı" (solid), or place a terrain block.
 */
export type TilesetMode = "pick" | "solid" | "terrain";

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
  tilesetMode: TilesetMode;
  /** Template used by "Arazi tanımla". */
  terrainTemplate: TerrainTemplate;

  togglePanels(): void;
  setPaletteOpen(open: boolean): void;
  setNewProjectOpen(open: boolean): void;
  setResizeOpen(open: boolean): void;
  setBackupsOpen(open: boolean): void;
  setActiveTileset(id: string | null): void;
  setBusy(busy: boolean): void;
  setDraggingFiles(dragging: boolean): void;
  /** Sets the mode; setting the current mode again goes back to "pick". */
  toggleTilesetMode(mode: TilesetMode): void;
  setTilesetMode(mode: TilesetMode): void;
  setTerrainTemplate(template: TerrainTemplate): void;
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
  tilesetMode: "pick",
  terrainTemplate: DEFAULT_TERRAIN_TEMPLATE,

  togglePanels: () => set((s) => ({ panelsHidden: !s.panelsHidden })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setResizeOpen: (resizeOpen) => set({ resizeOpen }),
  setBackupsOpen: (backupsOpen) => set({ backupsOpen }),
  setActiveTileset: (activeTilesetId) => set({ activeTilesetId }),
  setBusy: (busy) => set({ busy }),
  setDraggingFiles: (draggingFiles) => set({ draggingFiles }),
  toggleTilesetMode: (mode) => set((s) => ({ tilesetMode: s.tilesetMode === mode ? "pick" : mode })),
  setTilesetMode: (tilesetMode) => set({ tilesetMode }),
  setTerrainTemplate: (terrainTemplate) => set({ terrainTemplate }),
}));
