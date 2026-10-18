/**
 * Operations: plain-data commands, the only way to change a document.
 * Send them with `MapStore.dispatch(op)`.
 */
import type { Cell } from "./cell";
import type { Collection } from "./collection";
import type { RandomSet } from "./randomSet";
import type { EntityFieldValue, EntityType } from "./entity";
import type { CellRect } from "./geometry";
import type { GridRole } from "./layer";
import type { Terrain } from "./terrain";
import type { TerrainSet } from "./terrainSet";
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
 * Appends a tileset to the document (end of the list = bottom of the
 * library). Undoable since round 3: one step that also holds the derived
 * tiles re-derived when the tileset brings terrains that existing grid
 * values already refer to. Palette entries added for it later stay when it
 * is undone (the palette is append-only). Throws on duplicate id, duplicate
 * terrain id or invalid metadata.
 */
export interface AddTilesetOp {
  readonly type: "addTileset";
  readonly tileset: Tileset;
  /**
   * `false`: add without an undo step (the pre-round-3 behaviour), e.g. when
   * syncing project data into another level's store. Defaults to `true`.
   */
  readonly undoable?: boolean;
}

/**
 * Removes a tileset and everything that depends on it, as one undo step:
 * - every tile-layer cell whose palette entry points at the tileset is
 *   cleared (all layers, also locked ones);
 * - every terrain-grid cell whose value is one of its terrains is cleared;
 * - its solid flags and terrains go with it, and every terrain layer is
 *   re-derived (derived tiles of its terrains disappear).
 * - its tiles leave every collection (cells dropped) and every random set
 *   (tile candidates dropped; a set left without candidates is removed)
 *   (round 4).
 * Its palette entries stay (the palette is append-only), unused. Undo
 * restores the tileset at its position and every cell byte-exactly.
 * Check `tilesetUsage(doc, id)` first to ask the user. Structure event
 * `"tilesets"`. Throws on an unknown tileset.
 */
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

/**
 * Copies a layer (properties, cells or entities) and puts the copy right
 * above it. Returns the new layer's id. Undoable as one step.
 *
 * - Tile / collision grid layer: plain copy.
 * - Terrain grid layer with a derived tile layer: the **pair** is copied —
 *   a new tile layer (copy of the target, placed right above the target)
 *   and a new terrain grid deriving into it (right above the grid). The
 *   returned id is the new grid's.
 * - Terrain grid without (or with a dangling) target: copied without target.
 * - A derived tile layer alone: copied as an ordinary (hand-paintable) tile layer.
 * - Entity layer: entities get new ids; the spawn point is not copied
 *   (a level has at most one).
 *
 * Names are made unique within the level ({@link uniqueLayerName}):
 * `name` (default: the source layer's name) names the copy, `targetName`
 * (default: the derived tile layer's name) the copied derived tile layer of
 * a terrain pair; a taken name gets the next free " 2", " 3"... suffix.
 * The UI passes localized "… copy" names. Throws on an unknown layer.
 */
export interface DuplicateLayerOp {
  readonly type: "duplicateLayer";
  readonly layerId: string;
  readonly name?: string;
  readonly targetName?: string;
}

/**
 * Merges a tile layer into the tile layer directly below it: every
 * non-empty cell of the upper layer overwrites the lower one (opacity and
 * visibility are ignored), then the upper layer is removed. Undoable as
 * one step. Returns the lower layer's id.
 *
 * Throws {@link LayerMergeError} (nothing changes) when the layer is not a
 * plain tile layer, there is no layer below or it is not a plain tile
 * layer (grid / entity), either layer is locked, or either is a derived
 * terrain tile layer. Throws a plain `Error` on an unknown layer.
 */
export interface MergeLayerDownOp {
  readonly type: "mergeLayerDown";
  readonly layerId: string;
}

/** Why `mergeLayerDown` refused (see {@link LayerMergeError}). */
export type LayerMergeRefusal = "notTileLayer" | "noLayerBelow" | "belowNotTileLayer" | "locked" | "derived";

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

