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
 * Adds an empty tile layer. Not undoable (v0.1).
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

export type Op = PaintCellsOp | AddTilesetOp | AddLayerOp | AddPaletteEntryOp;
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
}

export type OpResult<O extends Op> = OpResultMap[O["type"]];
