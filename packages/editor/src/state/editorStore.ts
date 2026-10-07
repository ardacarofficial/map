import { create } from "zustand";
import type { MapStore } from "@smap/core";

/**
 * Shared editor UI state. Tile data never lives here — it lives in the core
 * `MapStore`. Canvas (`src/canvas`) and panels (`src/ui`) both read this store.
 */

export type ToolId = "brush" | "eraser";

export interface TileSelection {
  tilesetId: string;
  tileId: number;
}

/** An opened project. `null` means the welcome screen is shown. */
export interface OpenProject {
  name: string;
  /** The core document store for the (single, v0.1) level. */
  store: MapStore;
  /** Relative path of the level file inside the project, e.g. "levels/main.json". */
  levelPath: string;
}

export interface EditorState {
  project: OpenProject | null;
  tool: ToolId;
  selection: TileSelection | null;
  activeLayerId: string | null;
  gridVisible: boolean;
  /** Hovered cell under the cursor, for the status bar. */
  hoverCell: { x: number; y: number } | null;
  /** Current camera zoom (1 = 100%), for the status bar. */
  zoom: number;
  /** True when the document changed since the last save. */
  dirty: boolean;

  setProject(project: OpenProject | null): void;
  setTool(tool: ToolId): void;
  setSelection(selection: TileSelection | null): void;
  setActiveLayer(id: string | null): void;
  toggleGrid(): void;
  setHoverCell(cell: { x: number; y: number } | null): void;
  setZoom(zoom: number): void;
  setDirty(dirty: boolean): void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  project: null,
  tool: "brush",
  selection: null,
  activeLayerId: null,
  gridVisible: true,
  hoverCell: null,
  zoom: 1,
  dirty: false,

  setProject: (project) =>
    set({
      project,
      activeLayerId: project?.store.document.layers.at(-1)?.id ?? null,
      selection: null,
      dirty: false,
    }),
  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),
  setActiveLayer: (activeLayerId) => set({ activeLayerId }),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  setHoverCell: (hoverCell) => set({ hoverCell }),
  setZoom: (zoom) => set({ zoom }),
  setDirty: (dirty) => set({ dirty }),
}));
