import { RasterAssets, canonicalRgba, assertRasterSize, MAX_RASTER_BYTES, type RasterAssetsView, type RasterAssetInfo } from "./pixel/assets";
import { editedImagePath, EDITED_ATLAS_COLUMNS, MAX_EDITED_TILES } from "./pixel/metadata";
import { rasterContentHash } from "./pixel/png";
import type { AllocateEditedTileOp, SetEditedTilesetOp, EditedTileSlot, EditTilePixelsOp, LoadRasterAssetOp, RemapCellsOp, PatchPixelsOp, PixelRectPatch, PixelDirtyRect } from "./pixel/ops";
import { cellFlags, makeCell } from "./cell";
import { isValidCell, cellPaletteIndex, type Cell } from "./cell";
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT, chunkKey, localIndex, type ChunkKey } from "./chunk";
import { MAX_COLLECTION_ROWS, collectionProblem, normalizeCollection, remapCollectionsForTileset, type Collection } from "./collection";
import { mapInfoProblem, mapPropsFrom, uniqueLayerName, type MapDocument, type MapInfo, type MapProps } from "./document";
import { normalizeRandomSet, randomSetProblem, remapRandomSetsForTileset, type RandomSet } from "./randomSet";
import {
  defaultEntityFields,
  entityProblem,
  entityTypeProblem,
  isBuiltinEntityTypeId,
  normalizeEntity,
  normalizeEntityType,
  SPAWN_TYPE_ID,
  type Entity,
  type EntityFieldValue,
  type EntityType,
} from "./entity";
import {
  EntityLayer,
  GridLayer,
  TileLayer,
  isEntityLayer,
  isGridLayer,
  isTileLayer,
  isGridRole,
  layerPropsProblem,
  type ChunkSnapshot,
  type LayerProps,
  type LayerPropValues,
} from "./layer";
import { LayerMergeError } from "./ops";
import type {
  RemoveCollectionOp,
  RemoveRandomSetOp,
  SetCollectionOp,
  SetMapPropsOp,
  SetRandomSetOp,
  DuplicateLayerOp,
  MergeLayerDownOp,
  MoveTilesetOp,
  RemoveTilesetOp,
  SetTilesetMetaOp,
  AddEntityOp,
  DefineEntityTypeOp,
  MoveEntityOp,
  RemoveEntityOp,
  RemoveEntityTypeOp,
  UpdateEntityOp,
  PaintGridOp,
  AddLayerOp,
  AddPaletteEntryOp,
  AddTilesetOp,
  LayerPatch,
  MoveLayerOp,
  Op,
  OpResult,
  PaintCellsOp,
  RemoveLayerOp,
  ResizeMapOp,
  SetLayerPropsOp,
  ReplaceTilesetImageOp,
  TilesetRemapResult,
  UpdateTilesetGridOp,
} from "./ops";
import { cellChangesOf, patchCellCount, PatchBuilder, withCellChanges, type CellChangeSet } from "./patch";
import type { PaletteEntry } from "./palette";
import { isValidTileId, normalizeTileset, tilesetProblem, type Tileset, type GeneratedTilesetMetadata } from "./tileset";
import { tileGridSpecProblem, tilesetGridRemap, tilesetImageExtent, tilesetWithGrid } from "./tilesetGrid";

export type StructureChange = "layers" | "tilesets" | "palette" | "map" | "entities" | "entityTypes" | "randomSets" | "collections" | "props";

/** Chunks of one layer whose cells changed. A key whose chunk no longer exists was emptied. */
export interface DirtyChunks {
  readonly layerId: string;
  readonly chunks: readonly ChunkKey[];
}

/** Why a change event fired. */
export type ChangeCause = "begin" | "dispatch" | "undo" | "redo" | "commit" | "rollback";

/** Delivered to every `subscribe` listener after each change. */
export interface StoreChangeEvent {
  /** Store revision after this change. */
  readonly revision: number;
  readonly cause: ChangeCause;
  /** Changed chunks per layer (empty when no cell changed). */
  readonly cells: readonly DirtyChunks[];
  readonly pixelRects: readonly PixelDirtyRect[];
  /** Structural changes (empty when none). */
  readonly structure: readonly StructureChange[];
  /** True when `canUndo` / `canRedo` may have changed. */
  readonly historyChanged: boolean;
  /** Explicit history barriers; distinguishes a redo-tail drop from a complete reset. */
  readonly historyReset?: "all" | "redo";
}

export type StoreListener = (event: StoreChangeEvent) => void;

/** Cell changes of one layer inside a history entry. */
export interface CellsHistoryChange extends LayerPatch {
  readonly kind: "cells";
}

/**
 * A layer's position in the layer list: `null` means "not in the document".
 * Add = `null → i`, remove = `i → null`, move = `i → j`. The layer object
 * (with its chunks and properties) is kept, so undoing a removal restores it whole.
 */
export interface LayerHistoryChange {
  readonly kind: "layer";
  readonly layer: TileLayer;
  readonly before: number | null;
  readonly after: number | null;
}

/** Property change of one layer. */
export interface LayerPropsHistoryChange {
  readonly kind: "layerProps";
  readonly layerId: string;
  readonly before: LayerPropValues;
  readonly after: LayerPropValues;
}

/** Map resize: dimensions plus full chunk copies of every layer whose content moved or was clipped. */
export interface MapHistoryChange {
  readonly kind: "map";
  readonly before: MapInfo;
  readonly after: MapInfo;
  readonly layers: readonly {
    readonly layerId: string;
    readonly before: readonly ChunkSnapshot[];
    readonly after: readonly ChunkSnapshot[];
  }[];
}

export interface TilesetHistoryChange {
  readonly kind: "tileset";
  readonly tilesetId: string;
  readonly before: Tileset;
  readonly after: Tileset;
}

/**
 * The tileset list before and after (add, remove, reorder). Tilesets are
 * frozen, so both sides are cheap shallow copies.
 */
export interface TilesetListHistoryChange {
  readonly kind: "tilesetList";
  readonly before: readonly Tileset[];
  readonly after: readonly Tileset[];
}

/**
 * Palette entries rewritten in place (tileset grid edits remap tile ids).
 * Only the listed indices change; the palette never shrinks.
 */
export interface PaletteHistoryChange {
  readonly kind: "palette";
  readonly entries: readonly { readonly index: number; readonly before: PaletteEntry; readonly after: PaletteEntry }[];
}

/** Entity list of one entity layer before and after (entities are immutable, so these are cheap). */
export interface EntitiesHistoryChange {
  readonly kind: "entities";
  readonly layerId: string;
  readonly before: readonly Entity[];
  readonly after: readonly Entity[];
}

/** User-defined entity type list before and after. */
export interface EntityTypesHistoryChange {
  readonly kind: "entityTypes";
  readonly before: readonly EntityType[];
  readonly after: readonly EntityType[];
}

/** Random set list before and after (round 4). */
export interface RandomSetsHistoryChange {
  readonly kind: "randomSets";
  readonly before: readonly RandomSet[];
  readonly after: readonly RandomSet[];
}

/** Collection list before and after (round 4). */
export interface CollectionsHistoryChange {
  readonly kind: "collections";
  readonly before: readonly Collection[];
  readonly after: readonly Collection[];
}

/** Level properties before and after (round 4, `setMapProps`). */
export interface MapPropsHistoryChange {
  readonly kind: "mapProps";
  readonly before: MapProps;
  readonly after: MapProps;
}

/**
 * One reversible change. Every change stores both sides; undo applies the
 * `before` sides (in reverse order), redo the `after` sides. No inverse ops.
 */
export interface PixelsHistoryChange { readonly kind: "pixels"; readonly patches: readonly PixelRectPatch[] }
export interface RasterSlotHistoryChange {
  readonly kind: "rasterSlot";
  readonly assetId: string;
  readonly tileId: number;
  readonly before: Omit<RasterAssetInfo, "revision"> | undefined;
  readonly after: Omit<RasterAssetInfo, "revision">;
  readonly beforeBytes: Uint8Array | undefined;
  readonly afterBytes: Uint8Array;
}
export interface PaletteAppendHistoryChange {
  readonly kind: "paletteAppend";
  readonly before: readonly PaletteEntry[];
  readonly after: readonly PaletteEntry[];
}
export type HistoryChange =
  | PixelsHistoryChange
  | RasterSlotHistoryChange
  | PaletteAppendHistoryChange
  | CellsHistoryChange
  | LayerHistoryChange
  | LayerPropsHistoryChange
  | MapHistoryChange
  | TilesetHistoryChange
  | TilesetListHistoryChange
  | PaletteHistoryChange
  | EntitiesHistoryChange
  | EntityTypesHistoryChange
  | RandomSetsHistoryChange
  | CollectionsHistoryChange
  | MapPropsHistoryChange;

/** One undo step: all changes of one transaction, in the order they happened. */
export interface HistoryEntry {
  /**
   * Stable id of this step, unique for the store's lifetime (a counter that
   * never repeats). Unlike the undo depth it does not shift when old steps
   * fall off the history limit, so UI that refers to "that step" (undo
   * labels, a toast's undo button) can check it is still the one on top.
   */
  readonly id: number;
  readonly changes: readonly HistoryChange[];
  /** The cell changes among `changes` (kept for v0.1 compatibility). */
  readonly patches: readonly LayerPatch[];
  /** Label given to `beginTransaction(label)` (round 4), if any. */
  readonly label?: string;
}

/** What kind of step a history list row is: its first non-cell change's kind, or `"cells"`. */
export type HistoryEntryKind = HistoryChange["kind"];

/** One row of {@link MapStore.historyEntries} (read-only summary of a step). */
export interface HistoryListItem {
  /** The step's {@link HistoryEntry.id}. */
  readonly id: number;
  /** The transaction label, when one was given. */
  readonly label?: string;
  readonly kind: HistoryEntryKind;
  /** Total cells changed by the step (all layers), when it changed any. */
  readonly cellCount?: number;
  /** `"done"`: on the undo stack (applied); `"undone"`: on the redo stack. */
  readonly state: "done" | "undone";
}

export interface MapStoreOptions {
  /** Maximum number of undo steps kept. Defaults to 1000. */
  historyLimit?: number;
  rasterAssets?: RasterAssets;
}

/** Groups dirty chunk keys per layer, preserving first-seen order. */
class DirtyTracker {
  readonly #layers = new Map<string, Set<ChunkKey>>();

  #lastId: string | null = null;
  #lastCx = Number.NaN;
  #lastCy = Number.NaN;

