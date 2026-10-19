import type { PixelOp, EditedTileSlot, PixelRectPatch } from "./pixel/ops";
/**
 * Operations: plain-data commands, the only way to change a document.
 * Send them with `MapStore.dispatch(op)`.
 */
import type { Cell } from "./cell";
import type { Collection } from "./collection";
import type { RandomSet } from "./randomSet";
import type { EntityFieldValue, EntityType } from "./entity";
import type { GridRole } from "./layer";
import type { GeneratedTilesetMetadata, Tileset } from "./tileset";

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

/** Writes ordinary tile cells; locked layers ignore valid writes. */
export interface PaintCellsOp {
  readonly type: "paintCells";
  readonly layerId: string;
  readonly cells: readonly CellWrite[];
}

export interface AddTilesetOp {
  readonly type: "addTileset";
  readonly tileset: Tileset;
  /**
   * `false`: add without an undo step (the pre-round-3 behaviour), e.g. when
   * syncing project data into another level's store. Defaults to `true`.
   */
  readonly undoable?: boolean;
}

export interface RemoveTilesetOp {
  readonly type: "removeTileset";
  readonly tilesetId: string;
}

/**
 * Changes a tileset's display metadata: `name` (any string), `group`
 * (`null` or `""` removes it → ungrouped), or refreshes existing generated
 * provenance after a successful staged PNG bake. Origin/layout remain fixed.
 * Omitted fields stay. Undoable;
 * a no-op when nothing changes. Structure event `"tilesets"`. Throws on an
 * unknown tileset, invalid metadata or an attempted generated origin/layout change.
 */
export interface SetTilesetMetaOp {
  readonly type: "setTilesetMeta";
  readonly tilesetId: string;
  readonly name?: string;
  readonly group?: string | null;
  /** Refresh provenance after a successful staged PNG regeneration, retaining origin and slot layout. Existing generated assets only. */
  readonly generated?: GeneratedTilesetMetadata;
  /** Cache-only provenance refresh. Requires generated and forbids name/group edits.
   * Survives undo/redo/rollback without adding a step or clearing redo. */
  readonly undoable?: false;
}

/**
 * Moves a tileset so that it ends up at `index` in `document.tilesets`
 * (the display order; tile ids and palette entries are unaffected).
 * Undoable; moving to its current index is a no-op. Structure event
 * `"tilesets"`. Throws on an unknown tileset or an index outside
 * `[0, tilesets.length - 1]`.
 */
export interface MoveTilesetOp {
  readonly type: "moveTileset";
  readonly tilesetId: string;
  readonly index: number;
}

export interface DuplicateLayerOp {
  readonly type: "duplicateLayer";
  readonly layerId: string;
  readonly name?: string;
}

export interface MergeLayerDownOp {
  readonly type: "mergeLayerDown";
  readonly layerId: string;
}

/** Why `mergeLayerDown` refused (see {@link LayerMergeError}). */
export type LayerMergeRefusal = "notTileLayer" | "noLayerBelow" | "belowNotTileLayer" | "locked";

/** Thrown by `mergeLayerDown` when the merge is not possible; nothing was changed. */
export class LayerMergeError extends Error {
  readonly reason: LayerMergeRefusal;
  readonly layerId: string;
  constructor(reason: LayerMergeRefusal, layerId: string, message: string) {
    super(`mergeLayerDown: ${message}`);
    this.name = "LayerMergeError";
    this.reason = reason;
    this.layerId = layerId;
  }
}

/** Layer properties for `addLayer`; omitted fields get defaults. */
export interface NewLayer {
  /** Defaults to a generated unique id (`"layer-1"`, `"layer-2"`, ...). */
  readonly id?: string;

  readonly type?: "tile" | "grid" | "entity";
  /** Required for grid layers. */
  readonly role?: GridRole;

  readonly name: string;
  /** Defaults to `true`. */
  readonly visible?: boolean;
  /** Defaults to `false`. */
  readonly locked?: boolean;
  /** Defaults to `1`. */
  readonly opacity?: number;
}

export interface AddLayerOp {
  readonly type: "addLayer";
  readonly layer: NewLayer;
  readonly index?: number;
}

/**
 * Ensures a palette entry exists and returns its index. Deduplicates.
 * Ordinary entries keep legacy append-only semantics by default; edited
 * entries are journaled. `undoable: true` also journals a new source entry
 * so compound transactions restore the exact palette on undo/rollback.
 * Nonundoable growth clears redo that depends on journaled palette additions.
 */
export interface AddPaletteEntryOp {
  readonly type: "addPaletteEntry";
  readonly tilesetId: string;
  readonly tileId: number;
  readonly undoable?: true;
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

/** One grid cell write inside a `paintGrid` op. */
export interface GridWrite {
  readonly x: number;
  readonly y: number;