/**
 * Re-slices a tileset image with a new tile size / margin / spacing (fixes
 * a wrong guess made at import). Columns and rows are recomputed from
 * `imageWidth` × `imageHeight` (default: the smallest image the current
 * grid needs, see `tilesetImageExtent`).
 *
 * Remap rule (by pixel position, see `tilesetGridRemap`): an old tile whose
 * top-left pixel is exactly the top-left pixel of a new tile becomes that
 * tile. That applies to the palette entries of this tileset (so cells keep
 * showing the same pixels), solid flags, terrain variants and terrains (a
 * terrain stays only when its whole block maps onto a block of the same
 * shape). Everything else is dropped: cells using a dropped palette entry
 * are cleared (also on locked layers), dropped solid flags / variants /
 * terrains are removed. Derived terrain tiles are re-derived.
 * Collections and random sets (round 4) follow the same remap; references
 * to dropped tiles are removed from them.
 *
 * Undoable as one step (palette rewrites included, byte-exact); a no-op
 * (no step) when the grid does not change. Throws on an unknown tileset,
 * an invalid spec, or a grid with no whole tile.
 */
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

/**
 * The tileset PNG changed size (edited and saved elsewhere): same tile size,
 * margin and spacing, new columns / rows. Tiles keep their pixel position,
 * so ids are preserved as long as the column count stays the same
 * ("ekleme sona yapılır"); a wider image moves ids to keep pixels (Tiled
 * does the same). Tiles that fall outside the new image are **out of
 * range**: their palette entries and cells are kept (reported and skipped by
 * exports, like any out-of-range id) so that a temporarily smaller PNG does
 * not destroy the map; solid flags and terrains that no longer fit are
 * removed. Collections and random sets (round 4) follow moved tiles; references to
 * tiles outside the new image are dropped from them (a parked id could show
 * other pixels; undo brings them back). Undoable as one step; a no-op when columns and rows stay.
 */
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
  /** Solid flags removed. */
  readonly droppedSolidTiles: number;
  /** Ids of terrains removed (their grid cells stay and derive nothing). */
  readonly droppedTerrains: readonly number[];
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

/**
 * Adds terrain set `set` to tileset `tilesetId`, or replaces the set with
 * the same id (tags included; build it with `tagBlockWithTemplate`,
 * `withTerrainSet` ...). Undoable; a no-op when nothing changes. Tiles
 * already on layers are not touched (the tags only steer the brush).
 * Structure event `"tilesets"`. Throws on an unknown tileset or an invalid set.
 */
export interface SetTerrainSetOp {
  readonly type: "setTerrainSet";
  readonly tilesetId: string;
  readonly set: TerrainSet;
}

/** Removes terrain set `setId` from tileset `tilesetId`. Undoable. Tiles on layers stay. Throws on an unknown tileset / set. */
export interface RemoveTerrainSetOp {
  readonly type: "removeTerrainSet";
  readonly tilesetId: string;
  readonly setId: string;
}

/**
 * Terrain brush on an ordinary tile layer (see `terrainBrush.ts`): solves
 * the tiles with `terrainPaint` (or `terrainErase` when `erase`, or
 * `terrainFill` from `cells[0]` when `fill`) and writes them with
 * `paintCells` — one undo step outside a transaction, same patch format,
 * so export and collision see ordinary tiles. Palette entries for new
 * tiles are added (not undoable, like `addPaletteEntry`). A locked layer
 * is skipped. Throws like `terrainPaint`.
 */
export interface PaintTerrainBrushOp {
  readonly type: "paintTerrainBrush";
  readonly layerId: string;
  readonly cells: readonly { readonly x: number; readonly y: number }[];
  readonly tilesetId: string;
  readonly setId: string;
  /** Ignored when `erase` is set. */
  readonly terrainId: number;
  readonly erase?: boolean;
  readonly fill?: boolean;
  /** D4 cell flag orientation; default 0. */
  readonly orientation?: number;
  /** Blob map edge policy; default solid. */
  readonly boundary?: "solid" | "empty";
  /** Corner sets: see `TerrainSolveOptions.maxExpand`. */
  readonly maxExpand?: number;
}

export type Op =
  | SetTerrainSetOp
  | RemoveTerrainSetOp
  | PaintTerrainBrushOp
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
  setTerrainSet: void;
  removeTerrainSet: void;
  /** Cells the brush changed. */
  paintTerrainBrush: LayerPatch;
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
  /** Id of the new layer (for a terrain pair: the new grid layer). */
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
  updateTilesetGrid: TilesetRemapResult;
  replaceTilesetImage: TilesetRemapResult;
}

export type OpResult<O extends Op> = OpResultMap[O["type"]];