  add(layerId: string, x: number, y: number): void {
    const cx = x >> CHUNK_SHIFT;
    const cy = y >> CHUNK_SHIFT;
    if (layerId === this.#lastId && cx === this.#lastCx && cy === this.#lastCy) return;
    this.#lastId = layerId;
    this.#lastCx = cx;
    this.#lastCy = cy;
    let keys = this.#layers.get(layerId);
    if (!keys) {
      keys = new Set();
      this.#layers.set(layerId, keys);
    }
    keys.add(chunkKey(cx, cy));
  }

  result(): DirtyChunks[] {
    return [...this.#layers].map(([layerId, keys]) => ({ layerId, chunks: [...keys] }));
  }
}

/**
 * Collects the changes of an open transaction. Consecutive cell writes are
 * merged per cell (first `before`, last `after`); a structural change closes
 * the current cell segment so ordering across structure changes is kept.
 */
class ChangeRecorder {
  readonly #changes: HistoryChange[] = [];
  #cells: PatchBuilder | null = null;

  recordCell(layerId: string, x: number, y: number, before: Cell, after: Cell): void {
    this.#cells ??= new PatchBuilder();
    this.#cells.record(layerId, x, y, before, after);
  }

  /** Records an op's already built cell changes (cheaper than recording each cell twice). */
  mergeCells(layerId: string, changes: CellChangeSet): void {
    this.#cells ??= new PatchBuilder();
    this.#cells.merge(layerId, changes);
  }

  recordStructural(change: HistoryChange): void {
    this.#flush();
    // Full-tile history snapshots merge per tile between allocation barriers.
    // Cell/metadata ordering stays intact; dirty events still report exact rects.
    if (change.kind === "pixels") {
      const remaining: PixelRectPatch[] = [];
      for (const patch of change.patches) {
        let merged = false;
        for (let i = this.#changes.length - 1; i >= 0; i--) {
          const prior = this.#changes[i]!;
          if (prior.kind !== "pixels" && prior.kind !== "tileset" && prior.kind !== "cells") break;
          if (prior.kind !== "pixels") continue;
          const at = prior.patches.findIndex(p => p.assetId === patch.assetId && p.tileId === patch.tileId);
          if (at < 0) continue;
          const old = prior.patches[at]!;
          if (old.x === patch.x && old.y === patch.y && old.width === patch.width && old.height === patch.height) {
            const patches = prior.patches.map((p, j) => j === at ? ownedPixelPatch(p, old.before, patch.after) : p);
            this.#changes[i] = Object.freeze({ kind: "pixels", patches: Object.freeze(patches) });
            merged = true;
          }
          break;
        }
        if (!merged) remaining.push(patch);
      }
      if (remaining.length) this.#changes.push(Object.freeze({ kind: "pixels", patches: Object.freeze(remaining) }));
      return;
    }
    // Consecutive edits of one entity layer (a drag) merge into one change.
    const last = this.#changes[this.#changes.length - 1];
    if (change.kind === "entities" && last?.kind === "entities" && last.layerId === change.layerId) {
      this.#changes.pop();
      if (!sameEntities(last.before, change.after)) {
        this.#changes.push(Object.freeze({ kind: "entities", layerId: change.layerId, before: last.before, after: change.after }));
      }
      return;
    }
    this.#changes.push(change);
  }

  build(): HistoryChange[] {
    this.#flush();
    return this.#changes;
  }

  #flush(): void {
    if (!this.#cells) return;
    for (const { layerId, changes } of this.#cells.build()) this.#changes.push(cellsChange(layerId, changes));
    this.#cells = null;
  }
}

/** History change backed by compact per-chunk arrays (its `cells` list is built only when read). */
function cellsChange(layerId: string, changes: CellChangeSet): CellsHistoryChange {
  return withCellChanges({ kind: "cells" as const, layerId }, changes);
}

/** Op result backed by compact per-chunk arrays. */
function cellPatch(layerId: string, changes: CellChangeSet): LayerPatch {
  return withCellChanges({ layerId }, changes);
}

function emptyPatch(layerId: string): LayerPatch {
  return Object.freeze({ layerId, cells: Object.freeze([]) });
}

let nextEntryId = 1;

function makeEntry(changes: readonly HistoryChange[], label?: string): HistoryEntry {
  // Cell changes are LayerPatch-shaped already; `patches` shares them.
  const patches = changes.filter((c): c is CellsHistoryChange => c.kind === "cells");
  return Object.freeze({
    id: nextEntryId++,
    changes: Object.freeze([...changes]),
    patches: Object.freeze(patches),
    ...(label !== undefined ? { label } : {}),
  });
}

function historyItem(entry: HistoryEntry, state: "done" | "undone"): HistoryListItem {
  const kind = entry.changes.find((c) => c.kind !== "cells")?.kind ?? "cells";
  let cells = 0;
  for (const patch of entry.patches) cells += patchCellCount(patch);
  return Object.freeze({
    id: entry.id,
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    kind,
    ...(cells > 0 ? { cellCount: cells } : {}),
    state,
  });
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Same entities in the same order (entities are normalized, so their JSON is canonical). */
function sameEntities(a: readonly Entity[], b: readonly Entity[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i] || JSON.stringify(v) === JSON.stringify(b[i]));
}

function samePropValues(a: LayerPropValues, b: LayerPropValues): boolean {
  return a.name === b.name && a.visible === b.visible && a.locked === b.locked && a.opacity === b.opacity;
}

/**
 * Moves every cell of `chunks` by (`dx`, `dy`) and drops cells outside
 * `width` × `height`. Returns the new chunks (sorted) and whether anything changed.
 */
function shiftChunks(
  chunks: readonly ChunkSnapshot[],
  dx: number,
  dy: number,
  width: number,
  height: number,
): { chunks: ChunkSnapshot[]; changed: boolean } {
  const out = new Map<ChunkKey, { cx: number; cy: number; data: Uint32Array }>();
  let changed = dx !== 0 || dy !== 0;
  for (const chunk of chunks) {
    const baseX = (chunk.cx << CHUNK_SHIFT) + dx;
    const baseY = (chunk.cy << CHUNK_SHIFT) + dy;
    const data = chunk.data;
    for (let i = 0; i < CHUNK_AREA; i++) {
      const cell = data[i]!;
      if (cell === 0) continue;
      const x = baseX + (i & CHUNK_MASK);
      const y = baseY + (i >> CHUNK_SHIFT);
      if (x < 0 || y < 0 || x >= width || y >= height) {
        changed = true;
        continue;
      }
      const cx = x >> CHUNK_SHIFT;
      const cy = y >> CHUNK_SHIFT;
      const key = chunkKey(cx, cy);
      let target = out.get(key);
      if (!target) {
        target = { cx, cy, data: new Uint32Array(CHUNK_AREA) };
        out.set(key, target);
      }
      target.data[localIndex(x & CHUNK_MASK, y & CHUNK_MASK)] = cell;
    }
  }
  return { chunks: [...out.values()].sort((a, b) => a.cy - b.cy || a.cx - b.cx), changed };
}

/** Accumulates the effects of applying history changes. */
class ApplyResult {
  readonly pixelRects: PixelDirtyRect[] = [];
  readonly dirty = new DirtyTracker();
  readonly structure = new Set<StructureChange>();
}

/** Marks every chunk of every tile layer dirty (the tiles behind palette indices changed). */
function markTileChunksDirty(doc: MapDocument, dirty: DirtyTracker): void {
  for (const layer of doc.layers) {
    if (!isTileLayer(layer)) continue;
    for (const chunk of layer.chunks()) dirty.add(layer.id, chunk.cx << CHUNK_SHIFT, chunk.cy << CHUNK_SHIFT);
  }
}

function paletteKey(entry: PaletteEntry): string {
  return `${entry.tileId}:${entry.tilesetId}`;
}

function assertImageSize(name: string, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`${name}: image size must be positive integers, got ${String(width)}×${String(height)}`);
  }
}

/**
 * State of one op that may produce several changes (grid + derived tiles,
 * tileset + re-derived tiles, resize + re-derived tiles). Inside a
 * transaction it records into the transaction; otherwise into its own
 * recorder that becomes one undo step.
 */
const STRUCTURE_ORDER: readonly StructureChange[] = ["layers", "tilesets", "palette", "map", "entities", "entityTypes", "randomSets", "collections", "props"];

interface OpContext {
  readonly pixelRects: PixelDirtyRect[];
  readonly rec: ChangeRecorder;
  readonly local: boolean;
  readonly dirty: DirtyTracker;
  readonly structure: Set<StructureChange>;
}

/**
 * Owns a `MapDocument` and is the only thing that mutates it.
 *
 * - `dispatch(op)` applies a plain-data {@link Op}.
 * - `beginTransaction()` / `commit()` group many ops into one undo step
 *   (mouse-down → mouse-up). Transactions nest; only the outermost commit
 *   creates the step. `rollback()` reverts the open transaction.
 * - `undo()` / `redo()` swap the `before` / `after` of a step's changes
 *   (cell patches, layer add/remove/move/props, map resize).
 * - `subscribe(listener)` reports dirty chunks and structural changes.
 */
export class MapStore {
  readonly #doc: MapDocument;
  readonly #rasters: RasterAssets;
  readonly #listeners = new Set<StoreListener>();
  readonly #undo: HistoryEntry[] = [];
  readonly #redo: HistoryEntry[] = [];
  readonly #historyLimit: number;
  /** Latest image provenance overlays historical tileset snapshots, including removed assets. */
  readonly #generatedProvenance = new Map<string, GeneratedTilesetMetadata>();
  #revision = 0;
  #depth = 0;
  #pending: ChangeRecorder | null = null;
  #pendingLabel: string | undefined = undefined;
  /** Palette entries moved aside by the last application of a palette change (see `#applyPaletteChange`). */
  readonly #displaced = new WeakMap<PaletteHistoryChange, { index: number; entry: PaletteEntry; from: PaletteEntry }[]>();

  constructor(document: MapDocument, options: MapStoreOptions = {}) {
    this.#doc = document;
    this.#rasters = options.rasterAssets ?? new RasterAssets();
    this.#historyLimit = Math.max(0, options.historyLimit ?? 1000);
  }

