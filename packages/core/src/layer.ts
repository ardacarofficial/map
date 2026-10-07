import { EMPTY_CELL, type Cell } from "./cell";
import {
  Chunk,
  CHUNK_SHIFT,
  chunkKey,
  localIndex,
  type ChunkKey,
  type ReadonlyChunk,
} from "./chunk";

/** Layer kinds. v0.1 only has `"tile"`; `"grid"` and `"entity"` come later. */
export type LayerType = "tile";

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
  readonly type: LayerType = "tile";
  readonly id: string;
  #name: string;
  #visible: boolean;
  #locked: boolean;
  #opacity: number;
  readonly #chunks = new Map<ChunkKey, Chunk>();

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
    const key = chunkKey(cx, cy);
    let chunk = this.#chunks.get(key);
    if (!chunk) {
      if (cell === EMPTY_CELL) return EMPTY_CELL;
      chunk = new Chunk(cx, cy);
      this.#chunks.set(key, chunk);
    }
    const before = chunk.set(localIndex(x & 31, y & 31), cell);
    if (chunk.filled === 0) this.#chunks.delete(key);
    return before;
  }

  /** @internal Installs a decoded chunk (parser). Empty data is ignored. */
  _putChunk(cx: number, cy: number, data: Uint32Array): void {
    const chunk = new Chunk(cx, cy);
    for (let i = 0; i < data.length; i++) chunk.set(i, data[i] ?? EMPTY_CELL);
    if (chunk.filled > 0) this.#chunks.set(chunk.key, chunk);
  }
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
