/**
 * Operations: plain-data commands, the only way to change a document.
 * Send them with `MapStore.dispatch(op)`.
 */
import type { Cell } from "./cell";
import type { EntityFieldValue, EntityType } from "./entity";
import type { CellRect } from "./geometry";
import type { GridRole } from "./layer";
import type { Terrain } from "./terrain";
import type { Tileset } from "./tileset";

/** One cell write inside a `paintCells` op. */
export interface CellWrite {
  readonly x: number;
  readonly y: number;
  /** New cell value; `EMPTY_CELL` (0) erases. */
  readonly cell: Cell;
}

/** One changed cell inside a patch. */
export interface CellChange {
  readonly x: number;
  readonly y: number;
  readonly before: Cell;
  readonly after: Cell;
}

/** Changed cells of one layer. Undo writes every `before`, redo every `after`. */
export interface LayerPatch {
  readonly layerId: string;
  readonly cells: readonly CellChange[];
}

/**
 * Writes cells into a tile layer (pencil, eraser, later fill/rectangle).
 *
 * - Writes outside the map bounds are skipped (a brush may hang off the edge).
 * - Writes to a locked layer are skipped.
 * - Writes to a derived tile layer (the target of a terrain grid layer) are
 *   skipped: its tiles always equal the derivation of the grid (CLAUDE.md →
 *   Autotile: the terrain grid is the real data), and a hand-painted tile
 *   there would be lost the next time the level is derived (e.g. on load).
 * - If the same cell appears twice, the last write wins.
 * - Undoable. Outside a transaction it becomes its own undo step.
 *
 * Throws on an unknown layer, a grid layer (use `paintTerrain`), an invalid
 * cell value, or a palette index the palette does not have.
 */
export interface PaintCellsOp {
  readonly type: "paintCells";
  readonly layerId: string;
  readonly cells: readonly CellWrite[];
}

/**
 * Adds a tileset to the document. Not undoable itself. When it brings
 * terrains that existing grid values already refer to, the derived tiles
 * are re-derived (recorded like any cell change: own undo step outside a
 * transaction). Throws on duplicate id or invalid metadata.
 */
export interface AddTilesetOp {
  readonly type: "addTileset";
  readonly tileset: Tileset;
}

/** Layer properties for `addLayer`; omitted fields get defaults. */
export interface NewLayer {
  /** Defaults to a generated unique id (`"layer-1"`, `"layer-2"`, ...). */
  readonly id?: string;
  /** `"tile"` (default), `"grid"` (v0.3: terrain / collision) or `"entity"` (v0.6). */
  readonly type?: "tile" | "grid" | "entity";
  /** Required for grid layers. */
  readonly role?: GridRole;
  /**
   * Terrain grid layers only: id of an existing tile layer whose tiles are
   * derived from this grid. It must not already be the target of another
   * terrain layer. Omit for a terrain grid without derived tiles.
   * If that tile layer is removed later the link dangles (derivation is
   * skipped until a tile layer with that id exists again).
   */
  readonly targetLayerId?: string;
  readonly name: string;
  /** Defaults to `true`. */
  readonly visible?: boolean;
  /** Defaults to `false`. */
  readonly locked?: boolean;
  /** Defaults to `1`. */
  readonly opacity?: number;
}

/**
 * Adds an empty tile layer (or grid layer, `layer.type: "grid"`). Undoable (since v0.2).
 * `index` is the position from the bottom; defaults to the top.
 * A new terrain grid with a `targetLayerId` takes over that tile layer: it is
 * re-derived (from the empty grid: hand-painted tiles there are cleared) in
 * the same undo step. A new tile layer whose id a terrain grid already
 * targets (dangling link) is derived in the same undo step too.
 */
export interface AddLayerOp {
  readonly type: "addLayer";
  readonly layer: NewLayer;
  readonly index?: number;
}

/**
 * Ensures a palette entry exists for (`tilesetId`, `tileId`) and returns its
 * index. Deduplicates. Not undoable (the palette is append-only so that cells
 * in undo history keep pointing at the right tile).
 */
export interface AddPaletteEntryOp {
  readonly type: "addPaletteEntry";
  readonly tilesetId: string;
  readonly tileId: number;
}

/**
 * Removes a layer with all its cells. Undoable: undo puts the same layer back
 * at the same position with its chunks and properties. Throws on an unknown layer.
 */
export interface RemoveLayerOp {
  readonly type: "removeLayer";
  readonly layerId: string;
}

/**
 * Moves a layer so that it ends up at `index` (from the bottom) in the new
 * order. Undoable; moving to its current index is a no-op.
 * Throws on an unknown layer or an index outside `[0, layers.length - 1]`.
 */
