import { EMPTY_CELL, type Cell } from "./cell";
import type { Entity } from "./entity";
import {
  Chunk,
  CHUNK_SHIFT,
  chunkKey,
  localIndex,
  type ChunkKey,
  type ReadonlyChunk,
} from "./chunk";

/**
 * Layer kinds. `"tile"` holds cells (palette index + flip flags); `"grid"`
 * (v0.3) holds small integers for terrain or collision; `"entity"` (v0.6)
 * holds placed entities and no cells.
 */
export type LayerType = "tile" | "grid" | "entity";

/**
 * What a grid layer is for.
 * - `"terrain"`: cell value = terrain id (0 = none). The linked tile layer
 *   (`targetLayerId`) is derived from it (autotile).
 * - `"collision"`: exceptions to the collision derived from solid tiles:
 *   {@link COLLISION_SOLID} forces solid, {@link COLLISION_PASSABLE} forces passable.
 */
export type GridRole = "terrain" | "collision";

/** Largest value a grid cell may hold. */
export const MAX_GRID_VALUE = 0xffff;
/** Collision grid value: force solid. */
export const COLLISION_SOLID = 1;
/** Collision grid value: force passable (e.g. a door in a solid wall tile). */
export const COLLISION_PASSABLE = 2;
/** Largest value of a collision grid cell. */
export const MAX_COLLISION_VALUE = 2;

/** Editable layer properties (everything in {@link LayerProps} except `id`). */
export interface LayerPropValues {
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  /** 0..1 */
  readonly opacity: number;
}

/** @internal Copy of one stored chunk (see `TileLayer._snapshot`). */
export interface ChunkSnapshot {
  readonly cx: number;
  readonly cy: number;
  readonly data: Uint32Array;
}

/** Properties shared by every layer kind. */
export interface LayerProps {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  /** 0..1 */
  readonly opacity: number;
}

/**
 * A sparse tile layer stored as 32×32 chunks.
 *
 * Chunks are created on the first non-empty write and removed as soon as they
 * become fully empty, so an empty layer holds no memory. Bounds are enforced
 * by the document/store, not here.
 *
 * Reading is public. Writing goes through `MapStore.dispatch` only.
 */
export class TileLayer implements LayerProps {
  /** `"grid"` for a {@link GridLayer} (which extends this class); check with {@link isGridLayer}. */
  readonly type: LayerType = "tile";
  readonly id: string;
  #name: string;
  #visible: boolean;
  #locked: boolean;
  #opacity: number;
  readonly #chunks = new Map<ChunkKey, Chunk>();
  /** Last chunk written by `_setCell` (cache; cleared whenever chunks are removed). */
  #lastChunk: Chunk | null = null;

  constructor(props: LayerProps) {
    this.id = props.id;
    this.#name = props.name;
    this.#visible = props.visible;
    this.#locked = props.locked;
    this.#opacity = props.opacity;
  }

  get name(): string {
    return this.#name;
  }

  get visible(): boolean {
    return this.#visible;
  }

  get locked(): boolean {
    return this.#locked;
  }

  get opacity(): number {
    return this.#opacity;
  }

  /** Cell at (`x`, `y`); `EMPTY_CELL` where no chunk exists. */
  getCell(x: number, y: number): Cell {
    const chunk = this.#chunks.get(chunkKey(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT));
    return chunk ? (chunk.data[localIndex(x & 31, y & 31)] ?? EMPTY_CELL) : EMPTY_CELL;
  }

  /** Chunk (`cx`, `cy`) or `undefined` when it holds no cells. */
  getChunk(cx: number, cy: number): ReadonlyChunk | undefined {
    return this.#chunks.get(chunkKey(cx, cy));
  }

  /** Chunk by key or `undefined`. */
  getChunkByKey(key: ChunkKey): ReadonlyChunk | undefined {
    return this.#chunks.get(key);
  }

  /** All stored (non-empty) chunks, in insertion order. */
  chunks(): IterableIterator<ReadonlyChunk> {
    return this.#chunks.values();
  }

  /** Number of stored chunks. */
  get chunkCount(): number {
    return this.#chunks.size;
  }

  /**
   * @internal Writes one cell (no bounds check). Returns the previous value.
   * Creates the chunk on demand and deletes it when it becomes empty.
   */
  _setCell(x: number, y: number, cell: Cell): Cell {
    const cx = x >> CHUNK_SHIFT;
    const cy = y >> CHUNK_SHIFT;
    let chunk = this.#lastChunk;
    if (!chunk || chunk.cx !== cx || chunk.cy !== cy) {
      const key = chunkKey(cx, cy);
      chunk = this.#chunks.get(key) ?? null;
      if (!chunk) {
        if (cell === EMPTY_CELL) return EMPTY_CELL;
        chunk = new Chunk(cx, cy);
        this.#chunks.set(key, chunk);
      }
      this.#lastChunk = chunk;
    }
    const before = chunk.set(localIndex(x & 31, y & 31), cell);
    if (chunk.filled === 0) {
      this.#chunks.delete(chunk.key);
      this.#lastChunk = null;
    }
    return before;
  }

