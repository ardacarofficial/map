import { isValidCell, cellPaletteIndex, type Cell } from "./cell";
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT, chunkKey, localIndex, type ChunkKey } from "./chunk";
import { mapInfoProblem, type MapDocument, type MapInfo } from "./document";
import { TileLayer, layerPropsProblem, type ChunkSnapshot, type LayerProps, type LayerPropValues } from "./layer";
import type {
  AddLayerOp,
  AddPaletteEntryOp,
  AddTilesetOp,
  CellChange,
  LayerPatch,
  MoveLayerOp,
  Op,
  OpResult,
  PaintCellsOp,
  RemoveLayerOp,
  ResizeMapOp,
  SetLayerPropsOp,
} from "./ops";
import { isValidTileId, tilesetProblem } from "./tileset";

/**
 * Structural parts of a document that can change (renderers rebuild these wholesale).
 *
 * - `"layers"`: the layer list changed — a layer was added, removed or moved,
 *   or its properties (name, visible, locked, opacity) changed. Re-sync by id
 *   against `document.layers`: drop views of ids that are gone, create views
 *   (with all their chunks) for new ids, reorder, re-read properties.
 * - `"map"`: the map was resized. Every layer's content may have moved, so
 *   rebuild all chunks of all layers and re-read `document.map`.
 * - `"tilesets"`, `"palette"`: an entry was appended.
 */
export type StructureChange = "layers" | "tilesets" | "palette" | "map";

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
  /** Structural changes (empty when none). */
  readonly structure: readonly StructureChange[];
  /** True when `canUndo` / `canRedo` may have changed. */
  readonly historyChanged: boolean;
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

/**
 * One reversible change. Every change stores both sides; undo applies the
 * `before` sides (in reverse order), redo the `after` sides. No inverse ops.
 */
export type HistoryChange = CellsHistoryChange | LayerHistoryChange | LayerPropsHistoryChange | MapHistoryChange;

/** One undo step: all changes of one transaction, in the order they happened. */
export interface HistoryEntry {
  readonly changes: readonly HistoryChange[];
  /** The cell changes among `changes` (kept for v0.1 compatibility). */
  readonly patches: readonly LayerPatch[];
}

export interface MapStoreOptions {
  /** Maximum number of undo steps kept. Defaults to 1000. */
  historyLimit?: number;
}

type MutableChange = { x: number; y: number; before: Cell; after: Cell };

/** Per-layer change list plus an index from cell to its slot in the list. */
class LayerChanges {
  readonly changes: MutableChange[] = [];
  /** Sparse index (`cell index → slot`) for small change sets. */
  #sparse: Map<number, number> | null = new Map();
  /** Dense index (`cell index → slot + 1`, 0 = none) once the set grows large. */
  #dense: Int32Array | null = null;
  readonly #area: number;

  constructor(area: number) {
    this.#area = area;
  }

  slot(index: number): number | undefined {
    if (this.#dense) {
      const s = this.#dense[index]!;
      return s === 0 ? undefined : s - 1;
    }
    return this.#sparse!.get(index);
  }

  add(index: number, change: MutableChange): void {
    const slot = this.changes.length;
    this.changes.push(change);
    if (this.#dense) {
      this.#dense[index] = slot + 1;
      return;
    }
    const sparse = this.#sparse!;
    sparse.set(index, slot);
    // A Map of millions of keys is slow; switch to a typed array once the
    // change set is a sizeable part of the map (fill, big paste, cut).
    if (sparse.size >= DENSE_THRESHOLD && this.#area <= DENSE_MAX_AREA && sparse.size * 64 >= this.#area) {
      const dense = new Int32Array(this.#area);
      for (const [i, sl] of sparse) dense[i] = sl + 1;
      this.#dense = dense;
      this.#sparse = null;
    }
  }
}

const DENSE_THRESHOLD = 4096;
const DENSE_MAX_AREA = 1 << 26;

/** Collects cell changes, keeping the first `before` and last `after` per cell. */
class PatchBuilder {
  readonly #layers = new Map<string, LayerChanges>();
  readonly #width: number;
  readonly #area: number;
  #lastId: string | null = null;
  #last: LayerChanges | null = null;

  constructor(map: MapInfo) {
    this.#width = map.width;
    this.#area = map.width * map.height;
  }

