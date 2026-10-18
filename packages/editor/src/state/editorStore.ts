import { create } from "zustand";
import { isEntityLayer, type MapDocument, type MapStore, type TileClip } from "@smap/core";

import type { SelectionScope } from "../commands/selectionScope";
import { pushRecent, type RecentItem } from "./recentItems";

/**
 * Shared editor UI state. Tile data never lives here — it lives in the core
 * `MapStore`. Canvas (`src/canvas`) and panels (`src/ui`) both read this store.
 */

export type ToolId = "brush" | "eraser" | "fill" | "rect" | "select" | "eyedropper" | "entity" | "hand";

/** Rectangular region in cell coordinates (inclusive x/y, width/height ≥ 1). */
export interface CellRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Terrain the terrain brush paints (a terrain of a tileset's terrain set; core `TerrainBrush`). */
export interface TerrainChoice {
  tilesetId: string;
  setId: string;
  terrainId: number;
}

/** Brush size the terrain brush starts with (wider than a single tile so edges show at once). */
export const DEFAULT_TERRAIN_BRUSH_SIZE = 3;

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
  /**
   * v1.0: stable id of the open (active) level. The project's level list is
   * `useProjectLibrary.levels`; only this level's store is loaded.
   */
  levelId?: string;
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
  selectionScope: SelectionScope;
  setSelectionScope(scope: SelectionScope): void;
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
  /** Brush footprint in cells (1 = single cell). Applies to brush, eraser and grid painting. */
  brushSize: number;
  brushShape: "square" | "circle";
  /** Most recently used tiles and multi-tile stamps, newest first (max 24 together). */
  recentTiles: RecentItem[];
  /**
   * Random brush: when non-empty (2+ tiles picked in the tileset with Alt),
   * the brush picks per cell with core `pickRandomTile` instead of `selection`.
   */
  randomSet: { tilesetId: string; tileId: number; weight?: number }[];
  /** Entity type placed by the "entity" tool (e.g. "spawn", "portal", custom id). */
  entityTypeId: string | null;
  /** Selected entity on the map (entity layer), shown in Özellik. */
  selectedEntityId: string | null;
  /**
   * Terrain chosen for the terrain brush (kept while the brush paints tiles,
   * so the Autotile toggle can return to it), or null.
   */
  terrain: TerrainChoice | null;
  /**
   * Terrain brush on: brush / rectangle / fill / eraser on the active tile
   * layer paint `terrain` with core `paintTerrainBrush` (Autotile toggle).
   */
  terrainActive: boolean;
  /** Brush size kept for the other mode while the terrain brush is on / off. */
  otherBrushSize: number;

  setProject(project: OpenProject | null): void;
  /**
   * v1.0: another level of the same project became active. Unlike
   * `setProject` it keeps the tool, tile selection, random set, stamp and
   * dirty flag; the marquee and the selected entity belong to the old level.
   * `activeLayerId` defaults to the level's top non-entity layer.
   */
  switchLevel(project: OpenProject, activeLayerId?: string | null): void;
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
  setBrushSize(size: number): void;
  setBrushShape(shape: "square" | "circle"): void;
  /** Records a tile as used (dedupes, moves to front, caps at 24). */
  pushRecentTile(tile: TileSelection): void;
  /** Records a tile or stamp entry as used (see `recentItems`). */
  pushRecentItem(item: RecentItem): void;
  setRandomSet(set: { tilesetId: string; tileId: number; weight?: number }[]): void;
  setEntityTypeId(id: string | null): void;
  setSelectedEntity(id: string | null): void;
  /**
   * Chooses `terrain` and turns the terrain brush on (null: off). Turning it
   * on swaps in the terrain brush size (3 the first time); turning it off
   * restores the tile brush size. Clears a clip on the brush.
   */
  setTerrain(terrain: TerrainChoice | null): void;
  /** Autotile toggle: terrain brush on (needs a chosen terrain) / off. */
  setTerrainActive(active: boolean): void;
}

/**
 * Layer made active when a level opens: the top layer tiles can be drawn on
 * (an entity layer on top would leave the default brush doing nothing).
 */
