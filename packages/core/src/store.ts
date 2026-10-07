import { isValidCell, cellPaletteIndex, type Cell } from "./cell";
import { CHUNK_SHIFT, chunkKey, type ChunkKey } from "./chunk";
import type { MapDocument } from "./document";
import { TileLayer, layerPropsProblem, type LayerProps } from "./layer";
import type {
  AddLayerOp,
  AddPaletteEntryOp,
  AddTilesetOp,
  CellChange,
  LayerPatch,
  Op,
  OpResult,
  PaintCellsOp,
} from "./ops";
import { isValidTileId, tilesetProblem } from "./tileset";

/** Structural parts of a document that can change (renderers rebuild these wholesale). */
export type StructureChange = "layers" | "tilesets" | "palette";

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

/** One undo step: all cell changes of one transaction. */
export interface HistoryEntry {
  readonly patches: readonly LayerPatch[];
}

export interface MapStoreOptions {
  /** Maximum number of undo steps kept. Defaults to 1000. */
  historyLimit?: number;
}

/** Collects cell changes, keeping the first `before` and last `after` per cell. */
class PatchBuilder {
  readonly #layers = new Map<string, Map<number, { x: number; y: number; before: Cell; after: Cell }>>();
  readonly #width: number;

  constructor(width: number) {
    this.#width = width;
  }

  record(layerId: string, x: number, y: number, before: Cell, after: Cell): void {
    let cells = this.#layers.get(layerId);
    if (!cells) {
      cells = new Map();
      this.#layers.set(layerId, cells);
    }
    const index = y * this.#width + x;
    const existing = cells.get(index);
    if (existing) existing.after = after;
    else cells.set(index, { x, y, before, after });
  }

  /** Patches with no-op cells (`before === after`) dropped; layers without changes omitted. */
  build(): LayerPatch[] {
    const patches: LayerPatch[] = [];
    for (const [layerId, cells] of this.#layers) {
      const changes: CellChange[] = [];
      for (const c of cells.values()) {
        if (c.before !== c.after) changes.push(Object.freeze({ x: c.x, y: c.y, before: c.before, after: c.after }));
      }
      if (changes.length > 0) patches.push(Object.freeze({ layerId, cells: Object.freeze(changes) }));
    }
    return patches;
  }
}

/** Groups dirty chunk keys per layer, preserving first-seen order. */
class DirtyTracker {
  readonly #layers = new Map<string, Set<ChunkKey>>();

  add(layerId: string, x: number, y: number): void {
    let keys = this.#layers.get(layerId);
    if (!keys) {
      keys = new Set();
      this.#layers.set(layerId, keys);
    }
    keys.add(chunkKey(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT));
  }

  result(): DirtyChunks[] {
    return [...this.#layers].map(([layerId, keys]) => ({ layerId, chunks: [...keys] }));
  }
}

/**
 * Owns a `MapDocument` and is the only thing that mutates it.
 *
 * - `dispatch(op)` applies a plain-data {@link Op}.
 * - `beginTransaction()` / `commit()` group many ops into one undo step
 *   (mouse-down → mouse-up). Transactions nest; only the outermost commit
 *   creates the step. `rollback()` reverts the open transaction.
 * - `undo()` / `redo()` swap the `before` / `after` of a step's patches.
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
  #pending: PatchBuilder | null = null;

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
    this.#pending = new PatchBuilder(this.#doc.map.width);
    // canUndo/canRedo read false while a transaction is open.
    this.#emit({ cause: "begin", cells: [], structure: [], historyChanged: true });
  }

  /**
   * Closes a transaction. When the outermost transaction closes and it changed
   * any cell, it becomes one undo step and the redo stack is cleared.
   *
   * @throws Error when no transaction is open.
   */
  commit(): void {
    if (this.#depth === 0) throw new Error("commit() called without an open transaction");
    this.#depth--;
    if (this.#depth > 0) return;
    const patches = this.#pending?.build() ?? [];
    this.#pending = null;
    if (patches.length > 0) this.#pushUndo({ patches });
    this.#emit({ cause: "commit", cells: [], structure: [], historyChanged: true });
  }

  /**
   * Reverts every cell change of the open transaction (all nesting levels)
   * and closes it without creating an undo step. Non-undoable ops stay.
   *
   * @throws Error when no transaction is open.
   */
  rollback(): void {
    if (this.#depth === 0) throw new Error("rollback() called without an open transaction");
    const patches = this.#pending?.build() ?? [];
    this.#pending = null;
    this.#depth = 0;
    const dirty = this.#applyPatches(patches, "before");
    this.#emit({ cause: "rollback", cells: dirty, structure: [], historyChanged: true });
  }

  /** Undoes the last step. Returns false (and does nothing) if impossible or a transaction is open. */
  undo(): boolean {
    if (!this.canUndo) return false;
    const entry = this.#undo.pop()!;
    this.#redo.push(entry);
    const dirty = this.#applyPatches(entry.patches, "before");
    this.#emit({ cause: "undo", cells: dirty, structure: [], historyChanged: true });
    return true;
  }

  /** Redoes the last undone step. Returns false (and does nothing) if impossible or a transaction is open. */
  redo(): boolean {
    if (!this.canRedo) return false;
    const entry = this.#redo.pop()!;
    this.#undo.push(entry);
    const dirty = this.#applyPatches(entry.patches, "after");
    this.#emit({ cause: "redo", cells: dirty, structure: [], historyChanged: true });
    return true;
  }

  /** Drops all undo/redo steps (e.g. after opening a file). */
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

    const opPatch = new PatchBuilder(this.#doc.map.width);
    const dirty = new DirtyTracker();
    for (const { x, y, cell } of op.cells) {
      if (!this.#doc.inBounds(x, y)) continue;
      const before = layer._setCell(x, y, cell);
      if (before === cell) continue;
      opPatch.record(layer.id, x, y, before, cell);
      this.#pending?.record(layer.id, x, y, before, cell);
      dirty.add(layer.id, x, y);
    }

    const patches = opPatch.build();
    const patch = patches[0] ?? Object.freeze({ layerId: layer.id, cells: Object.freeze([]) });
    if (patch.cells.length === 0) return patch;

    const autoCommit = this.#depth === 0;
    if (autoCommit) this.#pushUndo({ patches });
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
    this.#doc._insertLayer(new TileLayer(props), index);
    this.#emit({ cause: "dispatch", cells: [], structure: ["layers"], historyChanged: false });
    return props.id;
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

  #pushUndo(entry: HistoryEntry): void {
    this.#undo.push(entry);
    this.#redo.length = 0;
    if (this.#undo.length > this.#historyLimit) {
      this.#undo.splice(0, this.#undo.length - this.#historyLimit);
    }
  }

  /** Writes `before` or `after` of every change (patches in reverse for undo). */
  #applyPatches(patches: readonly LayerPatch[], side: "before" | "after"): DirtyChunks[] {
    const dirty = new DirtyTracker();
    const ordered = side === "before" ? [...patches].reverse() : patches;
    for (const patch of ordered) {
      const layer = this.#doc.getLayer(patch.layerId);
      if (!layer) continue;
      for (const change of patch.cells) {
        layer._setCell(change.x, change.y, change[side]);
        dirty.add(layer.id, change.x, change.y);
      }
    }
    return dirty.result();
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