export interface MoveLayerOp {
  readonly type: "moveLayer";
  readonly layerId: string;
  readonly index: number;
}

/** Layer properties for `setLayerProps`; omitted fields stay unchanged. */
export interface LayerPropsPatch {
  readonly name?: string;
  readonly visible?: boolean;
  readonly locked?: boolean;
  /** 0..1 */
  readonly opacity?: number;
}

/**
 * Changes layer properties (name, visibility, lock, opacity). Undoable;
 * setting the current values is a no-op. Works on locked layers (that is
 * how they get unlocked). Throws on an unknown layer or invalid values.
 */
export interface SetLayerPropsOp {
  readonly type: "setLayerProps";
  readonly layerId: string;
  readonly props: LayerPropsPatch;
}

/**
 * Changes the map size. Existing content is shifted by (`offsetX`, `offsetY`)
 * first — e.g. growing by 3 columns on the left is
 * `{ width: w + 3, height: h, offsetX: 3, offsetY: 0 }` — and cells that end
 * up outside the new bounds are dropped. Undoable: undo restores the old
 * size and every dropped cell. Same size with zero offset is a no-op.
 * Throws on a size outside `[1, MAX_MAP_SIZE]` or non-integer offsets.
 */
export interface ResizeMapOp {
  readonly type: "resizeMap";
  readonly width: number;
  readonly height: number;
  /** Defaults to 0. */
  readonly offsetX?: number;
  /** Defaults to 0. */
  readonly offsetY?: number;
}

/** One grid cell write inside a `paintTerrain` op. */
export interface GridWrite {
  readonly x: number;
  readonly y: number;
  /** Terrain id / collision kind; 0 erases. */
  readonly value: number;
}

/**
 * Writes values into a grid layer (terrain brush, collision exceptions).
 *
 * - Terrain layers: the linked tile layer is re-derived for the changed
 *   cells and their 8 neighbours in the same undo step (both the grid and
 *   the derived tile changes are stored, so undo is byte-exact). Palette
 *   entries for all tiles of a terrain are added (not undoable, like
 *   `addPaletteEntry`) the first time it is derived in a document.
 * - Out-of-bounds writes are skipped, a locked grid layer is skipped (the
 *   derived tile layer is written even when locked — it is owned by the grid).
 * - Undoable; outside a transaction it is its own undo step.
 *
 * Throws on an unknown / non-grid layer or a value outside
 * `[0, MAX_GRID_VALUE]` (`[0, 2]` for collision layers).
 * Returns the grid cells that changed.
 */
export interface PaintTerrainOp {
  readonly type: "paintTerrain";
  readonly layerId: string;
  readonly cells: readonly GridWrite[];
}

/**
 * Marks tiles solid / not solid. Collision is derived from it (see
 * `collisionAt`). Undoable; a no-op when nothing changes. Throws on an
 * unknown tileset or a tile id outside it.
 */
export interface SetTileSolidOp {
  readonly type: "setTileSolid";
  readonly tilesetId: string;
  readonly tileIds: readonly number[];
  readonly solid: boolean;
}

/**
 * Adds a terrain to `terrain.tilesetId`, or replaces the terrain with the
 * same id (also when it lived in another tileset — it moves). Every terrain
 * layer is re-derived in the same undo step. Undoable; a no-op when nothing
 * changes. Throws on an invalid terrain (id range, template block outside
 * the tileset, bad variants) or an unknown tileset.
 */
export interface DefineTerrainOp {
  readonly type: "defineTerrain";
  readonly terrain: Terrain;
}

/**
 * Removes a terrain definition. Grid cells keep their value (they derive
 * nothing until a terrain with that id is defined again); derived tiles are
 * re-computed in the same undo step. Undoable. Throws on an unknown id.
 */
export interface RemoveTerrainOp {
  readonly type: "removeTerrain";
  readonly terrainId: number;
}

/**
 * Recomputes the derived tiles of a terrain grid layer inside `rect`
 * (clipped to the map; default: the whole map). Every other op already
 * keeps derived tiles current, so this is only needed by multi-op edits
 * that skip derived layers (`pasteClip`, `cutRegion`, `placeStamp` use it
 * inside their transaction). A no-op for collision grids, terrain grids
 * without a target, and when nothing differs. Undoable (outside a
 * transaction its own step). Throws on an unknown / non-grid layer or an
 * invalid rectangle. Returns the derived tile layer's changed cells.
 */