  record(layerId: string, x: number, y: number, before: Cell, after: Cell): void {
    let layer = this.#lastId === layerId ? this.#last : this.#layers.get(layerId);
    if (!layer) {
      layer = new LayerChanges(this.#area);
      this.#layers.set(layerId, layer);
    }
    this.#lastId = layerId;
    this.#last = layer;
    const index = y * this.#width + x;
    const slot = layer.slot(index);
    if (slot !== undefined) layer.changes[slot]!.after = after;
    else layer.add(index, { x, y, before, after });
  }

  /** Patches with no-op cells (`before === after`) dropped; layers without changes omitted. */
  build(): LayerPatch[] {
    const patches: LayerPatch[] = [];
    for (const [layerId, layer] of this.#layers) {
      const changes: CellChange[] = [];
      for (const c of layer.changes) if (c.before !== c.after) changes.push(Object.freeze(c));
      if (changes.length > 0) patches.push(Object.freeze({ layerId, cells: Object.freeze(changes) }));
    }
    return patches;
  }
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

  recordCell(map: MapInfo, layerId: string, x: number, y: number, before: Cell, after: Cell): void {
    this.#cells ??= new PatchBuilder(map);
    this.#cells.record(layerId, x, y, before, after);
  }

  recordStructural(change: HistoryChange): void {
    this.#flush();
    this.#changes.push(change);
  }

  build(): HistoryChange[] {
    this.#flush();
    return this.#changes;
  }