  get rasterAssets(): RasterAssetsView { return this.#rasters.view; }

  /** The document. Read freely; never mutate it directly. */
  get document(): MapDocument {
    return this.#doc;
  }

  /** Increases by one on every change to the document's content. Never decreases. */
  get revision(): number {
    return this.#revision;
  }

  /** True while a transaction is open. */
  get inTransaction(): boolean {
    return this.#depth > 0;
  }

  /** True when there is a step to undo and no transaction is open. */
  get canUndo(): boolean {
    return this.#depth === 0 && this.#undo.length > 0;
  }

  /** True when there is a step to redo and no transaction is open. */
  get canRedo(): boolean {
    return this.#depth === 0 && this.#redo.length > 0;
  }

  /** Number of undo steps available. */
  get undoDepth(): number {
    return this.#undo.length;
  }

  /** Number of redo steps available. */
  get redoDepth(): number {
    return this.#redo.length;
  }

  /** The step `undo()` would undo (its {@link HistoryEntry.id} identifies it), or `undefined`. */
  peekUndo(): HistoryEntry | undefined {
    return this.#undo[this.#undo.length - 1];
  }

  /** The step `redo()` would redo, or `undefined`. */
  peekRedo(): HistoryEntry | undefined {
    return this.#redo[this.#redo.length - 1];
  }

  /**
   * Read-only summary of the history for a history list: the undo stack
   * bottom → top (`state: "done"`, oldest first; the last one is what
   * `undo()` undoes), followed by the redo stack in redo order
   * (`state: "undone"`; the first one is what `redo()` redoes). The number
   * of `"done"` rows equals {@link undoDepth}.
   */
  historyEntries(): HistoryListItem[] {
    const out = this.#undo.map((e) => historyItem(e, "done"));
    for (let i = this.#redo.length - 1; i >= 0; i--) out.push(historyItem(this.#redo[i]!, "undone"));
    return out;
  }

  /**
   * Undoes steps until step `id` (on the undo stack) is undone, i.e. `id`
   * and every later step. Returns the number of steps undone: 0 when `id` is
   * not on the undo stack or a transaction is open. One `undo()` per step,
   * so listeners see one event per step and every step stays a whole
   * transaction.
   */
  undoTo(id: number): number {
    if (this.#depth > 0) return 0;
    const at = this.#undo.findIndex((e) => e.id === id);
    if (at < 0) return 0;
    let n = 0;
    while (this.#undo.length > at && this.undo()) n++;
    return n;
  }

  /**
   * Redoes steps until step `id` (on the redo stack) is redone, i.e. every
   * undone step up to and including `id`. Returns the number of steps
   * redone: 0 when `id` is not on the redo stack or a transaction is open.
   */
  redoTo(id: number): number {
    if (this.#depth > 0) return 0;
    const at = this.#redo.findIndex((e) => e.id === id);
    if (at < 0) return 0;
    let n = 0;
    while (this.#redo.length > at && this.redo()) n++;
    return n;
  }

  /** Registers a change listener. Returns an unsubscribe function. */
  subscribe(listener: StoreListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Applies an operation. See each op type for its result and rules. */
  dispatch<O extends Op>(op: O): OpResult<O>;
  dispatch(op: Op): OpResult<Op> {
    switch (op.type) {
      case "setEditedTileset": return this.#setEditedTileset(op);
      case "allocateEditedTile": return this.#allocateEditedTile(op);
      case "editTilePixels": return this.#editTilePixels(op);
      case "patchPixels": return this.#patchPixels(op);
      case "remapCells": return this.#remapCells(op);
      case "loadRasterAsset": return this.#loadRasterAsset(op);
      case "paintCells":
        return this.#paintCells(op);
      case "setRandomSet":
        return this.#setRandomSet(op);
      case "removeRandomSet":
        return this.#removeRandomSet(op);
      case "setCollection":
        return this.#setCollection(op);
      case "removeCollection":
        return this.#removeCollection(op);
      case "setMapProps":
        return this.#setMapProps(op);
      case "addTileset":
        return this.#addTileset(op);
      case "removeTileset":
        return this.#removeTileset(op);
      case "setTilesetMeta":
        return this.#setTilesetMeta(op);
      case "moveTileset":
        return this.#moveTileset(op);
      case "duplicateLayer":
        return this.#duplicateLayer(op);
      case "mergeLayerDown":
        return this.#mergeLayerDown(op);
      case "addLayer":
        return this.#addLayer(op);
      case "addPaletteEntry":
        return this.#addPaletteEntry(op);
      case "removeLayer":
        return this.#removeLayer(op);
      case "moveLayer":
        return this.#moveLayer(op);
      case "setLayerProps":
        return this.#setLayerProps(op);
      case "resizeMap":
        return this.#resizeMap(op);
      case "paintGrid":
        return this.#paintGrid(op);
      case "addEntity":
        return this.#addEntity(op);
      case "removeEntity":
        return this.#removeEntity(op);
      case "moveEntity":
        return this.#moveEntity(op);
      case "updateEntity":
        return this.#updateEntity(op);
      case "defineEntityType":
        return this.#defineEntityType(op);
      case "removeEntityType":
        return this.#removeEntityType(op);
      case "updateTilesetGrid":
        return this.#updateTilesetGrid(op);
      case "replaceTilesetImage":
        return this.#replaceTilesetImage(op);
      default: {
        const unknown: never = op;
        throw new TypeError(`Unknown op type: ${String((unknown as { type: unknown }).type)}`);
      }
    }
  }

  /** Shorthand for an `addPaletteEntry` op: palette index for a tile, added if missing. */
  getOrAddPaletteIndex(tilesetId: string, tileId: number): number {
    return this.dispatch({ type: "addPaletteEntry", tilesetId, tileId });
  }

  /**
   * Opens a transaction (nestable). Pair every call with `commit()` or
   * `rollback()`. `label` (round 4) names the resulting undo step in
   * {@link historyEntries}; the first label given while the outermost
   * transaction is open wins.
   */
  beginTransaction(label?: string): void {
    this.#depth++;
    if (label !== undefined && this.#pendingLabel === undefined) this.#pendingLabel = label;
    if (this.#depth > 1) return;
    this.#pending = new ChangeRecorder();
    // canUndo/canRedo read false while a transaction is open.
    this.#emit({ cause: "begin", cells: [], structure: [], historyChanged: true });
  }

  /**
   * Closes a transaction. When the outermost transaction closes and it changed
   * anything undoable, it becomes one undo step and the redo stack is cleared.
   *
   * @throws Error when no transaction is open.
   */
  commit(): void {
    if (this.#depth === 0) throw new Error("commit() called without an open transaction");
    this.#depth--;
    if (this.#depth > 0) return;
    const changes = this.#pending?.build() ?? [];
    const label = this.#pendingLabel;
    this.#pending = null;
    this.#pendingLabel = undefined;
    if (changes.length > 0) this.#pushUndo(makeEntry(changes, label));
    this.#emit({ cause: "commit", cells: [], structure: [], historyChanged: true });
  }

  /**
   * Reverts every undoable change of the open transaction (all nesting levels)
   * and closes it without creating an undo step. Non-undoable ops
   * (palette entries, appended tilesets and cache-only generated provenance) stay.
   *
   * @throws Error when no transaction is open.
   */
  rollback(): void {
    if (this.#depth === 0) throw new Error("rollback() called without an open transaction");
    const changes = this.#pending?.build() ?? [];
    this.#pending = null;
    this.#pendingLabel = undefined;
    this.#depth = 0;
    const result = this.#applyChanges(changes, "before");
    this.#emit({ cause: "rollback", ...this.#eventParts(result), historyChanged: true });
  }

  /** Undoes the last step. Returns false (and does nothing) if impossible or a transaction is open. */
  undo(): boolean {
    if (!this.canUndo) return false;
    const entry = this.#undo.pop()!;
    this.#redo.push(entry);
    const result = this.#applyChanges(entry.changes, "before");
    this.#emit({ cause: "undo", ...this.#eventParts(result), historyChanged: true });
    return true;
  }

  /** Redoes the last undone step. Returns false (and does nothing) if impossible or a transaction is open. */
  redo(): boolean {
    if (!this.canRedo) return false;
    const entry = this.#redo.pop()!;
    this.#undo.push(entry);
    const result = this.#applyChanges(entry.changes, "after");
    this.#emit({ cause: "redo", ...this.#eventParts(result), historyChanged: true });
    return true;
  }

  /** Drop the linear redo tail without disturbing committed undo entries (world coordinator). */
  clearRedo(): void {
    if (!this.#redo.length) return;
    this.#redo.length = 0;
    this.#emit({ cause: "commit", cells: [], structure: [], historyChanged: true, historyReset: "redo" });
  }

  /** A map in the same world uses exactly the same raster backing store. */
  createSibling(document: MapDocument): MapStore {
    return new MapStore(document, { rasterAssets: this.#rasters, historyLimit: this.#historyLimit });
  }

  /** Synchronize validated project metadata in place; this is not a new user action. */
  syncProjectData(source: MapDocument): void {
    if (this.inTransaction) throw new Error("project metadata cannot be synchronized during a transaction");
    const structure: StructureChange[] = [];
    const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
    if (!same(this.#doc.tilesets, source.tilesets)) {
      this.#doc._setTilesets(source.tilesets);
      for (const ts of source.tilesets) if (ts.generated) this.#generatedProvenance.set(ts.id, ts.generated);
      structure.push("tilesets");
    }
    if (!same(this.#doc.entityTypes, source.entityTypes)) { this.#doc._setEntityTypes(source.entityTypes); structure.push("entityTypes"); }
    if (!same(this.#doc.randomSets, source.randomSets)) { this.#doc._setRandomSets(source.randomSets); structure.push("randomSets"); }
    if (!same(this.#doc.collections, source.collections)) { this.#doc._setCollections(source.collections); structure.push("collections"); }
    if (structure.length) this.#emit({ cause: "dispatch", cells: [], structure, historyChanged: false });
  }

  /** Drops all undo/redo steps (e.g. after opening a file or setting up a new document). */
  clearHistory(): void {
    if (this.#undo.length === 0 && this.#redo.length === 0) return;
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#emit({ cause: "commit", cells: [], structure: [], historyChanged: true, historyReset: "all" });
  }

  // ---------------------------------------------------------------- ops

  #setEditedTileset(op: SetEditedTilesetOp): void {
    const old = this.#doc.getTileset(op.tileset.id);
    if (!old?.edited || !op.tileset.edited) throw new Error('setEditedTileset requires an existing edited asset');
    const next = normalizeTileset(op.tileset);
    const problem = tilesetProblem(next);
    if (problem) throw new Error(problem);
    if (old.tileWidth !== next.tileWidth || old.tileHeight !== next.tileHeight || next.edited!.nextTileId < old.edited.nextTileId || old.edited.origins.some(origin => !next.edited!.origins.some(o => JSON.stringify(o) === JSON.stringify(origin)))) throw new Error('edited slots and origins cannot be reassigned');
    if (JSON.stringify(old) === JSON.stringify(next)) return;
    const ctx = this.#openOp();
    this.#replaceTileset(ctx, next);
    this.#closeOp(ctx);
  }

  #loadRasterAsset(op: LoadRasterAssetOp): void {
    if (this.inTransaction || this.canUndo || this.canRedo) throw new Error('loadRasterAsset requires an empty history');
    const ts = this.#doc.getTileset(op.asset.assetId);
    if (!ts) throw new Error('loadRasterAsset: unknown tileset');
    const { tileWidth, tileHeight, columns, rows } = op.asset;
    if (tileWidth !== ts.tileWidth || tileHeight !== ts.tileHeight || columns !== ts.columns || rows !== ts.rows) throw new Error('raster grid differs from tileset');
    const data = canonicalRgba(tileWidth * columns, tileHeight * rows, op.asset.data);
    if (ts.edited && rasterContentHash(tileWidth * columns, tileHeight * rows, data) !== ts.edited.contentHash) throw new Error('raster content hash mismatch');
    if (ts.edited) {
      for (let id = ts.edited.nextTileId; id < columns * rows; id++) {
        for (let y = 0; y < tileHeight; y++) {
          const p = ((Math.floor(id / columns) * tileHeight + y) * tileWidth * columns + (id % columns) * tileWidth) * 4;
          if (data.subarray(p, p + tileWidth * 4).some(Boolean)) throw new Error('unallocated edited slots must be transparent');
        }
      }
    }
    this.#rasters._load({ ...op.asset, data }, ts.edited?.nextTileId);
    this.#emit({ cause: 'dispatch', cells: [], structure: [], pixelRects: Array.from({ length: ts.edited?.nextTileId ?? columns * rows }, (_, tileId) => ({ assetId: ts.id, tileId, x: 0, y: 0, width: tileWidth, height: tileHeight })), historyChanged: false });
  }

  #allocateEditedTile(op: AllocateEditedTileOp): EditedTileSlot {
    const pixels = canonicalRgba(op.tileWidth, op.tileHeight, op.pixels);
    assertRasterSize(op.tileWidth * EDITED_ATLAS_COLUMNS, op.tileHeight);
    if (op.source && (!op.source.tilesetId || !Number.isSafeInteger(op.source.tileId) || op.source.tileId < 0 || !op.source.pixelHash)) throw new Error('invalid edited source');
    const ts = this.#doc.tilesets.find(t => t.edited && t.tileWidth === op.tileWidth && t.tileHeight === op.tileHeight && t.edited.nextTileId < MAX_EDITED_TILES && (Math.ceil((t.edited.nextTileId + 1) / EDITED_ATLAS_COLUMNS) * op.tileHeight * op.tileWidth * EDITED_ATLAS_COLUMNS * 4 <= MAX_RASTER_BYTES));
    let assetId = ts?.id;
    if (!assetId) for (let n = 1; ; n++) {
      const candidate = `edited-${op.tileWidth}x${op.tileHeight}-${n}`;
      if (!this.#doc.getTileset(candidate) && !this.#rasters.info(candidate)) { assetId = candidate; break; }
    }
    const tileId = ts?.edited?.nextTileId ?? 0;
    const rows = Math.ceil((tileId + 1) / EDITED_ATLAS_COLUMNS);
    const width = op.tileWidth * EDITED_ATLAS_COLUMNS, height = rows * op.tileHeight;
    assertRasterSize(width, height);
    const before = this.#rasters.info(assetId!);
    if (ts && (!before || before.tileCount !== ts.edited!.nextTileId || before.columns !== ts.columns || before.rows !== ts.rows || before.tileWidth !== ts.tileWidth || before.tileHeight !== ts.tileHeight)) throw new Error('edited raster must be loaded before allocation');
    const oldTile = this.#rasters.getTile(assetId!, tileId)?.data;
    const old = this.#rasters.getAsset(assetId!);
    const data = new Uint8Array(width * height * 4);
    if (old) data.set(old.data);
    for (let y = 0; y < op.tileHeight; y++) data.set(pixels.subarray(y * op.tileWidth * 4, (y + 1) * op.tileWidth * 4), ((Math.floor(tileId / 16) * op.tileHeight + y) * width + (tileId % 16) * op.tileWidth) * 4);
    const contentHash = rasterContentHash(width, height, data);
    const origins = [...(ts?.edited?.origins ?? []), ...(op.source ? [{ tileId, sourceTilesetId: op.source.tilesetId, sourceTileId: op.source.tileId, sourcePixelHash: op.source.pixelHash }] : [])];
    const next = normalizeTileset({ ...(ts ?? { id: assetId!, name: op.name ?? assetId!, tileWidth: op.tileWidth, tileHeight: op.tileHeight, columns: EDITED_ATLAS_COLUMNS, margin: 0, spacing: 0 }), rows, imagePath: editedImagePath(assetId!, contentHash), edited: { kind: 'pixel', layoutVersion: 1, nextTileId: tileId + 1, contentHash, origins } });
    const problem = tilesetProblem(next);
    if (problem) throw new Error(problem);
    // Preflight palette capacity before any raster/metadata mutation.
    if (this.#doc.palette.size >= 0x1fffffff) throw new Error('palette is full');
    const ctx = this.#openOp();
    const after = Object.freeze({ tileCount: tileId + 1, assetId: assetId!, tileWidth: op.tileWidth, tileHeight: op.tileHeight, columns: EDITED_ATLAS_COLUMNS, rows });
    this.#rasters._slot(after, assetId!, tileId, pixels);
    ctx.rec.recordStructural(Object.freeze({ kind: 'rasterSlot', assetId: assetId!, tileId, before, after, get beforeBytes() { return oldTile?.slice(); }, get afterBytes() { return pixels.slice(); } }));
    if (ts) this.#replaceTileset(ctx, next);
    else this.#setTilesetList(ctx, [...this.#doc.tilesets, next]);
    const paletteBefore = Object.freeze([...this.#doc.palette.entries()]);
    const paletteIndex = this.#doc.palette._getOrAdd(assetId!, tileId);
    ctx.rec.recordStructural(Object.freeze({ kind: 'paletteAppend', before: paletteBefore, after: Object.freeze([...this.#doc.palette.entries()]) }));
    ctx.structure.add('palette');
    ctx.pixelRects.push({ assetId: assetId!, tileId, x: 0, y: 0, width: op.tileWidth, height: op.tileHeight });
    this.#closeOp(ctx);
    return Object.freeze({ assetId: assetId!, tileId, paletteIndex });
  }

  #remapCells(op: RemapCellsOp): LayerPatch {
    this.#assertTile('remapCells', op.tilesetId, op.tileId);
    const layer = this.#doc.getLayer(op.layerId);
    if (!isTileLayer(layer)) throw new Error('remapCells requires a tile layer');
    for (const c of op.cells) if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || !this.#doc.inBounds(c.x, c.y)) throw new RangeError('remapCells: cell outside map');
    if (layer.locked || !op.cells.length) return emptyPatch(layer.id);
    const index = this.#doc.palette.indexOf(op.tilesetId, op.tileId);
    if (!index) throw new Error('remapCells: add palette entry before remapping');
    return this.#paintCells({ type: 'paintCells', layerId: layer.id, cells: op.cells.map(c => ({ ...c, cell: makeCell(index, cellFlags(layer.getCell(c.x, c.y))) })) });
  }

  #editTilePixels(op: EditTilePixelsOp): readonly PixelRectPatch[] {
    const tile = this.#rasters.getTile(op.assetId, op.tileId);
    if (!tile) throw new Error('editTilePixels: missing raster tile');
    assertPixelRect(op, tile.width, tile.height);
    const before = cropPixels(tile.data, tile.width, op);
    if (op.before && !equalBytes(before, op.before)) throw new Error('stale pixel patch');
    return this.#patchPixels({ type: 'patchPixels', patches: [{ ...op, before, after: op.after }] });
  }

  #patchPixels(op: PatchPixelsOp): readonly PixelRectPatch[] {
    const patches: PixelRectPatch[] = [];
    const rects: PixelDirtyRect[] = [];
    const images = new Map<string, { width: number; height: number; data: Uint8Array }>();
    const tiles = new Map<string, { rect: PixelDirtyRect; before: Uint8Array; after: Uint8Array }>();
    // All validation, hashing and allocation happens before the first mutation.
    for (const p of op.patches) {
      const ts = this.#doc.getTileset(p.assetId);
      if (ts?.edited && this.#rasters.info(p.assetId)?.tileCount !== ts.edited.nextTileId) throw new Error('edited metadata must be synchronized before writing');
      if (!ts?.edited || !Number.isSafeInteger(p.tileId) || p.tileId < 0 || p.tileId >= ts.edited.nextTileId) throw new Error('pixel writes require an allocated edited tile');
      const tile = this.#rasters.getTile(p.assetId, p.tileId);
      if (!tile) throw new Error('pixel raster is not loaded');
      assertPixelRect(p, tile.width, tile.height);
      const before = cropPixels(tile.data, tile.width, p);
      if (!(p.before instanceof Uint8Array) || !equalBytes(before, p.before)) throw new Error('stale pixel patch');
      const after = canonicalRgba(p.width, p.height, p.after);
      for (const q of rects) if (p.assetId === q.assetId && p.tileId === q.tileId && p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) throw new Error('overlapping pixel patches');
      rects.push(dirtyPixelRect(p));
      if (equalBytes(before, after)) continue;
      patches.push(ownedPixelPatch(p, before, after));
      const key = `${p.assetId.length}:${p.assetId}:${p.tileId}`;
      let history = tiles.get(key);
      if (!history) {
        history = { rect: { assetId: p.assetId, tileId: p.tileId, x: 0, y: 0, width: tile.width, height: tile.height }, before: tile.data, after: tile.data.slice() };
        tiles.set(key, history);
      }
      for (let row = 0; row < p.height; row++) history.after.set(after.subarray(row * p.width * 4, (row + 1) * p.width * 4), ((p.y + row) * tile.width + p.x) * 4);
      let image = images.get(p.assetId);
      if (!image) { image = this.#rasters.getAsset(p.assetId)!; images.set(p.assetId, image); }
      const x = (p.tileId % ts.columns) * ts.tileWidth + p.x;
      const y = Math.floor(p.tileId / ts.columns) * ts.tileHeight + p.y;
      for (let row = 0; row < p.height; row++) image.data.set(after.subarray(row * p.width * 4, (row + 1) * p.width * 4), ((y + row) * image.width + x) * 4);
    }
    if (!patches.length) return Object.freeze([]);
    const metadata = [...images].map(([id, image]) => {
      const ts = this.#doc.getTileset(id)!;
      const contentHash = rasterContentHash(image.width, image.height, image.data);
      return normalizeTileset({ ...ts, imagePath: editedImagePath(id, contentHash), edited: { ...ts.edited!, contentHash } });
    });
    const ctx = this.#openOp();
    for (const p of patches) {
      this.#rasters._rect(p.assetId, p.tileId, p.x, p.y, p.width, p.height, p.after);
      ctx.pixelRects.push(dirtyPixelRect(p));
    }
    const owned = Object.freeze(patches);
    ctx.rec.recordStructural(Object.freeze({ kind: 'pixels', patches: Object.freeze([...tiles.values()].map(t => ownedPixelPatch(t.rect, t.before, t.after))) }));
    for (const next of metadata) this.#replaceTileset(ctx, next);
    this.#closeOp(ctx);
    return owned;
  }



  #paintCells(op: PaintCellsOp): LayerPatch {
    const layer = this.#doc.getLayer(op.layerId);
    if (!layer) throw new Error(`paintCells: unknown layer "${op.layerId}"`);
    if (isGridLayer(layer)) throw new TypeError(`paintCells: "${op.layerId}" is a grid layer; use paintGrid`);
    if (isEntityLayer(layer)) throw new TypeError(`paintCells: "${op.layerId}" is an entity layer`);
    const palette = this.#doc.palette;
    let checked = Number.NaN; // last validated cell value (fills and brushes repeat one value)
    for (const { x, y, cell } of op.cells) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new TypeError(`paintCells: coordinates must be integers, got (${x}, ${y})`);
      }
      if (cell === checked) continue;
      if (!isValidCell(cell)) throw new RangeError(`paintCells: invalid cell value ${cell} at (${x}, ${y})`);
      if (!palette.has(cellPaletteIndex(cell))) {
        throw new RangeError(`paintCells: palette index ${cellPaletteIndex(cell)} does not exist (at (${x}, ${y}))`);
      }
      checked = cell;
    }

    if (layer.locked) return emptyPatch(layer.id);

    const opPatch = new PatchBuilder();
    const dirty = new DirtyTracker();
    for (const { x, y, cell } of op.cells) {
      if (!this.#doc.inBounds(x, y)) continue;
      const before = layer._setCell(x, y, cell);
      if (before === cell) continue;
      opPatch.record(layer.id, x, y, before, cell);
      dirty.add(layer.id, x, y);
    }

    const built = opPatch.build()[0];
    if (!built) return emptyPatch(layer.id);
    this.#pending?.mergeCells(layer.id, built.changes);

    const autoCommit = this.#depth === 0;
    // The op result and the undo step share the same (immutable) arrays.
    if (autoCommit) this.#pushUndo(makeEntry([cellsChange(layer.id, built.changes)]));
    this.#emit({ cause: "dispatch", cells: dirty.result(), structure: [], historyChanged: autoCommit });
    return cellPatch(layer.id, built.changes);
  }

  #addTileset(op: AddTilesetOp): void {
    const problem = tilesetProblem(op.tileset);
    if (problem) throw new Error(`addTileset: ${problem}`);
    if (this.#doc.getTileset(op.tileset.id)) throw new Error(`addTileset: duplicate tileset id "${op.tileset.id}"`);
    if (op.undoable === false) {
      this.#doc._addTileset(op.tileset);
      this.#emit({ cause: "dispatch", cells: [], structure: ["tilesets"], historyChanged: false });
      return;
    }
    const ctx = this.#openOp();
    this.#setTilesetList(ctx, [...this.#doc.tilesets, normalizeTileset(op.tileset)]);
    this.#closeOp(ctx);
  }

  #removeTileset(op: RemoveTilesetOp): void {
    const tileset = this.#doc.getTileset(op.tilesetId);
    if (!tileset) throw new Error(`removeTileset: unknown tileset "${String(op.tilesetId)}"`);
    const indices = new Set<number>();
    this.#doc.palette.entries().forEach((entry, i) => {
      if (entry.tilesetId === tileset.id) indices.add(i + 1);
    });
    const clears: { layer: TileLayer; x: number; y: number; cell: Cell }[] = [];
    for (const layer of this.#doc.layers) {
      let test: ((cell: Cell) => boolean) | null = null;
      if (isTileLayer(layer) && indices.size > 0) test = (cell) => indices.has(cellPaletteIndex(cell));
      if (!test) continue;
      for (const chunk of layer.chunks()) {
        const data = chunk.data;
        for (let i = 0; i < data.length; i++) {
          const cell = data[i]!;
          if (cell !== 0 && test(cell)) {
            clears.push({ layer, x: (chunk.cx << CHUNK_SHIFT) + (i & CHUNK_MASK), y: (chunk.cy << CHUNK_SHIFT) + (i >> CHUNK_SHIFT), cell });
          }
        }
      }
    }
    const ctx = this.#openOp();
    for (const { layer, x, y, cell } of clears) {
      layer._setCell(x, y, 0);
      ctx.rec.recordCell(layer.id, x, y, cell, 0);
      ctx.dirty.add(layer.id, x, y);
    }
    this.#setTilesetList(ctx, this.#doc.tilesets.filter((t) => t.id !== tileset.id));
    this.#remapTilesetRefs(ctx, tileset.id, () => null);
    this.#closeOp(ctx);
  }

  #setTilesetMeta(op: SetTilesetMetaOp): void {
    const tileset = this.#doc.getTileset(op.tilesetId);
    if (!tileset) throw new Error(`setTilesetMeta: unknown tileset "${String(op.tilesetId)}"`);
    if (op.name !== undefined && typeof op.name !== "string") throw new TypeError("setTilesetMeta: name must be a string");
    if (op.group !== undefined && op.group !== null && typeof op.group !== "string") {
      throw new TypeError("setTilesetMeta: group must be a string or null");
    }
    if (op.undoable === false && (!op.generated || op.name !== undefined || op.group !== undefined)) {
      throw new Error("setTilesetMeta: cache refresh requires only generated provenance");
    }
    const name = op.name ?? tileset.name;
    const group = op.group === undefined ? tileset.group : op.group === null || op.group === "" ? undefined : op.group;
    if (op.generated !== undefined) {
      const old = tileset.generated;
      if (!old) throw new Error("setTilesetMeta: only an existing generated asset may be regenerated");
      const problem = tilesetProblem({ ...tileset, generated: op.generated });
      if (problem) throw new Error(`setTilesetMeta: ${problem}`);
      if ((["kind", "stampId", "layerId", "sourceWidth", "sourceHeight", "layoutVersion", "border"] as const).some(k => old[k] !== op.generated![k])) throw new Error("setTilesetMeta: generated origin and slot layout cannot change");
    }
    const generated = op.generated === undefined ? tileset.generated : normalizeTileset({ ...tileset, generated: op.generated }).generated;
    if (op.undoable === false) {
      this.#generatedProvenance.set(tileset.id, generated!);
      if (JSON.stringify(generated) === JSON.stringify(tileset.generated)) return;
      this.#doc._replaceTileset({ ...tileset, generated: generated! });
      this.#emit({ cause: "dispatch", cells: [], structure: ["tilesets"], historyChanged: false });
      return;
    }
    if (name === tileset.name && group === tileset.group && JSON.stringify(generated) === JSON.stringify(tileset.generated)) return;
    const { group: _old, ...rest } = tileset;
    const ctx = this.#openOp();
    this.#replaceTileset(ctx, { ...rest, name, ...(group !== undefined ? { group } : {}), ...(generated !== undefined ? { generated } : {}) });
    this.#closeOp(ctx);
  }

  #moveTileset(op: MoveTilesetOp): void {
    const list = this.#doc.tilesets;
    const from = list.findIndex((t) => t.id === op.tilesetId);
    if (from < 0) throw new Error(`moveTileset: unknown tileset "${String(op.tilesetId)}"`);
    const max = list.length - 1;
    if (!Number.isInteger(op.index) || op.index < 0 || op.index > max) {
      throw new RangeError(`moveTileset: index must be an integer in [0, ${max}], got ${op.index}`);
    }
    if (op.index === from) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(op.index, 0, moved!);
    const ctx = this.#openOp();
    this.#setTilesetList(ctx, next);
    this.#closeOp(ctx);
  }

  /** Replaces the tileset list (add / remove / reorder) and records it. */
  #setTilesetList(ctx: OpContext, next: readonly Tileset[]): void {
    const before = Object.freeze([...this.#doc.tilesets]);
    this.#doc._setTilesets(next);
    const after = Object.freeze([...this.#doc.tilesets]);
    ctx.rec.recordStructural(Object.freeze({ kind: "tilesetList", before, after }));
    ctx.structure.add("tilesets");
  }

  #addLayer(op: AddLayerOp): string {
    const layers = this.#doc.layers;
    const props: LayerProps = {
      id: op.layer.id ?? this.#generateLayerId(),
      name: op.layer.name,
      visible: op.layer.visible ?? true,
      locked: op.layer.locked ?? false,
      opacity: op.layer.opacity ?? 1,
    };
    const problem = layerPropsProblem(props);
    if (problem) throw new Error(`addLayer: ${problem}`);
    if (this.#doc.getLayer(props.id)) throw new Error(`addLayer: duplicate layer id "${props.id}"`);
    const index = op.index ?? layers.length;
    if (!Number.isInteger(index) || index < 0 || index > layers.length) {
      throw new RangeError(`addLayer: index must be an integer in [0, ${layers.length}], got ${index}`);
    }
    const type = op.layer.type ?? "tile";
    let layer: TileLayer;
    if (type === "grid") {
      const role = op.layer.role;
      if (!isGridRole(role)) throw new Error(`addLayer: a grid layer needs role "collision", got ${JSON.stringify(role)}`);
      layer = new GridLayer(props, role);
    } else if (type === "tile" || type === "entity") {
      if (op.layer.role !== undefined) {
        throw new Error("addLayer: role are only for grid layers");
      }
      layer = type === "tile" ? new TileLayer(props) : new EntityLayer(props);
    } else {
      throw new Error(`addLayer: unknown layer type ${JSON.stringify(type)}`);
    }
    this.#doc._insertLayer(layer, index);
    const change: LayerHistoryChange = Object.freeze({ kind: "layer", layer, before: null, after: index });
    this.#recordStructural(change, ["layers"]);
    return props.id;
  }

  #duplicateLayer(op: DuplicateLayerOp): string {
    const doc = this.#doc;
    const source = doc.getLayer(op.layerId);
    if (!source) throw new Error(`duplicateLayer: unknown layer "${String(op.layerId)}"`);
    const requested = op.name ?? source.name;
    if (typeof requested !== "string") throw new TypeError("duplicateLayer: name must be a string");
    const copyProps = (from: TileLayer, id: string, layerName: string): LayerProps => ({ id, ...from.props(), name: layerName });
    const ctx = this.#openOp();
    const insertAbove = (layer: TileLayer, belowId: string): void => {
      const index = doc.indexOfLayer(belowId) + 1;
      doc._insertLayer(layer, index);
      ctx.rec.recordStructural(Object.freeze({ kind: "layer", layer, before: null, after: index }));
      ctx.structure.add("layers");
    };

    let result: string;
    if (isGridLayer(source)) {
      const name = uniqueLayerName(doc, requested);
      const grid = new GridLayer(copyProps(source, this.#generateLayerId(), name), source.role);
      grid._restore(source._snapshot());
      insertAbove(grid, source.id);
      result = grid.id;
    } else if (isEntityLayer(source)) {
      const name = uniqueLayerName(doc, requested);
      const layer = new EntityLayer(copyProps(source, this.#generateLayerId(), name));
      const taken = new Set<string>();
      for (const l of doc.entityLayers()) for (const e of l.entities) taken.add(e.id);
      let n = taken.size;
      const entities: Entity[] = [];
      for (const e of source.entities) {
        if (e.typeId === SPAWN_TYPE_ID) continue;
        let id: string;
        do id = `e${++n}`;
        while (taken.has(id));
        taken.add(id);
        entities.push(normalizeEntity({ ...e, id }));
      }
      layer._setEntities(Object.freeze(entities));
      insertAbove(layer, source.id);
      result = layer.id;
    } else {
      const name = uniqueLayerName(doc, requested);
      const layer = new TileLayer(copyProps(source, this.#generateLayerId(), name));
      layer._restore(source._snapshot());
      insertAbove(layer, source.id);
      result = layer.id;
    }
    this.#closeOp(ctx);
    return result;
  }

  #mergeLayerDown(op: MergeLayerDownOp): string {
    const doc = this.#doc;
    const upper = doc.getLayer(op.layerId);
    if (!upper) throw new Error(`mergeLayerDown: unknown layer "${String(op.layerId)}"`);
    if (!isTileLayer(upper)) throw new LayerMergeError("notTileLayer", op.layerId, `"${op.layerId}" is not a tile layer`);
    const index = doc.indexOfLayer(upper.id);
    const lower = index > 0 ? doc.layers[index - 1] : undefined;
    if (!lower) throw new LayerMergeError("noLayerBelow", upper.id, `"${upper.id}" has no layer below`);
    if (!isTileLayer(lower)) throw new LayerMergeError("belowNotTileLayer", op.layerId, `layer below "${op.layerId}" is not a tile layer`);
    if (upper.locked || lower.locked) throw new LayerMergeError("locked", upper.id, `"${upper.locked ? upper.id : lower.id}" is locked`);

    const ctx = this.#openOp();
    for (const chunk of upper.chunks()) {
      const x0 = chunk.cx << CHUNK_SHIFT;
      const y0 = chunk.cy << CHUNK_SHIFT;
      const data = chunk.data;
      for (let i = 0; i < data.length; i++) {
        const cell = data[i]!;
        if (cell === 0) continue;
        const x = x0 + (i & CHUNK_MASK);
        const y = y0 + (i >> CHUNK_SHIFT);
        const before = lower._setCell(x, y, cell);
        if (before === cell) continue;
        ctx.rec.recordCell(lower.id, x, y, before, cell);
        ctx.dirty.add(lower.id, x, y);
      }
    }
    doc._removeLayerAt(index);
    ctx.rec.recordStructural(Object.freeze({ kind: "layer", layer: upper, before: index, after: null }));
    ctx.structure.add("layers");
    this.#closeOp(ctx);
    return lower.id;
  }

  #removeLayer(op: RemoveLayerOp): void {
    const index = this.#doc.indexOfLayer(op.layerId);
    if (index < 0) throw new Error(`removeLayer: unknown layer "${op.layerId}"`);
    const layer = this.#doc._removeLayerAt(index);
    this.#recordStructural({ kind: "layer", layer, before: index, after: null }, ["layers"]);
  }

  #moveLayer(op: MoveLayerOp): void {
    const from = this.#doc.indexOfLayer(op.layerId);
    if (from < 0) throw new Error(`moveLayer: unknown layer "${op.layerId}"`);
    const max = this.#doc.layers.length - 1;
    if (!Number.isInteger(op.index) || op.index < 0 || op.index > max) {
      throw new RangeError(`moveLayer: index must be an integer in [0, ${max}], got ${op.index}`);
    }
    if (op.index === from) return;
    const layer = this.#doc._removeLayerAt(from);
    this.#doc._insertLayer(layer, op.index);
    this.#recordStructural({ kind: "layer", layer, before: from, after: op.index }, ["layers"]);
  }

  #setLayerProps(op: SetLayerPropsOp): void {
    const layer = this.#doc.getLayer(op.layerId);
    if (!layer) throw new Error(`setLayerProps: unknown layer "${op.layerId}"`);
    const before = layer.props();
    const after: LayerPropValues = {
      name: op.props.name ?? before.name,
      visible: op.props.visible ?? before.visible,
      locked: op.props.locked ?? before.locked,
      opacity: op.props.opacity ?? before.opacity,
    };
    const problem = layerPropsProblem({ id: layer.id, ...after });
    if (problem) throw new Error(`setLayerProps: ${problem}`);
    if (samePropValues(before, after)) return;
    layer._setProps(after);
    this.#recordStructural(
      { kind: "layerProps", layerId: layer.id, before: Object.freeze(before), after: Object.freeze(after) },
      ["layers"],
    );
  }

  #resizeMap(op: ResizeMapOp): void {
    const before = this.#doc.map;
    const after: MapInfo = { ...before, width: op.width, height: op.height, tileWidth: op.tileWidth ?? before.tileWidth, tileHeight: op.tileHeight ?? before.tileHeight };
    const gridChanged = after.tileWidth !== before.tileWidth || after.tileHeight !== before.tileHeight;
    if (gridChanged && this.#doc.layers.some(l => l.chunkCount > 0 || (isEntityLayer(l) && l.entities.length > 0))) throw new Error("resizeMap: cell dimensions require an empty map");
    const problem = mapInfoProblem(after);
    if (problem) throw new RangeError(`resizeMap: ${problem}`);
    const dx = op.offsetX ?? 0;
    const dy = op.offsetY ?? 0;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
      throw new TypeError(`resizeMap: offsets must be integers, got (${dx}, ${dy})`);
    }
    if (!gridChanged && after.width === before.width && after.height === before.height && dx === 0 && dy === 0) return;

    const layers: MapHistoryChange["layers"][number][] = [];
    for (const layer of this.#doc.layers) {
      if (layer.chunkCount === 0) continue;
      const snapshot = layer._snapshot();
      const shifted = shiftChunks(snapshot, dx, dy, after.width, after.height);
      if (!shifted.changed) continue;
      layers.push(Object.freeze({ layerId: layer.id, before: snapshot, after: shifted.chunks }));
    }
    this.#doc._setMap(after);
    for (const entry of layers) this.#doc.getLayer(entry.layerId)!._restore(entry.after);
    const ctx = this.#openOp();
    ctx.rec.recordStructural(
      Object.freeze({ kind: "map", before, after: this.#doc.map, layers: Object.freeze(layers) }),
    );
    ctx.structure.add("map");
    // Entities move with the content (offset in cells → pixels); those that
    // end up outside the new bounds are dropped (undo brings them back).
    const pw = after.width * after.tileWidth;
    const ph = after.height * after.tileHeight;
    for (const layer of this.#doc.entityLayers()) {
      if (layer.entities.length === 0) continue;
      const next: Entity[] = [];
      for (const e of layer.entities) {
        const x = e.x + dx * after.tileWidth;
        const y = e.y + dy * after.tileHeight;
        if (x < 0 || y < 0 || x >= pw || y >= ph) continue;
        next.push(x === e.x && y === e.y ? e : normalizeEntity({ ...e, x, y }));
      }
      this.#setEntities(ctx, layer, next);
    }

    // "map" already means "rebuild every chunk"; no per-chunk report.
    this.#closeOp(ctx, false);
  }

  #paintGrid(op: PaintGridOp): LayerPatch {
    const layer = this.#doc.getLayer(op.layerId);
    if (!layer) throw new Error(`paintGrid: unknown layer "${op.layerId}"`);
    if (!isGridLayer(layer)) throw new TypeError(`paintGrid: "${op.layerId}" is not a grid layer`);
    const max = layer.maxValue;
    for (const { x, y, value } of op.cells) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new TypeError(`paintGrid: coordinates must be integers, got (${x}, ${y})`);
      }
      if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new RangeError(`paintGrid: value must be an integer in [0, ${max}], got ${value} at (${x}, ${y})`);
      }
    }
    if (layer.locked) return emptyPatch(layer.id);

    const opPatch = new PatchBuilder();
    const ctx = this.#openOp();
    for (const { x, y, value } of op.cells) {
      if (!this.#doc.inBounds(x, y)) continue;
      const before = layer._setCell(x, y, value);
      if (before === value) continue;
      opPatch.record(layer.id, x, y, before, value);
      ctx.dirty.add(layer.id, x, y);
    }
    const built = opPatch.build()[0];
    if (!built) {
      this.#closeOp(ctx);
      return emptyPatch(layer.id);
    }
    ctx.rec.mergeCells(layer.id, built.changes);

    this.#closeOp(ctx);
    return cellPatch(layer.id, built.changes);
  }

  #updateTilesetGrid(op: UpdateTilesetGridOp): TilesetRemapResult {
    const current = this.#doc.getTileset(op.tilesetId);
    if (current?.edited) throw new Error("edited atlas grids cannot change");
    if (!current) throw new Error(`updateTilesetGrid: unknown tileset "${op.tilesetId}"`);
    const spec = { tileWidth: op.tileWidth, tileHeight: op.tileHeight, margin: op.margin, spacing: op.spacing };
    const problem = tileGridSpecProblem(spec);
    if (problem) throw new RangeError(`updateTilesetGrid: ${problem}`);
    const extent = tilesetImageExtent(current);
    const imageWidth = op.imageWidth ?? extent.width;
    const imageHeight = op.imageHeight ?? extent.height;
    assertImageSize("updateTilesetGrid", imageWidth, imageHeight);
    return this.#regridTileset("updateTilesetGrid", current, tilesetWithGrid(current, spec, imageWidth, imageHeight));
  }

  #replaceTilesetImage(op: ReplaceTilesetImageOp): TilesetRemapResult {
    const current = this.#doc.getTileset(op.tilesetId);
    if (current?.edited) throw new Error("edited atlas grids cannot change");
    if (!current) throw new Error(`replaceTilesetImage: unknown tileset "${op.tilesetId}"`);
    assertImageSize("replaceTilesetImage", op.imageWidth, op.imageHeight);
    return this.#regridTileset("replaceTilesetImage", current, tilesetWithGrid(current, current, op.imageWidth, op.imageHeight));
  }

  #regridTileset(name: "updateTilesetGrid" | "replaceTilesetImage", current: Tileset, next: Tileset): TilesetRemapResult {
    if (current.generated && (next.rows < current.rows || (["tileWidth", "tileHeight", "margin", "spacing", "columns"] as const).some(k => next[k] !== current[k]))) throw new Error(`${name}: generated tile ids are append-only; cannot shrink or repack the grid`);
    const result = { remapped: 0, dropped: 0, outOfRange: 0, clearedCells: 0 };
    if (next.columns < 1 || next.rows < 1) {
      throw new RangeError(`${name}: not even one ${next.tileWidth}×${next.tileHeight} tile fits the image`);
    }
    if (
      (["tileWidth", "tileHeight", "margin", "spacing", "columns", "rows"] as const).every((k) => current[k] === next[k])
    ) {
      return Object.freeze(result);
    }
    const keepOutOfRange = name === "replaceTilesetImage";
    const remap = tilesetGridRemap(current, next);
    const newCount = next.columns * next.rows;

    // Palette: mapped entries take their new id; the others are parked on a
    // free id (out of range for replaceTilesetImage, any free id otherwise —
    // their cells are cleared) so that every (tileset, tile) pair stays unique.
    const palette = this.#doc.palette;
    const mine: { index: number; entry: PaletteEntry; to: number | null }[] = [];
    const taken = new Set<number>();
    palette.entries().forEach((entry, i) => {
      if (entry.tilesetId !== current.id) return;
      const to = remap(entry.tileId);
      mine.push({ index: i + 1, entry, to });
      if (to !== null) taken.add(to);
    });
    const minParked = keepOutOfRange ? newCount : 0;
    let nextFree = minParked;
    const writes: { index: number; before: PaletteEntry; after: PaletteEntry }[] = [];
    const dropped = new Set<number>();
    for (const { index, entry, to: mapped } of mine) {
      let to = mapped;
      if (to === null) {
        if (keepOutOfRange) result.outOfRange++;
        else dropped.add(index);
        if (entry.tileId >= minParked && !taken.has(entry.tileId)) {
          to = entry.tileId;
        } else {
          while (taken.has(nextFree)) nextFree++;
          to = nextFree;
        }
        taken.add(to);
      } else if (to !== entry.tileId) {
        result.remapped++;
      }
      if (to !== entry.tileId) writes.push(Object.freeze({ index, before: entry, after: Object.freeze({ tilesetId: entry.tilesetId, tileId: to }) }));
    }
    result.dropped = dropped.size;

    const nextTileset: Tileset = next;
    const problem = tilesetProblem(nextTileset);
    if (problem) throw new Error(`${name}: ${problem}`);

    // Cells that used a dropped palette entry.
    const clears: { layer: TileLayer; x: number; y: number; cell: Cell }[] = [];
    if (dropped.size > 0) {
      for (const layer of this.#doc.layers) {
        if (!isTileLayer(layer)) continue;
        for (const chunk of layer.chunks()) {
          const data = chunk.data;
          for (let i = 0; i < data.length; i++) {
            const cell = data[i]!;
            if (cell !== 0 && dropped.has(cellPaletteIndex(cell))) {
              clears.push({ layer, x: (chunk.cx << CHUNK_SHIFT) + (i & CHUNK_MASK), y: (chunk.cy << CHUNK_SHIFT) + (i >> CHUNK_SHIFT), cell });
            }
          }
        }
      }
    }
    result.clearedCells = clears.length;

    const ctx = this.#openOp();
    for (const { layer, x, y, cell } of clears) {
      layer._setCell(x, y, 0);
      ctx.rec.recordCell(layer.id, x, y, cell, 0);
      ctx.dirty.add(layer.id, x, y);
    }
    if (writes.length > 0) {
      palette._rewrite(writes.map(({ index, after }) => ({ index, entry: after })));
      ctx.rec.recordStructural(Object.freeze({ kind: "palette", entries: Object.freeze(writes) }));
      ctx.structure.add("palette");
    }
    this.#replaceTileset(ctx, nextTileset);
    // Collections and random sets follow the tiles' pixels. Tiles that map
    // nowhere (also out-of-range ones of replaceTilesetImage) are dropped
    // from them: a parked id could show other pixels. Undo brings them back.
    this.#remapTilesetRefs(ctx, current.id, remap);
    // The same palette indices now show other pixels: every tile chunk redraws.
    markTileChunksDirty(this.#doc, ctx.dirty);
    this.#closeOp(ctx);
    return Object.freeze(result);
  }

  #addPaletteEntry(op: AddPaletteEntryOp): number {
    if (op.undoable !== undefined && op.undoable !== true) throw new TypeError("addPaletteEntry: undoable must be true or omitted");
    const tileset = this.#doc.getTileset(op.tilesetId);
    if (!tileset) throw new Error(`addPaletteEntry: unknown tileset "${op.tilesetId}"`);
    if (!isValidTileId(tileset, op.tileId)) {
      throw new RangeError(`addPaletteEntry: tile id ${op.tileId} is outside tileset "${op.tilesetId}"`);
    }
    const palette = this.#doc.palette;
    const existing = palette.indexOf(op.tilesetId, op.tileId);
    if (existing !== 0) return existing;
    const before = tileset.edited || op.undoable === true ? Object.freeze([...palette.entries()]) : undefined;
    const index = palette._getOrAdd(op.tilesetId, op.tileId);
    if (before) {
      this.#recordStructural({ kind: "paletteAppend", before, after: Object.freeze([...palette.entries()]) }, ["palette"]);
      return index;
    }
    // Nonundoable growth can retain slots from a cancelled replacement
    // allocation. Invalidate allocation-dependent redo before its raw cell
    // indices can claim those slots. Cell-only redo keeps legacy semantics.
    const historyChanged = this.#redo.some(entry => entry.changes.some(change => change.kind === "paletteAppend"));
    if (historyChanged) this.#redo.length = 0;
    this.#emit({ cause: "dispatch", cells: [], structure: ["palette"], historyChanged, ...(historyChanged ? { historyReset: "redo" as const } : {}) });
    return index;
  }

  #entityLayer(what: string, layerId: string): EntityLayer {
    const layer = this.#doc.getLayer(layerId);
    if (!layer) throw new Error(`${what}: unknown layer "${layerId}"`);
    if (!isEntityLayer(layer)) throw new TypeError(`${what}: "${layerId}" is not an entity layer`);
    return layer;
  }

  #findEntity(what: string, entityId: string): { layer: EntityLayer; entity: Entity; index: number } {
    const found = this.#doc.findEntity(entityId);
    if (!found) throw new Error(`${what}: unknown entity "${String(entityId)}"`);
    return found;
  }

  #addEntity(op: AddEntityOp): string | null {
    const layer = this.#entityLayer("addEntity", op.layerId);
    const input = op.entity;
    const type = this.#doc.getEntityType(input?.typeId);
    if (!type) throw new Error(`addEntity: unknown entity type "${String(input?.typeId)}"`);
    const id = input.id ?? this.#generateEntityId();
    if (this.#doc.findEntity(id)) throw new Error(`addEntity: duplicate entity id "${id}"`);
    const entity = normalizeEntity({
      id,
      typeId: type.id,
      x: input.x,
      y: input.y,
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      fields: { ...defaultEntityFields(type), ...(input.fields ?? {}) },
    });
    const problem = entityProblem(entity, this.#doc.map, type);
    if (problem) throw new Error(`addEntity: ${problem}`);
    if (type.id === SPAWN_TYPE_ID && this.#doc.spawn()) throw new Error("addEntity: the level already has a spawn point");
    const list = layer.entities;
    const index = op.index ?? list.length;
    if (!Number.isInteger(index) || index < 0 || index > list.length) {
      throw new RangeError(`addEntity: index must be an integer in [0, ${list.length}], got ${index}`);
    }
    if (layer.locked) return null;
    const next = [...list];
    next.splice(index, 0, entity);
    this.#entityOp(layer, next);
    return id;
  }

  #removeEntity(op: RemoveEntityOp): void {
    const { layer, index } = this.#findEntity("removeEntity", op.entityId);
    if (layer.locked) return;
    this.#entityOp(layer, layer.entities.filter((_, i) => i !== index));
  }

  #moveEntity(op: MoveEntityOp): void {
    const { layer, entity, index } = this.#findEntity("moveEntity", op.entityId);
    const moved = normalizeEntity({ ...entity, x: op.x, y: op.y });
    const problem = entityProblem(moved, this.#doc.map);
    if (problem) throw new Error(`moveEntity: ${problem}`);
    if (layer.locked || (entity.x === op.x && entity.y === op.y)) return;
    this.#entityOp(layer, layer.entities.map((e, i) => (i === index ? moved : e)));
  }

  #updateEntity(op: UpdateEntityOp): void {
    const { layer, entity, index } = this.#findEntity("updateEntity", op.entityId);
    const type = this.#doc.getEntityType(entity.typeId);
    if (!type) throw new Error(`updateEntity: entity type "${entity.typeId}" is not defined`);
    const changed: Record<string, EntityFieldValue> = { ...(op.fields ?? {}) };
    for (const [name, value] of Object.entries(changed)) {
      const def = type.fields.find((f) => f.name === name);
      if (!def) throw new Error(`updateEntity: type "${type.id}" has no field "${name}"`);
      const problem = entityProblem({ ...entity, fields: { [name]: value } }, this.#doc.map, type);
      if (problem) throw new Error(`updateEntity: ${problem}`);
    }
    const width = op.width === undefined ? entity.width : (op.width ?? undefined);
    const height = op.height === undefined ? entity.height : (op.height ?? undefined);
    const next = normalizeEntity({
      id: entity.id,
      typeId: entity.typeId,
      x: entity.x,
      y: entity.y,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      fields: { ...entity.fields, ...changed },
    });
    const problem = entityProblem({ ...next, fields: {} }, this.#doc.map);
    if (problem) throw new Error(`updateEntity: ${problem}`);
    if (layer.locked || JSON.stringify(next) === JSON.stringify(entity)) return;
    this.#entityOp(layer, layer.entities.map((e, i) => (i === index ? next : e)));
  }

  #defineEntityType(op: DefineEntityTypeOp): void {
    const type = op.entityType;
    const problem = entityTypeProblem(type);
    if (problem) throw new Error(`defineEntityType: ${problem}`);
    if (isBuiltinEntityTypeId(type.id)) throw new Error(`defineEntityType: "${type.id}" is a built-in type`);
    const normalized = normalizeEntityType(type);
    const before = this.#doc.entityTypes;
    const index = before.findIndex((t) => t.id === type.id);
    if (index >= 0 && JSON.stringify(before[index]) === JSON.stringify(normalized)) return;
    const after = index >= 0 ? before.map((t, i) => (i === index ? normalized : t)) : [...before, normalized];
    this.#setEntityTypes(after);
  }

  #removeEntityType(op: RemoveEntityTypeOp): void {
    if (isBuiltinEntityTypeId(op.typeId)) throw new Error(`removeEntityType: "${op.typeId}" is a built-in type`);
    const before = this.#doc.entityTypes;
    if (!before.some((t) => t.id === op.typeId)) throw new Error(`removeEntityType: unknown entity type "${op.typeId}"`);
    this.#setEntityTypes(before.filter((t) => t.id !== op.typeId));
  }

  // ---------------------------------------------------------------- round 4: project data, level props

  #setRandomSet(op: SetRandomSetOp): void {
    const problem = randomSetProblem(op.set);
    if (problem) throw new Error(`setRandomSet: ${problem}`);
    for (const c of op.set.candidates) if (c.kind === "tile") this.#assertTile("setRandomSet", c.tilesetId, c.tileId);
    const normalized = normalizeRandomSet(op.set);
    const before = this.#doc.randomSets;
    const index = before.findIndex((s) => s.id === normalized.id);
    if (index >= 0 && JSON.stringify(before[index]) === JSON.stringify(normalized)) return;
    const after = index >= 0 ? before.map((s, i) => (i === index ? normalized : s)) : [...before, normalized];
    const ctx = this.#openOp();
    this.#setRandomSets(ctx, after);
    this.#closeOp(ctx);
  }

  #removeRandomSet(op: RemoveRandomSetOp): void {
    const before = this.#doc.randomSets;
    if (!before.some((s) => s.id === op.id)) throw new Error(`removeRandomSet: unknown random set "${String(op.id)}"`);
    const ctx = this.#openOp();
    this.#setRandomSets(ctx, before.filter((s) => s.id !== op.id));
    this.#closeOp(ctx);
  }

  #setCollection(op: SetCollectionOp): void {
    const existing = this.#doc.getCollection(op.collection.id);
    const legacy = !!existing && (existing.rows ?? 0) > MAX_COLLECTION_ROWS;
    const problem = collectionProblem(op.collection, legacy);
    if (problem) throw new Error(`setCollection: ${problem}`);
    const normalized = normalizeCollection(op.collection);
    if (existing && legacy && ((normalized.rows ?? 0) > (existing.rows ?? 0) || normalized.columns > existing.columns)) {
      throw new Error("setCollection: legacy rows and columns cannot grow");
    }
    for (const c of op.collection.cells) this.#assertTile("setCollection", c.tilesetId, c.tileId);
    const before = this.#doc.collections;
    const index = before.findIndex((c) => c.id === normalized.id);
    if (index >= 0 && JSON.stringify(before[index]) === JSON.stringify(normalized)) return;
    const after = index >= 0 ? before.map((c, i) => (i === index ? normalized : c)) : [...before, normalized];
    const ctx = this.#openOp();
    this.#setCollections(ctx, after);
    this.#closeOp(ctx);
  }

  #removeCollection(op: RemoveCollectionOp): void {
    const before = this.#doc.collections;
    if (!before.some((c) => c.id === op.id)) throw new Error(`removeCollection: unknown collection "${String(op.id)}"`);
    const ctx = this.#openOp();
    this.#setCollections(ctx, before.filter((c) => c.id !== op.id));
    this.#closeOp(ctx);
  }

  #setMapProps(op: SetMapPropsOp): void {
    const current = this.#doc.props;
    let next: MapProps;
    try {
      next = mapPropsFrom(op.background === undefined ? current.background : op.background, op.name === undefined ? current.name : op.name);
    } catch (error) {
      throw new RangeError(`setMapProps: ${(error as Error).message}`, { cause: error });
    }
    if (next.background === current.background && next.name === current.name) return;
    this.#doc._setProps(next);
    const ctx = this.#openOp();
    ctx.rec.recordStructural(Object.freeze({ kind: "mapProps", before: current, after: next }));
    ctx.structure.add("props");
    this.#closeOp(ctx);
  }

  #assertTile(what: string, tilesetId: string, tileId: number): void {
    const tileset = this.#doc.getTileset(tilesetId);
    if (!tileset) throw new Error(`${what}: unknown tileset "${tilesetId}"`);
    if (!isValidTileId(tileset, tileId)) throw new RangeError(`${what}: tile id ${tileId} is outside tileset "${tilesetId}"`);
  }

  #setRandomSets(ctx: OpContext, after: readonly RandomSet[]): void {
    const before = this.#doc.randomSets;
    this.#doc._setRandomSets(after);
    ctx.rec.recordStructural(Object.freeze({ kind: "randomSets", before, after: this.#doc.randomSets }));
    ctx.structure.add("randomSets");
  }

  #setCollections(ctx: OpContext, after: readonly Collection[]): void {
    const before = this.#doc.collections;
    this.#doc._setCollections(after);
    ctx.rec.recordStructural(Object.freeze({ kind: "collections", before, after: this.#doc.collections }));
    ctx.structure.add("collections");
  }

  /** Remaps (or drops, `null`) tile references of `tilesetId` in collections and random sets. */
  #remapTilesetRefs(ctx: OpContext, tilesetId: string, remap: (tileId: number) => number | null): void {
    const sets = remapRandomSetsForTileset(this.#doc.randomSets, tilesetId, remap);
    if (sets !== this.#doc.randomSets) this.#setRandomSets(ctx, sets);
    const collections = remapCollectionsForTileset(this.#doc.collections, tilesetId, remap);
    if (collections !== this.#doc.collections) this.#setCollections(ctx, collections);
  }

  #setEntityTypes(after: readonly EntityType[]): void {
    const before = this.#doc.entityTypes;
    this.#doc._setEntityTypes(after);
    this.#recordStructural({ kind: "entityTypes", before, after: this.#doc.entityTypes }, ["entityTypes"]);
  }

  /** Replaces an entity layer's list as its own op (one undo step outside a transaction). */
  #entityOp(layer: EntityLayer, next: readonly Entity[]): void {
    const ctx = this.#openOp();
    this.#setEntities(ctx, layer, next);
    this.#closeOp(ctx);
  }

  /** Replaces an entity layer's list inside an op and records it (no-op when equal). */
  #setEntities(ctx: OpContext, layer: EntityLayer, next: readonly Entity[]): void {
    const before = layer.entities;
    if (sameList(before, next)) return;
    layer._setEntities(Object.freeze([...next]));
    ctx.rec.recordStructural(Object.freeze({ kind: "entities", layerId: layer.id, before, after: layer.entities }));
    ctx.structure.add("entities");
  }

  #generateEntityId(): string {
    let count = 0;
    for (const layer of this.#doc.entityLayers()) count += layer.entities.length;
    for (let n = count + 1; ; n++) {
      const id = `e${n}`;
      if (!this.#doc.findEntity(id)) return id;
    }
  }

  // ---------------------------------------------------------------- helpers

  #openOp(): OpContext {
    const local = this.#depth === 0;
    return {
      pixelRects: [],
      rec: local ? new ChangeRecorder() : this.#pending!,
      local,
      dirty: new DirtyTracker(),
      structure: new Set(),
    };
  }

  /** Ends an op started with `#openOp`: pushes its undo step (outside a transaction) and emits. */
  #closeOp(ctx: OpContext, reportCells = true): void {
    let historyChanged = false;
    if (ctx.local) {
      const changes = ctx.rec.build();
      if (changes.length > 0) {
        this.#pushUndo(makeEntry(changes));
        historyChanged = true;
      }
    }
    const cells = reportCells ? ctx.dirty.result() : [];
    const structure = STRUCTURE_ORDER.filter((s) => ctx.structure.has(s));
    if (cells.length === 0 && structure.length === 0 && ctx.pixelRects.length === 0 && !historyChanged) return;
    this.#emit({ cause: "dispatch", cells, structure, pixelRects: ctx.pixelRects, historyChanged });
  }

  /** Replaces a tileset (metadata change) and records it. */
  #replaceTileset(ctx: OpContext, next: Tileset): void {
    const before = this.#doc.getTileset(next.id)!;
    this.#doc._replaceTileset(next);
    const after = this.#doc.getTileset(next.id)!;
    ctx.rec.recordStructural(Object.freeze({ kind: "tileset", tilesetId: next.id, before, after }));
    ctx.structure.add("tilesets");
  }

  /**
   * Cell indices (`y * width + x`) whose derived tile may be non-empty or
   * stale: grid chunks and their neighbours, plus chunks the target already has.
   */

  /** Recomputes the derived tiles of `grid` at the given cell indices (`y * width + x`). */

  #generateLayerId(): string {
    for (let n = this.#doc.layers.length + 1; ; n++) {
      const id = `layer-${n}`;
      if (!this.#doc.getLayer(id)) return id;
    }
  }

  /** Records an already applied structural change (own undo step outside a transaction) and emits. */
  #recordStructural(change: HistoryChange, structure: StructureChange[]): void {
    const autoCommit = this.#depth === 0;
    if (autoCommit) this.#pushUndo(makeEntry([Object.freeze(change)]));
    else this.#pending?.recordStructural(Object.freeze(change));
    this.#emit({ cause: "dispatch", cells: [], structure, historyChanged: autoCommit });
  }

  #pushUndo(entry: HistoryEntry): void {
    this.#undo.push(entry);
    this.#redo.length = 0;
    if (this.#undo.length > this.#historyLimit) {
      this.#undo.splice(0, this.#undo.length - this.#historyLimit);
    }
  }

  /** Applies one side of `changes`: `before` in reverse order (undo), `after` in order (redo). */
  #applyChanges(changes: readonly HistoryChange[], side: "before" | "after"): ApplyResult {
    const result = new ApplyResult();
    if (side === "before") {
      for (let i = changes.length - 1; i >= 0; i--) this.#applyChange(changes[i]!, side, result);
    } else {
      for (const change of changes) this.#applyChange(change, side, result);
    }
    return result;
  }

  #withGeneratedProvenance(tileset: Tileset): Tileset {
    const generated = this.#generatedProvenance.get(tileset.id);
    const old = tileset.generated;
    if (!old || !generated) return tileset;
    const sameOrigin = (["kind", "stampId", "layerId", "sourceWidth", "sourceHeight", "layoutVersion", "border"] as const).every(k => old[k] === generated[k]);
    return sameOrigin ? { ...tileset, generated } : tileset;
  }

  #applyChange(change: HistoryChange, side: "before" | "after", result: ApplyResult): void {
    const doc = this.#doc;
    switch (change.kind) {
      case "pixels": {
        const patches = side === "before" ? [...change.patches].reverse() : change.patches;
        for (const p of patches) {
          this.#rasters._rect(p.assetId, p.tileId, p.x, p.y, p.width, p.height, p[side]);
          result.pixelRects.push(dirtyPixelRect(p));
        }
        return;
      }
      case "rasterSlot": {
        this.#rasters._slot(change[side], change.assetId, change.tileId, side === "before" ? change.beforeBytes : change.afterBytes);
        result.pixelRects.push({ assetId: change.assetId, tileId: change.tileId, x: 0, y: 0, width: change.after.tileWidth, height: change.after.tileHeight });
        return;
      }
      case "paletteAppend": {
        // Legacy nonundoable additions can follow this step. Their stable
        // indices must survive replay, so retain the allocation's slot too.
        if (doc.palette.size <= change.after.length) doc.palette._restore(change[side]);
        result.structure.add("palette");
        return;
      }
      case "cells": {
        const layer = doc.getLayer(change.layerId);
        if (!layer) throw new Error(`history: layer "${change.layerId}" is missing`);
        const compact = cellChangesOf(change);
        if (!compact) {
          for (const c of change.cells) {
            layer._setCell(c.x, c.y, c[side]);
            result.dirty.add(layer.id, c.x, c.y);
          }
          return;
        }
        // Chunk-wise: write the whole `before` (undo) or `after` (redo) array of each chunk.
        for (const chunk of compact.chunks) {
          layer._writeCells(chunk.cx, chunk.cy, chunk.indices, chunk[side]);
          result.dirty.add(layer.id, chunk.cx << CHUNK_SHIFT, chunk.cy << CHUNK_SHIFT);
        }
        return;
      }
      case "layer": {
        const current = doc.layers.indexOf(change.layer);
        if (current >= 0) doc._removeLayerAt(current);
        const index = change[side];
        if (index !== null) doc._insertLayer(change.layer, index);
        result.structure.add("layers");
        return;
      }
      case "layerProps": {
        const layer = doc.getLayer(change.layerId);
        if (!layer) throw new Error(`history: layer "${change.layerId}" is missing`);
        layer._setProps(change[side]);
        result.structure.add("layers");
        return;
      }
      case "tileset": {
        doc._replaceTileset(this.#withGeneratedProvenance(change[side]));
        result.structure.add("tilesets");
        const a = change.before;
        const b = change.after;
        if (a.tileWidth !== b.tileWidth || a.tileHeight !== b.tileHeight || a.margin !== b.margin || a.spacing !== b.spacing || a.columns !== b.columns || a.rows !== b.rows) {
          markTileChunksDirty(doc, result.dirty);
        }
        return;
      }
      case "tilesetList": {
        doc._setTilesets(change[side].map(ts => this.#withGeneratedProvenance(ts)));
        result.structure.add("tilesets");
        return;
      }
      case "palette": {
        this.#applyPaletteChange(change, side);
        result.structure.add("palette");
        markTileChunksDirty(doc, result.dirty);
        return;
      }
      case "entities": {
        const layer = doc.getLayer(change.layerId);
        if (!isEntityLayer(layer)) throw new Error(`history: entity layer "${change.layerId}" is missing`);
        layer._setEntities(change[side]);
        result.structure.add("entities");
        return;
      }
      case "entityTypes": {
        doc._setEntityTypes(change[side]);
        result.structure.add("entityTypes");
        return;
      }
      case "randomSets": {
        doc._setRandomSets(change[side]);
        result.structure.add("randomSets");
        return;
      }
      case "collections": {
        doc._setCollections(change[side]);
        result.structure.add("collections");
        return;
      }
      case "mapProps": {
        doc._setProps(change[side]);
        result.structure.add("props");
        return;
      }
      case "map": {
        doc._setMap(change[side]);
        for (const entry of change.layers) {
          const layer = doc.getLayer(entry.layerId);
          if (!layer) throw new Error(`history: layer "${entry.layerId}" is missing`);
          layer._restore(entry[side]);
        }
        result.structure.add("map");
        return;
      }
      default: {
        const unknown: never = change;
        throw new TypeError(`Unknown history change: ${String((unknown as { kind: unknown }).kind)}`);
      }
    }
  }

  /**
   * Rewrites the entries of a palette change. Entries appended after the
   * change (palette growth is not undoable) may already hold a key the
   * change claims; such an entry is unused at this point (the cells that
   * use it belong to later, already undone steps), so it moves to a key the
   * change frees. The move is remembered so that applying the other side
   * moves it back exactly (undo → redo → undo stays byte-exact).
   */
  #applyPaletteChange(change: PaletteHistoryChange, side: "before" | "after"): void {
    const palette = this.#doc.palette;
    const writes = change.entries.map((e) => ({ index: e.index, entry: e[side] }));
    const writeSet = new Set(writes.map((w) => w.index));
    const vacated = new Map<string, PaletteEntry>();
    for (const { index } of writes) {
      const current = palette.get(index)!;
      vacated.set(paletteKey(current), current);
    }
    const claimed = new Set(writes.map((w) => paletteKey(w.entry)));
    const displaced: number[] = [];
    for (const { entry } of writes) {
      if (vacated.has(paletteKey(entry))) continue;
      const holder = palette.indexOf(entry.tilesetId, entry.tileId);
      if (holder !== 0 && !writeSet.has(holder)) displaced.push(holder);
    }
    if (displaced.length > 0) {
      const free = [...vacated].filter(([key]) => !claimed.has(key)).map(([, e]) => e).sort((a, b) => a.tileId - b.tileId);
      const memo = this.#displaced.get(change) ?? [];
      const used = new Set<string>();
      const moves: { index: number; entry: PaletteEntry; from: PaletteEntry }[] = [];
      displaced.sort((a, b) => a - b);
      for (const index of displaced) {
        const back = memo.find((m) => m.index === index && free.some((f) => paletteKey(f) === paletteKey(m.from)) && !used.has(paletteKey(m.from)));
        const entry = back ? back.from : free.find((f) => !used.has(paletteKey(f)))!;
        used.add(paletteKey(entry));
        moves.push({ index, entry, from: palette.get(index)! });
      }
      this.#displaced.set(change, moves);
      writes.push(...moves.map(({ index, entry }) => ({ index, entry })));
    }
    palette._rewrite(writes);
  }

  /** Event fields for applied changes; dirty chunks of layers no longer in the document are dropped. */
  #eventParts(result: ApplyResult): Pick<StoreChangeEvent, "cells" | "structure" | "pixelRects"> {
    const cells = result.dirty.result().filter((d) => this.#doc.getLayer(d.layerId) !== undefined);
    return { cells, pixelRects: result.pixelRects, structure: STRUCTURE_ORDER.filter((s) => result.structure.has(s)) };
  }

  #emit(change: Omit<StoreChangeEvent, "revision" | "pixelRects"> & { pixelRects?: readonly PixelDirtyRect[] }): void {
    if (change.cells.length > 0 || change.structure.length > 0 || change.pixelRects?.length) this.#revision++;
    const event: StoreChangeEvent = Object.freeze({ revision: this.#revision, ...change, pixelRects: Object.freeze((change.pixelRects ?? []).map(r => Object.freeze({ ...r }))) });
    let firstError: unknown = null;
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== null) throw firstError;
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
function dirtyPixelRect(p: PixelDirtyRect): PixelDirtyRect {
  return Object.freeze({ assetId: p.assetId, tileId: p.tileId, x: p.x, y: p.y, width: p.width, height: p.height });
}
function assertPixelRect(p: PixelDirtyRect, width: number, height: number): void {
  if (![p.x,p.y,p.width,p.height].every(Number.isSafeInteger) || p.x < 0 || p.y < 0 || p.width < 1 || p.height < 1 || p.x + p.width > width || p.y + p.height > height) throw new RangeError('pixel rect outside tile bounds');
}
function cropPixels(data: Uint8Array, stride: number, p: PixelDirtyRect): Uint8Array {
  const out = new Uint8Array(p.width * p.height * 4);
  for (let row=0; row<p.height; row++) out.set(data.subarray(((p.y+row)*stride+p.x)*4, ((p.y+row)*stride+p.x+p.width)*4), row*p.width*4);
  return out;
}
function ownedPixelPatch(p: PixelDirtyRect, before: Uint8Array, after: Uint8Array): PixelRectPatch {
  const a = before.slice(), b = after.slice();
  return Object.freeze({ ...dirtyPixelRect(p), get before() { return a.slice(); }, get after() { return b.slice(); } });
}