export interface DeriveTerrainOp {
  readonly type: "deriveTerrain";
  readonly layerId: string;
  readonly rect?: CellRect;
}

/** Entity data for `addEntity`; omitted fields get defaults. */
export interface NewEntity {
  /** Defaults to a generated id unique in the document (`"e1"`, `"e2"`, ...). */
  readonly id?: string;
  /** Built-in (`"spawn"`, `"portal"`) or user-defined type id. */
  readonly typeId: string;
  /** Integer pixels in map space (top-left corner; see `Entity`). */
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  /** Values for some fields of the type; the rest get the type's defaults. */
  readonly fields?: Readonly<Record<string, EntityFieldValue>>;
}

/**
 * Places an entity on an entity layer at `index` (default: top). Undoable.
 * Returns its id, or `null` when the layer is locked (nothing happens).
 * Throws on an unknown / non-entity layer, an unknown type, a duplicate id,
 * a position outside the map, invalid field values, or a second spawn
 * point in the level (at most one entity of type `"spawn"`).
 */
export interface AddEntityOp {
  readonly type: "addEntity";
  readonly layerId: string;
  readonly entity: NewEntity;
  readonly index?: number;
}

/** Removes an entity. Undoable. No-op on a locked layer. Throws on an unknown id. */
export interface RemoveEntityOp {
  readonly type: "removeEntity";
  readonly entityId: string;
}

/**
 * Moves an entity to (`x`, `y`) pixels. Undoable (a drag inside a
 * transaction is one step). No-op on a locked layer or when nothing
 * changes. Throws on an unknown id or a position outside the map.
 */
export interface MoveEntityOp {
  readonly type: "moveEntity";
  readonly entityId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Changes field values and / or size of an entity. `fields` is merged into
 * the current values (each must be a field of the entity's type and valid
 * for it); `width` / `height` `null` resets to "one cell". Undoable; no-op
 * on a locked layer or when nothing changes. The type of an entity is
 * fixed. Throws on an unknown id, an unknown type, or invalid values.
 */
export interface UpdateEntityOp {
  readonly type: "updateEntity";
  readonly entityId: string;
  readonly fields?: Readonly<Record<string, EntityFieldValue>>;
  readonly width?: number | null;
  readonly height?: number | null;
}

/**
 * Adds a user-defined entity type (appended) or replaces the one with the
 * same id (in place). Project-level, like tilesets; undoable. Entities keep
 * their stored values (exporters fall back to defaults for values that no
 * longer fit). Throws on an invalid type or a reserved id (`spawn`, `portal`).
 */
export interface DefineEntityTypeOp {
  readonly type: "defineEntityType";
  readonly entityType: EntityType;
}

/**
 * Removes a user-defined entity type. Entities of that type stay (they
 * show as "unknown type" until it is defined again). Undoable. Throws on an
 * unknown or built-in id.
 */
export interface RemoveEntityTypeOp {
  readonly type: "removeEntityType";
  readonly typeId: string;
}

export type Op =
  | AddEntityOp
  | RemoveEntityOp
  | MoveEntityOp
  | UpdateEntityOp
  | DefineEntityTypeOp
  | RemoveEntityTypeOp
  | PaintTerrainOp
  | SetTileSolidOp
  | DefineTerrainOp
  | RemoveTerrainOp
  | PaintCellsOp
  | AddTilesetOp
  | AddLayerOp
  | AddPaletteEntryOp
  | RemoveLayerOp
  | MoveLayerOp
  | SetLayerPropsOp
  | ResizeMapOp
  | DeriveTerrainOp;
export type OpType = Op["type"];

/** What `dispatch` returns for each op type. */
export interface OpResultMap {
  /** Cells this op actually changed (no-op writes omitted). */
  paintCells: LayerPatch;
  addTileset: void;
  /** Id of the new layer. */
  addLayer: string;
  /** Palette index of the entry. */
  addPaletteEntry: number;
  removeLayer: void;
  moveLayer: void;
  setLayerProps: void;
  resizeMap: void;
  /** Grid cells this op actually changed. */
  paintTerrain: LayerPatch;
  setTileSolid: void;
  defineTerrain: void;
  removeTerrain: void;
  /** Id of the new entity, `null` when the layer is locked. */
  addEntity: string | null;
  removeEntity: void;
  moveEntity: void;
  updateEntity: void;
  defineEntityType: void;
  removeEntityType: void;
  /** Derived tile layer cells this op changed (`layerId` = the target tile layer, or the grid when it has none). */
  deriveTerrain: LayerPatch;
}

export type OpResult<O extends Op> = OpResultMap[O["type"]];