  /** Current editable properties as a plain object. */
  props(): LayerPropValues {
    return { name: this.#name, visible: this.#visible, locked: this.#locked, opacity: this.#opacity };
  }

  /** @internal Replaces the editable properties (validated by the caller). */
  _setProps(props: LayerPropValues): void {
    this.#name = props.name;
    this.#visible = props.visible;
    this.#locked = props.locked;
    this.#opacity = props.opacity;
  }

  /** @internal Copies of all stored chunks, sorted by `cy`, then `cx`. */
  _snapshot(): ChunkSnapshot[] {
    return [...this.#chunks.values()]
      .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
      .map((chunk) => ({ cx: chunk.cx, cy: chunk.cy, data: chunk.data.slice() }));
  }

  /** @internal Replaces all chunks with copies of `snapshot`. */
  _restore(snapshot: readonly ChunkSnapshot[]): void {
    this.#chunks.clear();
    this.#lastChunk = null;
    for (const chunk of snapshot) this._putChunk(chunk.cx, chunk.cy, chunk.data);
  }

  /** @internal Installs a decoded chunk (parser). Empty data is ignored. */
  _putChunk(cx: number, cy: number, data: Uint32Array): void {
    const chunk = new Chunk(cx, cy);
    chunk.data.set(data.subarray(0, chunk.data.length));
    let filled = 0;
    for (let i = 0; i < chunk.data.length; i++) if (chunk.data[i] !== EMPTY_CELL) filled++;
    chunk.filled = filled;
    this.#lastChunk = null;
    if (chunk.filled > 0) this.#chunks.set(chunk.key, chunk);
  }
}

/**
 * A sparse grid of small integers (terrain ids or collision kinds), stored
 * and addressed exactly like a tile layer (32×32 chunks, `>> 5`, `& 31`);
 * cell 0 means "none". `getCell` returns the integer value.
 *
 * Written with the `paintTerrain` op only (`paintCells` rejects grid layers).
 * Role and link are fixed when the layer is created.
 */
export class GridLayer extends TileLayer {
  override readonly type: LayerType = "grid";
  readonly role: GridRole;
  /** Terrain role: id of the tile layer derived from this grid, or `null`. Always `null` for collision. */
  readonly targetLayerId: string | null;

  constructor(props: LayerProps, role: GridRole, targetLayerId: string | null = null) {
    super(props);
    this.role = role;
    this.targetLayerId = role === "terrain" ? targetLayerId : null;
  }

  /** Largest value this layer accepts. */
  get maxValue(): number {
    return this.role === "collision" ? MAX_COLLISION_VALUE : MAX_GRID_VALUE;
  }
}

/**
 * A layer of placed entities (v0.6). It holds no cells: it extends
 * {@link TileLayer} only so that `MapDocument.layers` keeps one element
 * type; its chunk list is always empty and cell writes are rejected.
 * Check with {@link isEntityLayer}; "real" tile layers with {@link isTileLayer}.
 *
 * Entities are written with the entity ops only (`addEntity`, `moveEntity`,
 * `updateEntity`, `removeEntity`).
 */
export class EntityLayer extends TileLayer {
  override readonly type: LayerType = "entity";
  #entities: readonly Entity[] = Object.freeze([]);

  /** Entities in drawing order (first = bottom). Frozen; replaced on every change. */
  get entities(): readonly Entity[] {
    return this.#entities;
  }

  /** Entity by id, or `undefined`. */
  getEntity(id: string): Entity | undefined {
    return this.#entities.find((e) => e.id === id);
  }

  /** @internal Replaces the entity list (validated by the caller). */
  _setEntities(entities: readonly Entity[]): void {
    this.#entities = Object.isFrozen(entities) ? entities : Object.freeze([...entities]);
  }

  /** @internal Entity layers hold no cells. */
  override _setCell(x: number, y: number, cell: Cell): Cell {
    if (cell === EMPTY_CELL) return EMPTY_CELL;
    throw new TypeError(`entity layer "${this.id}" holds no cells (write at (${x}, ${y}))`);
  }

  /** @internal Entity layers hold no cells. */
  override _putChunk(cx: number, cy: number, data: Uint32Array): void {
    if (data.some((v) => v !== EMPTY_CELL)) throw new TypeError(`entity layer "${this.id}" holds no cells (chunk ${cx}, ${cy})`);
  }
}

/** True for entity layers. */
export function isEntityLayer(layer: TileLayer | undefined | null): layer is EntityLayer {
  return layer instanceof EntityLayer;
}

/** True for plain tile layers (not grid, not entity). */
export function isTileLayer(layer: TileLayer | undefined | null): layer is TileLayer {
  return layer instanceof TileLayer && layer.type === "tile";
}

/** True for grid (terrain / collision) layers. */
export function isGridLayer(layer: TileLayer | undefined | null): layer is GridLayer {
  return layer instanceof GridLayer;
}

/** True when `value` names a grid role. */
export function isGridRole(value: unknown): value is GridRole {
  return value === "terrain" || value === "collision";
}

/** Returns a description of what is wrong with `props`, or `null`. */
export function layerPropsProblem(props: LayerProps): string | null {
  if (typeof props.id !== "string" || props.id.length === 0) return "id must be a non-empty string";
  if (typeof props.name !== "string") return "name must be a string";
  if (typeof props.visible !== "boolean") return "visible must be a boolean";
  if (typeof props.locked !== "boolean") return "locked must be a boolean";
  if (typeof props.opacity !== "number" || !(props.opacity >= 0 && props.opacity <= 1)) {
    return `opacity must be a number in [0, 1], got ${String(props.opacity)}`;
  }
  return null;
}
