import { terrainSlotAt, type TerrainSlot } from "./autotile";
import { isValidCell, cellPaletteIndex, makeCell, type Cell } from "./cell";
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, chunkKey, localIndex, parseChunkKey, type ChunkKey } from "./chunk";
import { mapInfoProblem, type MapDocument, type MapInfo } from "./document";
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
import type {
  AddEntityOp,
  DefineEntityTypeOp,
  MoveEntityOp,
  RemoveEntityOp,
  RemoveEntityTypeOp,
  UpdateEntityOp,
  DefineTerrainOp,
  DeriveTerrainOp,
  PaintTerrainOp,
  RemoveTerrainOp,
  SetTileSolidOp,
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
import { normalizeTerrain, pickVariant, terrainCandidates, terrainProblem } from "./terrain";
import { isValidTileId, tilesetProblem, type Tileset } from "./tileset";

/**
 * Structural parts of a document that can change (renderers rebuild these wholesale).
 *
 * - `"layers"`: the layer list changed — a layer was added, removed or moved,
 *   or its properties (name, visible, locked, opacity) changed. Re-sync by id
 *   against `document.layers`: drop views of ids that are gone, create views
 *   (with all their chunks) for new ids, reorder, re-read properties.
 * - `"map"`: the map was resized. Every layer's content may have moved, so
 *   rebuild all chunks of all layers and re-read `document.map`.
 * - `"tilesets"`: a tileset was appended, or a tileset's metadata (solid
 *   flags, terrains) changed. Re-read `document.tilesets`.
 * - `"palette"`: an entry was appended.
 * - `"entities"` (v0.6): entities of some entity layer were added, removed,
 *   moved or edited. Re-read `entities` of the entity layers.
 * - `"entityTypes"` (v0.6): a user-defined entity type was defined, changed
 *   or removed. Re-read `document.entityTypes`.
 *
 * Grid layer (terrain / collision) cell changes are reported in `cells` like
 * tile layer changes; renderers may draw grid layers as a coloured overlay.
 */
export type StructureChange = "layers" | "tilesets" | "palette" | "map" | "entities" | "entityTypes";

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

/** Tileset metadata change (solid flags, terrains): the whole tileset before and after. */
export interface TilesetHistoryChange {
  readonly kind: "tileset";
  readonly tilesetId: string;
  readonly before: Tileset;
  readonly after: Tileset;
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

/**
 * One reversible change. Every change stores both sides; undo applies the
 * `before` sides (in reverse order), redo the `after` sides. No inverse ops.
 */
export type HistoryChange =
  | CellsHistoryChange
  | LayerHistoryChange
  | LayerPropsHistoryChange
  | MapHistoryChange
  | TilesetHistoryChange
  | EntitiesHistoryChange
  | EntityTypesHistoryChange;

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

/**
 * Per-layer change list plus an index from cell to its slot in the list.
 * The index is one `Int32Array(CHUNK_AREA)` (4 KB) per touched 32×32 chunk,
 * so memory grows with the touched area, never with the map size (a big
 * fill costs the same per cell as a brush dab; no map-sized buffers).
 */
class LayerChanges {
  readonly changes: MutableChange[] = [];
  /** chunk index (`cy * chunkColumns + cx`) → `local index → slot + 1` (0 = none). */
  readonly #index = new Map<number, Int32Array>();
  readonly #chunkColumns: number;
  #lastKey = -1;
  #last: Int32Array | null = null;

  constructor(width: number) {
    this.#chunkColumns = (width + CHUNK_MASK) >> CHUNK_SHIFT;
  }

  #chunk(x: number, y: number, create: boolean): Int32Array | null {
    const key = (y >> CHUNK_SHIFT) * this.#chunkColumns + (x >> CHUNK_SHIFT);
    if (key === this.#lastKey) return this.#last;
    let chunk = this.#index.get(key) ?? null;
    if (!chunk) {
      if (!create) return null;
      chunk = new Int32Array(CHUNK_AREA);
      this.#index.set(key, chunk);
    }
    this.#lastKey = key;
    this.#last = chunk;
    return chunk;
  }

  /** Slot of cell (`x`, `y`) in `changes`, or `undefined`. */
  slot(x: number, y: number): number | undefined {
    const chunk = this.#chunk(x, y, false);
    const s = chunk ? chunk[localIndex(x & CHUNK_MASK, y & CHUNK_MASK)]! : 0;
    return s === 0 ? undefined : s - 1;
  }

  add(x: number, y: number, change: MutableChange): void {
    this.changes.push(change);
    this.#chunk(x, y, true)![localIndex(x & CHUNK_MASK, y & CHUNK_MASK)] = this.changes.length;
  }
}

/** Collects cell changes, keeping the first `before` and last `after` per cell. */
class PatchBuilder {
  readonly #layers = new Map<string, LayerChanges>();
  readonly #width: number;
  #lastId: string | null = null;
  #last: LayerChanges | null = null;

  constructor(map: MapInfo) {
    this.#width = map.width;
  }

  record(layerId: string, x: number, y: number, before: Cell, after: Cell): void {
    let layer = this.#lastId === layerId ? this.#last : this.#layers.get(layerId);
    if (!layer) {
      layer = new LayerChanges(this.#width);
      this.#layers.set(layerId, layer);
    }
    this.#lastId = layerId;
    this.#last = layer;
    const slot = layer.slot(x, y);
    if (slot !== undefined) layer.changes[slot]!.after = after;
    else layer.add(x, y, { x, y, before, after });
  }

  /** Patches with no-op cells (`before === after`) dropped; layers without changes omitted. */
  build(): LayerPatch[] {
    const patches: LayerPatch[] = [];
    for (const [layerId, layer] of this.#layers) {
      // The builder is discarded after build(): its change objects are handed out as they are
      // (readonly by type; freezing each of a big fill's million cells cost ~50 ms).
      let changes: CellChange[] = layer.changes;
      if (changes.some((c) => c.before === c.after)) changes = changes.filter((c) => c.before !== c.after);
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
  readonly dirty = new DirtyTracker();
  readonly structure = new Set<StructureChange>();
}

const STRUCTURE_ORDER: readonly StructureChange[] = ["layers", "tilesets", "palette", "map", "entities", "entityTypes"];

/**
 * State of one op that may produce several changes (grid + derived tiles,
 * tileset + re-derived tiles, resize + re-derived tiles). Inside a
 * transaction it records into the transaction; otherwise into its own
 * recorder that becomes one undo step.
 */
interface OpContext {
  readonly rec: ChangeRecorder;
  readonly local: boolean;
  readonly dirty: DirtyTracker;
  readonly structure: Set<StructureChange>;
  /** terrain id → palette indices per slot (`null`: tileset missing). */
  readonly terrainCells: Map<number, number[][] | null>;
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
      case "paintTerrain":
        return this.#paintTerrain(op);
      case "setTileSolid":
        return this.#setTileSolid(op);
      case "defineTerrain":
        return this.#defineTerrain(op);
      case "removeTerrain":
        return this.#removeTerrain(op);
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
      case "deriveTerrain":
        return this.#deriveTerrainOp(op);
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
    if (isGridLayer(layer)) throw new TypeError(`paintCells: "${op.layerId}" is a grid layer; use paintTerrain`);
    if (isEntityLayer(layer)) throw new TypeError(`paintCells: "${op.layerId}" is an entity layer`);
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
    // Locked layers and derived tile layers (owned by their terrain grid) take no writes.
    if (layer.locked || this.#isDerivedLayer(layer.id)) return Object.freeze({ layerId: layer.id, cells: Object.freeze([]) });

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
    for (const terrain of op.tileset.terrains ?? []) {
      if (this.#doc.getTerrain(terrain.id)) throw new Error(`addTileset: duplicate terrain id ${terrain.id}`);
    }
    this.#doc._addTileset(op.tileset);
    this.#emit({ cause: "dispatch", cells: [], structure: ["tilesets"], historyChanged: false });
    // New terrains may give existing grid values a look: keep derived tiles current.
    if ((op.tileset.terrains ?? []).length > 0) {
      const ctx = this.#openOp();
      this.#deriveAllTerrain(ctx);
      this.#closeOp(ctx);
    }
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
      if (!isGridRole(role)) throw new Error(`addLayer: a grid layer needs role "terrain" or "collision", got ${JSON.stringify(role)}`);
      const target = op.layer.targetLayerId;
      if (target !== undefined) {
        if (role !== "terrain") throw new Error("addLayer: only terrain grid layers have a targetLayerId");
        const targetLayer = this.#doc.getLayer(target);
        if (!isTileLayer(targetLayer)) throw new Error(`addLayer: target "${target}" is not a tile layer`);
        if (this.#doc.layers.some((l) => isGridLayer(l) && l.targetLayerId === target)) {
          throw new Error(`addLayer: tile layer "${target}" is already derived from another terrain layer`);
        }
      }
      layer = new GridLayer(props, role, target ?? null);
    } else if (type === "tile" || type === "entity") {
      if (op.layer.role !== undefined || op.layer.targetLayerId !== undefined) {
        throw new Error("addLayer: role and targetLayerId are only for grid layers");
      }
      layer = type === "tile" ? new TileLayer(props) : new EntityLayer(props);
    } else {
      throw new Error(`addLayer: unknown layer type ${JSON.stringify(type)}`);
    }
    this.#doc._insertLayer(layer, index);
    const change: LayerHistoryChange = Object.freeze({ kind: "layer", layer, before: null, after: index });
    // A grid that takes over a tile layer, or a tile layer that fills a
    // dangling target, is derived in the same undo step.
    const deriving = isGridLayer(layer)
      ? layer.role === "terrain" && layer.targetLayerId !== null
      : isTileLayer(layer) && this.#isDerivedLayer(layer.id);
    if (!deriving) {
      this.#recordStructural(change, ["layers"]);
      return props.id;
    }
    const ctx = this.#openOp();
    ctx.rec.recordStructural(change);
    ctx.structure.add("layers");
    for (const grid of this.#doc.layers) {
      if (isGridLayer(grid) && grid.role === "terrain" && grid.targetLayerId !== null && (grid === layer || grid.targetLayerId === layer.id)) {
        this.#deriveTerrain(ctx, grid, this.#derivableCells(grid));
      }
    }
    this.#closeOp(ctx);
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
    // New edges change blob masks / corner spill: re-derive every terrain layer.
    this.#deriveAllTerrain(ctx);
    // "map" already means "rebuild every chunk"; no per-chunk report.
    this.#closeOp(ctx, false);
  }

  #paintTerrain(op: PaintTerrainOp): LayerPatch {
    const layer = this.#doc.getLayer(op.layerId);
    if (!layer) throw new Error(`paintTerrain: unknown layer "${op.layerId}"`);
    if (!isGridLayer(layer)) throw new TypeError(`paintTerrain: "${op.layerId}" is not a grid layer`);
    const max = layer.maxValue;
    for (const { x, y, value } of op.cells) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new TypeError(`paintTerrain: coordinates must be integers, got (${x}, ${y})`);
      }
      if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new RangeError(`paintTerrain: value must be an integer in [0, ${max}], got ${value} at (${x}, ${y})`);
      }
    }
    const empty: LayerPatch = Object.freeze({ layerId: layer.id, cells: Object.freeze([]) });
    if (layer.locked) return empty;

    const map = this.#doc.map;
    const opPatch = new PatchBuilder(map);
    const ctx = this.#openOp();
    for (const { x, y, value } of op.cells) {
      if (!this.#doc.inBounds(x, y)) continue;
      const before = layer._setCell(x, y, value);
      if (before === value) continue;
      opPatch.record(layer.id, x, y, before, value);
      ctx.rec.recordCell(map, layer.id, x, y, before, value);
      ctx.dirty.add(layer.id, x, y);
    }
    const patch = opPatch.build()[0] ?? empty;
    if (patch.cells.length === 0) return patch;

    if (layer.role === "terrain") {
      // A cell's tile depends on its 3×3 neighbourhood only.
      const { width, height } = map;
      const affected = new Set<number>();
      for (const c of patch.cells) {
        for (let y = Math.max(0, c.y - 1); y <= Math.min(height - 1, c.y + 1); y++) {
          for (let x = Math.max(0, c.x - 1); x <= Math.min(width - 1, c.x + 1); x++) affected.add(y * width + x);
        }
      }
      this.#deriveTerrain(ctx, layer, affected);
    }
    this.#closeOp(ctx);
    return patch;
  }

  #setTileSolid(op: SetTileSolidOp): void {
    const tileset = this.#doc.getTileset(op.tilesetId);
    if (!tileset) throw new Error(`setTileSolid: unknown tileset "${op.tilesetId}"`);
    for (const id of op.tileIds) {
      if (!isValidTileId(tileset, id)) throw new RangeError(`setTileSolid: tile id ${id} is outside tileset "${op.tilesetId}"`);
    }
    const solid = new Set(tileset.solidTiles ?? []);
    for (const id of op.tileIds) {
      if (op.solid) solid.add(id);
      else solid.delete(id);
    }
    const next = [...solid].sort((a, b) => a - b);
    const current = tileset.solidTiles ?? [];
    if (next.length === current.length && next.every((v, i) => v === current[i])) return;
    const ctx = this.#openOp();
    this.#replaceTileset(ctx, { ...tileset, solidTiles: next });
    this.#closeOp(ctx);
  }

  #defineTerrain(op: DefineTerrainOp): void {
    const terrain = op.terrain;
    const tileset = this.#doc.getTileset(terrain?.tilesetId);
    if (!tileset) throw new Error(`defineTerrain: unknown tileset "${String(terrain?.tilesetId)}"`);
    const problem = terrainProblem(tileset, terrain);
    if (problem) throw new Error(`defineTerrain: ${problem}`);
    const normalized = normalizeTerrain(terrain);
    const existing = this.#doc.getTerrain(terrain.id);
    if (existing && JSON.stringify(existing) === JSON.stringify(normalized)) return;

    const ctx = this.#openOp();
    if (existing && existing.tilesetId !== tileset.id) {
      const owner = this.#doc.getTileset(existing.tilesetId)!;
      this.#replaceTileset(ctx, { ...owner, terrains: (owner.terrains ?? []).filter((t) => t.id !== terrain.id) });
    }
    const current = this.#doc.getTileset(tileset.id)!;
    this.#replaceTileset(ctx, {
      ...current,
      terrains: [...(current.terrains ?? []).filter((t) => t.id !== terrain.id), normalized],
    });
    this.#deriveAllTerrain(ctx);
    this.#closeOp(ctx);
  }

  #removeTerrain(op: RemoveTerrainOp): void {
    const existing = this.#doc.getTerrain(op.terrainId);
    if (!existing) throw new Error(`removeTerrain: unknown terrain ${op.terrainId}`);
    const owner = this.#doc.getTileset(existing.tilesetId)!;
    const ctx = this.#openOp();
    this.#replaceTileset(ctx, { ...owner, terrains: (owner.terrains ?? []).filter((t) => t.id !== op.terrainId) });
    this.#deriveAllTerrain(ctx);
    this.#closeOp(ctx);
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

  #deriveTerrainOp(op: DeriveTerrainOp): LayerPatch {
    const layer = this.#doc.getLayer(op.layerId);
    if (!layer) throw new Error(`deriveTerrain: unknown layer "${op.layerId}"`);
    if (!isGridLayer(layer)) throw new TypeError(`deriveTerrain: "${op.layerId}" is not a grid layer`);
    const { width, height } = this.#doc.map;
    let x0 = 0;
    let y0 = 0;
    let x1 = width;
    let y1 = height;
    if (op.rect !== undefined) {
      const r = op.rect;
      if (![r.x, r.y, r.width, r.height].every(Number.isInteger) || r.width < 0 || r.height < 0) {
        throw new RangeError("deriveTerrain: rect must have integer position and non-negative integer size");
      }
      x0 = Math.max(0, r.x);
      y0 = Math.max(0, r.y);
      x1 = Math.min(width, r.x + r.width);
      y1 = Math.min(height, r.y + r.height);
    }
    const target = layer.role === "terrain" && layer.targetLayerId !== null ? this.#doc.getLayer(layer.targetLayerId) : undefined;
    const patchLayerId = isTileLayer(target) ? target.id : layer.id;
    if (!isTileLayer(target) || x0 >= x1 || y0 >= y1) return Object.freeze({ layerId: patchLayerId, cells: Object.freeze([]) });
    const cells: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cells.push(y * width + x);
    const ctx = this.#openOp();
    const opPatch = new PatchBuilder(this.#doc.map);
    this.#deriveTerrain(ctx, layer, cells, opPatch);
    this.#closeOp(ctx);
    return opPatch.build()[0] ?? Object.freeze({ layerId: patchLayerId, cells: Object.freeze([]) });
  }

  /** True when a terrain grid layer derives its tiles into tile layer `layerId`. */
  #isDerivedLayer(layerId: string): boolean {
    return this.#doc.layers.some((l) => isGridLayer(l) && l.role === "terrain" && l.targetLayerId === layerId);
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
      rec: local ? new ChangeRecorder() : this.#pending!,
      local,
      dirty: new DirtyTracker(),
      structure: new Set(),
      terrainCells: new Map(),
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
    if (cells.length === 0 && structure.length === 0 && !historyChanged) return;
    this.#emit({ cause: "dispatch", cells, structure, historyChanged });
  }

  /** Replaces a tileset (metadata change) and records it. */
  #replaceTileset(ctx: OpContext, next: Tileset): void {
    const before = this.#doc.getTileset(next.id)!;
    this.#doc._replaceTileset(next);
    const after = this.#doc.getTileset(next.id)!;
    ctx.rec.recordStructural(Object.freeze({ kind: "tileset", tilesetId: next.id, before, after }));
    ctx.structure.add("tilesets");
  }

  /** Re-derives every cell of every terrain layer that can hold a tile. */
  #deriveAllTerrain(ctx: OpContext): void {
    for (const layer of this.#doc.layers) {
      if (!isGridLayer(layer) || layer.role !== "terrain") continue;
      const target = layer.targetLayerId === null ? undefined : this.#doc.getLayer(layer.targetLayerId);
      if (!isTileLayer(target)) continue;
      this.#deriveTerrain(ctx, layer, this.#derivableCells(layer));
    }
  }

  /**
   * Cell indices (`y * width + x`) whose derived tile may be non-empty or
   * stale: grid chunks and their neighbours, plus chunks the target already has.
   */
  #derivableCells(grid: GridLayer): number[] {
    const { width, height } = this.#doc.map;
    const target = grid.targetLayerId === null ? undefined : this.#doc.getLayer(grid.targetLayerId);
    const keys = new Set<ChunkKey>();
    for (const chunk of grid.chunks()) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) keys.add(chunkKey(chunk.cx + dx, chunk.cy + dy));
    }
    if (target) for (const chunk of target.chunks()) keys.add(chunk.key);
    const cells: number[] = [];
    for (const key of keys) {
      const { cx, cy } = parseChunkKey(key);
      const x0 = cx << CHUNK_SHIFT;
      const y0 = cy << CHUNK_SHIFT;
      for (let y = Math.max(0, y0); y < Math.min(height, y0 + CHUNK_SIZE); y++) {
        for (let x = Math.max(0, x0); x < Math.min(width, x0 + CHUNK_SIZE); x++) cells.push(y * width + x);
      }
    }
    return cells;
  }

  /** Recomputes the derived tiles of `grid` at the given cell indices (`y * width + x`). */
  #deriveTerrain(ctx: OpContext, grid: GridLayer, cells: Iterable<number>, opPatch?: PatchBuilder): void {
    if (grid.targetLayerId === null) return;
    const target = this.#doc.getLayer(grid.targetLayerId);
    if (!isTileLayer(target)) return;
    const doc = this.#doc;
    const map = doc.map;
    const width = map.width;
    const terrains = doc.terrainMap();
    for (const index of cells) {
      const x = index % width;
      const y = (index - x) / width;
      const slot = terrainSlotAt(doc, grid, x, y, terrains);
      const cell = slot ? this.#terrainCell(ctx, slot, x, y) : 0;
      const before = target._setCell(x, y, cell);
      if (before === cell) continue;
      ctx.rec.recordCell(map, target.id, x, y, before, cell);
      opPatch?.record(target.id, x, y, before, cell);
      ctx.dirty.add(target.id, x, y);
    }
  }

  /** Cell for a terrain slot at (`x`, `y`); adds the terrain's palette entries on first use. */
  #terrainCell(ctx: OpContext, slot: TerrainSlot, x: number, y: number): Cell {
    const terrain = slot.terrain;
    let lists = ctx.terrainCells.get(terrain.id);
    if (lists === undefined) {
      const tileset = this.#doc.getTileset(terrain.tilesetId);
      if (tileset) {
        const palette = this.#doc.palette;
        const size = palette.size;
        lists = terrainCandidates(tileset, terrain).map((ids) => ids.map((id) => palette._getOrAdd(tileset.id, id)));
        if (palette.size !== size) ctx.structure.add("palette");
      } else {
        lists = null;
      }
      ctx.terrainCells.set(terrain.id, lists);
    }
    const list = lists?.[slot.slot];
    if (!list || list.length === 0) return 0;
    return makeCell(list[pickVariant(list.length, this.#doc.seed, x, y)]!);
  }

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
      case "tileset": {
        doc._replaceTileset(change[side]);
        result.structure.add("tilesets");
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
    return { cells, structure: STRUCTURE_ORDER.filter((s) => result.structure.has(s)) };
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