function defaultLayerId(doc: MapDocument): string | null {
  const layers = doc.layers;
  return (layers.filter((l) => !isEntityLayer(l)).at(-1) ?? layers.at(-1))?.id ?? null;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  project: null,
  tool: "brush",
  selection: null,
  activeLayerId: null,
  gridVisible: true,
  hoverCell: null,
  zoom: 1,
  dirty: false,
  region: null,
  selectionScope: "active",
  setSelectionScope: (selectionScope) => set({ selectionScope }),
  stamp: null,
  gridValue: 1,
  collisionOverlay: false,
  brushSize: 1,
  brushShape: "square",
  recentTiles: [],
  randomSet: [],
  entityTypeId: null,
  selectedEntityId: null,
  terrain: null,
  terrainActive: false,
  otherBrushSize: DEFAULT_TERRAIN_BRUSH_SIZE,

  setProject: (project) =>
    set({
      project,
      activeLayerId: project ? defaultLayerId(project.store.document) : null,
      selection: null,
      dirty: false,
      region: null,
      stamp: null,
      randomSet: [],
      selectedEntityId: null,
      recentTiles: [],
      ...terrainOff(get()),
      terrain: null,
    }),
  switchLevel: (project, activeLayerId) =>
    set({
      project,
      activeLayerId:
        activeLayerId && project.store.document.getLayer(activeLayerId)
          ? activeLayerId
          : defaultLayerId(project.store.document),
      region: null,
      selectedEntityId: null,
      hoverCell: null,
    }),
  setTool: (tool) => set({ tool }),
  // A tile, clip or random set on the brush means "paint tiles": the terrain brush goes off.
  setSelection: (selection) => set(selection ? { selection, ...terrainOff(get()) } : { selection }),
  setActiveLayer: (activeLayerId) => set({ activeLayerId }),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  setHoverCell: (hoverCell) => set({ hoverCell }),
  setZoom: (zoom) => set({ zoom }),
  setDirty: (dirty) => set({ dirty }),
  setRegion: (region) => set({ region }),
  setStamp: (stamp) => set(stamp ? { stamp, ...terrainOff(get()) } : { stamp }),
  setGridValue: (gridValue) => set({ gridValue }),
  setRandomSet: (randomSet) => set(randomSet.length > 0 ? { randomSet, ...terrainOff(get()) } : { randomSet }),
  setEntityTypeId: (entityTypeId) => set({ entityTypeId }),
  setSelectedEntity: (selectedEntityId) => set({ selectedEntityId }),
  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(16, Math.round(size))) }),
  setBrushShape: (brushShape) => set({ brushShape }),
  pushRecentTile: (tile) => set((s) => ({ recentTiles: pushRecent(s.recentTiles, { tilesetId: tile.tilesetId, tileId: tile.tileId }) })),
  pushRecentItem: (item) => set((s) => ({ recentTiles: pushRecent(s.recentTiles, item) })),
  toggleCollisionOverlay: () => set((s) => ({ collisionOverlay: !s.collisionOverlay })),
  setTerrain: (terrain) => {
    if (!terrain) {
      set({ terrain: null, ...terrainOff(get()) });
      return;
    }
    set({ terrain: { ...terrain }, stamp: null, ...terrainOn(get()) });
  },
  setTerrainActive: (active) => {
    const s = get();
    if (active && !s.terrain) return;
    set(active ? { stamp: null, ...terrainOn(s) } : terrainOff(s));
  },
}));

/** State change that turns the terrain brush on (brush sizes swapped); empty when already on. */
function terrainOn(s: EditorState): Partial<EditorState> {
  if (s.terrainActive) return {};
  return { terrainActive: true, brushSize: s.otherBrushSize, otherBrushSize: s.brushSize };
}

/** State change that turns the terrain brush off (brush sizes swapped back); empty when already off. */
function terrainOff(s: EditorState): Partial<EditorState> {
  if (!s.terrainActive) return {};
  return { terrainActive: false, brushSize: s.otherBrushSize, otherBrushSize: s.brushSize };
}