  readonly value: number;
}

/** Manual grid writes: 0 clears, 1 blocks, 2 allows passage. A transaction groups a gesture into one undo step. */
export interface PaintGridOp {
  readonly type: "paintGrid";
  readonly layerId: string;
  readonly cells: readonly GridWrite[];
}

/**
 * Marks tiles solid / not solid. Collision is derived from it (see
 * `collisionAt`). Undoable; a no-op when nothing changes. Throws on an
 * unknown tileset or a tile id outside it.
 */

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

export interface UpdateTilesetGridOp {
  readonly type: "updateTilesetGrid";
  readonly tilesetId: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly margin: number;
  readonly spacing: number;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
}

export interface ReplaceTilesetImageOp {
  readonly type: "replaceTilesetImage";
  readonly tilesetId: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

/** What a tileset grid edit did (for UI messages). Counts are palette entries unless named otherwise. */
export interface TilesetRemapResult {
  /** Palette entries whose tile id changed. */
  readonly remapped: number;
  /** Palette entries that map onto no new tile (`updateTilesetGrid`); their cells were cleared. */
  readonly dropped: number;
  /** Palette entries outside the new image (`replaceTilesetImage`); kept, reported by `paletteWarnings`. */
  readonly outOfRange: number;
  /** Cells cleared because their palette entry was dropped. */
  readonly clearedCells: number;

}

/**
 * Adds a saved random set (appended) or replaces the one with the same id
 * (in place). Project-level, like entity types; undoable; a no-op when
 * nothing changes. Tile candidates must point at an existing tileset and a
 * tile inside it (stamp candidates are not checked: stamps are files).
 * Structure event `"randomSets"`. Throws on an invalid set
 * (`randomSetProblem`) or an unknown tile.
 */
export interface SetRandomSetOp {
  readonly type: "setRandomSet";
  readonly set: RandomSet;
}

/** Removes a random set. Undoable. Structure event `"randomSets"`. Throws on an unknown id. */
export interface RemoveRandomSetOp {
  readonly type: "removeRandomSet";
  readonly id: string;
}

/**
 * Adds a collection (palette; appended) or replaces the one with the same
 * id (in place) — moving / copying tiles inside or between collections is a
 * `setCollection` per changed collection (in one transaction for one undo
 * step). Cells are sorted on the way in. Undoable; a no-op when nothing
 * changes. Every cell must point at an existing tileset and a tile inside
 * it. Structure event `"collections"`. Throws on an invalid collection
 * (`collectionProblem`) or an unknown tile.
 */
export interface SetCollectionOp {
  readonly type: "setCollection";
  readonly collection: Collection;
}

/** Removes a collection. Undoable. Structure event `"collections"`. Throws on an unknown id. */
export interface RemoveCollectionOp {
  readonly type: "removeCollection";
  readonly id: string;
}

/**
 * Changes level properties: `background` (`#rrggbb`, `null` removes it)
 * and `name` (see `MapProps`). Omitted fields stay. Undoable; a no-op when
 * nothing changes. Structure event `"props"`. Throws on an
 * invalid colour or a non-string name.
 */
export interface SetMapPropsOp {
  readonly type: "setMapProps";
  readonly background?: string | null;
  readonly name?: string;
}

export type Op =
  | PixelOp
  | SetRandomSetOp
  | RemoveRandomSetOp
  | SetCollectionOp
  | RemoveCollectionOp
  | SetMapPropsOp
  | RemoveTilesetOp
  | SetTilesetMetaOp
  | MoveTilesetOp
  | DuplicateLayerOp
  | MergeLayerDownOp
  | UpdateTilesetGridOp
  | ReplaceTilesetImageOp
  | AddEntityOp
  | RemoveEntityOp
  | MoveEntityOp
  | UpdateEntityOp
  | DefineEntityTypeOp
  | RemoveEntityTypeOp
  | PaintGridOp
  | PaintCellsOp
  | AddTilesetOp
  | AddLayerOp
  | AddPaletteEntryOp
  | RemoveLayerOp
  | MoveLayerOp
  | SetLayerPropsOp
  | ResizeMapOp;
export type OpType = Op["type"];

/** What `dispatch` returns for each op type. */
export interface OpResultMap {
  setEditedTileset: void;
  allocateEditedTile: EditedTileSlot;
  editTilePixels: readonly PixelRectPatch[];
  patchPixels: readonly PixelRectPatch[];
  remapCells: LayerPatch;
  loadRasterAsset: void;
  /** Cells the brush changed. */
  setRandomSet: void;
  removeRandomSet: void;
  setCollection: void;
  removeCollection: void;
  setMapProps: void;
  /** Cells this op actually changed (no-op writes omitted). */
  paintCells: LayerPatch;
  addTileset: void;
  removeTileset: void;
  setTilesetMeta: void;
  moveTileset: void;

  duplicateLayer: string;
  /** Id of the lower layer that received the cells. */
  mergeLayerDown: string;
  /** Id of the new layer. */
  addLayer: string;
  /** Palette index of the entry. */
  addPaletteEntry: number;
  removeLayer: void;
  moveLayer: void;
  setLayerProps: void;
  resizeMap: void;
  /** Grid cells this op actually changed. */
  paintGrid: LayerPatch;
  /** Id of the new entity, `null` when the layer is locked. */
  addEntity: string | null;
  removeEntity: void;
  moveEntity: void;
  updateEntity: void;
  defineEntityType: void;
  removeEntityType: void;
  updateTilesetGrid: TilesetRemapResult;
  replaceTilesetImage: TilesetRemapResult;
}

export type OpResult<O extends Op> = OpResultMap[O["type"]];
