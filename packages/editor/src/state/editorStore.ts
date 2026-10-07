import { create } from "zustand";
import type { MapStore, TileClip } from "@smap/core";

/**
 * Shared editor UI state. Tile data never lives here — it lives in the core
 * `MapStore`. Canvas (`src/canvas`) and panels (`src/ui`) both read this store.
 */

export type ToolId = "brush" | "eraser" | "fill" | "rect" | "select" | "eyedropper" | "entity";

/** Rectangular region in cell coordinates (inclusive x/y, width/height ≥ 1). */
export interface CellRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  /** Active marquee selection on the map (select tool), or null. */
  region: CellRegion | null;
  /**
   * Clip being placed (after paste, or a multi-tile pick from the tileset /
   * right-drag on the map). While set, the brush stamps this clip instead of
   * `selection`. Type is core's `TileClip`.
   */
  stamp: TileClip | null;
  /**
   * Value painted when the active layer is a grid layer (brush/rect/fill write
   * it, eraser writes 0). Terrain layers: the terrain's grid value. Collision
   * layers: 1 = force solid, 2 = force passable.
   */
  gridValue: number;
  /** Show derived collision as an overlay on the canvas. */
  collisionOverlay: boolean;
  /**
   * Random brush: when non-empty (2+ tiles picked in the tileset with Alt),
   * the brush picks per cell with core `pickRandomTile` instead of `selection`.
   */
  randomSet: { tilesetId: string; tileId: number; weight?: number }[];
  /** Entity type placed by the "entity" tool (e.g. "spawn", "portal", custom id). */
  entityTypeId: string | null;
  /** Selected entity on the map (entity layer), shown in Özellik. */
  selectedEntityId: string | null;

  setProject(project: OpenProject | null): void;
  setTool(tool: ToolId): void;
  setSelection(selection: TileSelection | null): void;
  setActiveLayer(id: string | null): void;
  toggleGrid(): void;
  setHoverCell(cell: { x: number; y: number } | null): void;
  setZoom(zoom: number): void;
  setDirty(dirty: boolean): void;
  setRegion(region: CellRegion | null): void;
  setStamp(stamp: TileClip | null): void;
  setGridValue(value: number): void;
  toggleCollisionOverlay(): void;
  setRandomSet(set: { tilesetId: string; tileId: number; weight?: number }[]): void;
  setEntityTypeId(id: string | null): void;
  setSelectedEntity(id: string | null): void;
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
  region: null,
  stamp: null,
  gridValue: 1,
  collisionOverlay: false,
  randomSet: [],
  entityTypeId: null,
  selectedEntityId: null,

  setProject: (project) =>
    set({
      project,
      activeLayerId: project?.store.document.layers.at(-1)?.id ?? null,
      selection: null,
      dirty: false,
      region: null,
      stamp: null,
      randomSet: [],
      selectedEntityId: null,
    }),
  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),
  setActiveLayer: (activeLayerId) => set({ activeLayerId }),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  setHoverCell: (hoverCell) => set({ hoverCell }),
  setZoom: (zoom) => set({ zoom }),
  setDirty: (dirty) => set({ dirty }),
  setRegion: (region) => set({ region }),
  setStamp: (stamp) => set({ stamp }),
  setGridValue: (gridValue) => set({ gridValue }),
  setRandomSet: (randomSet) => set({ randomSet }),
  setEntityTypeId: (entityTypeId) => set({ entityTypeId }),
  setSelectedEntity: (selectedEntityId) => set({ selectedEntityId }),
  toggleCollisionOverlay: () => set((s) => ({ collisionOverlay: !s.collisionOverlay })),
}));