  #flush(): void {
    if (!this.#cells) return;
    for (const patch of this.#cells.build()) this.#changes.push(cellsChange(patch));
    this.#cells = null;
  }
}

function cellsChange(patch: LayerPatch): CellsHistoryChange {
  return Object.freeze({ kind: "cells", layerId: patch.layerId, cells: patch.cells });
}

function makeEntry(changes: readonly HistoryChange[]): HistoryEntry {
  const patches = changes
    .filter((c): c is CellsHistoryChange => c.kind === "cells")
    .map((c): LayerPatch => Object.freeze({ layerId: c.layerId, cells: c.cells }));
  return Object.freeze({ changes: Object.freeze([...changes]), patches: Object.freeze(patches) });
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
  readonly dirty = new DirtyTracker();
  readonly structure = new Set<StructureChange>();
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
  readonly #listeners = new Set<StoreListener>();
  readonly #undo: HistoryEntry[] = [];
  readonly #redo: HistoryEntry[] = [];
  readonly #historyLimit: number;
  #revision = 0;
  #depth = 0;
  #pending: ChangeRecorder | null = null;

  constructor(document: MapDocument, options: MapStoreOptions = {}) {
    this.#doc = document;
    this.#historyLimit = Math.max(0, options.historyLimit ?? 1000);
  }

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
      case "paintCells":
        return this.#paintCells(op);
      case "addTileset":
        return this.#addTileset(op);
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

  /** Opens a transaction (nestable). Pair every call with `commit()` or `rollback()`. */
  beginTransaction(): void {
    this.#depth++;
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
    this.#pending = null;
    if (changes.length > 0) this.#pushUndo(makeEntry(changes));
    this.#emit({ cause: "commit", cells: [], structure: [], historyChanged: true });
  }

  /**
   * Reverts every undoable change of the open transaction (all nesting levels)
   * and closes it without creating an undo step. Non-undoable ops
   * (tilesets, palette entries) stay.
   *
   * @throws Error when no transaction is open.
   */
  rollback(): void {
    if (this.#depth === 0) throw new Error("rollback() called without an open transaction");
    const changes = this.#pending?.build() ?? [];
    this.#pending = null;
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

  /** Drops all undo/redo steps (e.g. after opening a file or setting up a new document). */
  clearHistory(): void {
    if (this.#undo.length === 0 && this.#redo.length === 0) return;
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#emit({ cause: "commit", cells: [], structure: [], historyChanged: true });
  }

  // ---------------------------------------------------------------- ops

  #paintCells(op: PaintCellsOp): LayerPatch {
    const layer = this.#doc.getLayer(op.layerId);
    if (!layer) throw new Error(`paintCells: unknown layer "${op.layerId}"`);
    const palette = this.#doc.palette;
    for (const { x, y, cell } of op.cells) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new TypeError(`paintCells: coordinates must be integers, got (${x}, ${y})`);
      }
      if (!isValidCell(cell)) throw new RangeError(`paintCells: invalid cell value ${cell} at (${x}, ${y})`);
      if (!palette.has(cellPaletteIndex(cell))) {
        throw new RangeError(`paintCells: palette index ${cellPaletteIndex(cell)} does not exist (at (${x}, ${y}))`);
      }
    }
    if (layer.locked) return Object.freeze({ layerId: layer.id, cells: Object.freeze([]) });

    const map = this.#doc.map;
    const opPatch = new PatchBuilder(map);
    const dirty = new DirtyTracker();
    for (const { x, y, cell } of op.cells) {
      if (!this.#doc.inBounds(x, y)) continue;
      const before = layer._setCell(x, y, cell);
      if (before === cell) continue;
      opPatch.record(layer.id, x, y, before, cell);
      this.#pending?.recordCell(map, layer.id, x, y, before, cell);
      dirty.add(layer.id, x, y);
    }

    const patches = opPatch.build();
    const patch = patches[0] ?? Object.freeze({ layerId: layer.id, cells: Object.freeze([]) });
    if (patch.cells.length === 0) return patch;

    const autoCommit = this.#depth === 0;
    if (autoCommit) this.#pushUndo(makeEntry(patches.map(cellsChange)));
    this.#emit({ cause: "dispatch", cells: dirty.result(), structure: [], historyChanged: autoCommit });
    return patch;
  }

  #addTileset(op: AddTilesetOp): void {
    const problem = tilesetProblem(op.tileset);
    if (problem) throw new Error(`addTileset: ${problem}`);
    if (this.#doc.getTileset(op.tileset.id)) throw new Error(`addTileset: duplicate tileset id "${op.tileset.id}"`);
    this.#doc._addTileset(op.tileset);
    this.#emit({ cause: "dispatch", cells: [], structure: ["tilesets"], historyChanged: false });
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
    const layer = new TileLayer(props);
    this.#doc._insertLayer(layer, index);
    this.#recordStructural({ kind: "layer", layer, before: null, after: index }, ["layers"]);
    return props.id;
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
    const after: MapInfo = { ...before, width: op.width, height: op.height };
    const problem = mapInfoProblem(after);
    if (problem) throw new RangeError(`resizeMap: ${problem}`);
    const dx = op.offsetX ?? 0;
    const dy = op.offsetY ?? 0;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
      throw new TypeError(`resizeMap: offsets must be integers, got (${dx}, ${dy})`);
    }
    if (after.width === before.width && after.height === before.height && dx === 0 && dy === 0) return;

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
    this.#recordStructural(
      { kind: "map", before, after: this.#doc.map, layers: Object.freeze(layers) },
      ["map"],
    );
  }

  #addPaletteEntry(op: AddPaletteEntryOp): number {
    const tileset = this.#doc.getTileset(op.tilesetId);
    if (!tileset) throw new Error(`addPaletteEntry: unknown tileset "${op.tilesetId}"`);
    if (!isValidTileId(tileset, op.tileId)) {
      throw new RangeError(`addPaletteEntry: tile id ${op.tileId} is outside tileset "${op.tilesetId}"`);
    }
    const palette = this.#doc.palette;
    const existing = palette.indexOf(op.tilesetId, op.tileId);
    if (existing !== 0) return existing;
    const index = palette._getOrAdd(op.tilesetId, op.tileId);
    this.#emit({ cause: "dispatch", cells: [], structure: ["palette"], historyChanged: false });
    return index;
  }

  // ---------------------------------------------------------------- helpers

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

  #applyChange(change: HistoryChange, side: "before" | "after", result: ApplyResult): void {
    const doc = this.#doc;
    switch (change.kind) {
      case "cells": {
        const layer = doc.getLayer(change.layerId);
        if (!layer) throw new Error(`history: layer "${change.layerId}" is missing`);
        for (const c of change.cells) {
          layer._setCell(c.x, c.y, c[side]);
          result.dirty.add(layer.id, c.x, c.y);
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

  /** Event fields for applied changes; dirty chunks of layers no longer in the document are dropped. */
  #eventParts(result: ApplyResult): Pick<StoreChangeEvent, "cells" | "structure"> {
    const cells = result.dirty.result().filter((d) => this.#doc.getLayer(d.layerId) !== undefined);
    const order: StructureChange[] = ["layers", "tilesets", "palette", "map"];
    return { cells, structure: order.filter((s) => result.structure.has(s)) };
  }

  #emit(change: Omit<StoreChangeEvent, "revision">): void {
    if (change.cells.length > 0 || change.structure.length > 0) this.#revision++;
    const event: StoreChangeEvent = Object.freeze({ revision: this.#revision, ...change });
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
