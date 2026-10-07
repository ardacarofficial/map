/**
 * Operations: plain-data commands, the only way to change a document.
 * Send them with `MapStore.dispatch(op)`.
 */
import type { Cell } from "./cell";
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
 * - If the same cell appears twice, the last write wins.
 * - Undoable. Outside a transaction it becomes its own undo step.
 *
 * Throws on an unknown layer, an invalid cell value, or a palette index the
 * palette does not have.
 */
export interface PaintCellsOp {
  readonly type: "paintCells";
  readonly layerId: string;
  readonly cells: readonly CellWrite[];
}

/** Adds a tileset to the document. Not undoable. Throws on duplicate id or invalid metadata. */
export interface AddTilesetOp {
  readonly type: "addTileset";
  readonly tileset: Tileset;
}

/** Layer properties for `addLayer`; omitted fields get defaults. */
export interface NewLayer {
  /** Defaults to a generated unique id (`"layer-1"`, `"layer-2"`, ...). */
  readonly id?: string;
  readonly name: string;
  /** Defaults to `true`. */
  readonly visible?: boolean;
  /** Defaults to `false`. */
  readonly locked?: boolean;
  /** Defaults to `1`. */
  readonly opacity?: number;
}

/**
 * Adds an empty tile layer. Undoable (since v0.2).
 * `index` is the position from the bottom; defaults to the top.
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

export type Op =
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
}

export type OpResult<O extends Op> = OpResultMap[O["type"]];
