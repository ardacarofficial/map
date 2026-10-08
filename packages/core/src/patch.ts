/**
 * Compact storage of cell changes (undo patches).
 *
 * A patch is `{ before, after }` per changed cell (CLAUDE.md → Undo). Instead
 * of one `{ x, y, before, after }` object per cell, the cells are grouped per
 * 32×32 chunk into parallel typed arrays: local index (`Uint16`), before and
 * after (`Uint32`). Recording allocates nothing per cell, and undo / redo
 * write a whole chunk at a time. Undo writes the `before` array, redo the
 * `after` array; there is no separate inverse.
 *
 * The public `LayerPatch.cells` list is built from these arrays only when
 * someone reads it (then kept), so internal paths never pay for it.
 */
import type { Cell } from "./cell";
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT, chunkKey, localIndex, type ChunkKey } from "./chunk";
import type { CellChange, LayerPatch } from "./ops";

/** @internal Changed cells of one chunk, as parallel arrays of equal length (no no-op cells). */
export interface ChunkCellChanges {
  readonly cx: number;
  readonly cy: number;
  readonly key: ChunkKey;
  /**
   * Local indices (`ly * 32 + lx`) of the changed cells, in recording order;
   * `null` when all 1024 cells changed: then entry `i` is local index `i`.
   */
  readonly indices: Uint16Array | null;
  readonly before: Uint32Array;
  readonly after: Uint32Array;
}

/** @internal Changed cells of one layer, chunk by chunk (chunks in first-touched order). */
export interface CellChangeSet {
  /** Total number of changed cells. */
  readonly size: number;
  readonly chunks: readonly ChunkCellChanges[];
}

const CHANGES = Symbol("cellChanges");

type WithChanges = { readonly [CHANGES]?: CellChangeSet };

/** Builds the public per-cell list (chunk by chunk, recording order inside a chunk). */
function materialize(set: CellChangeSet): readonly CellChange[] {
  const cells: CellChange[] = new Array<CellChange>(set.size);
  let n = 0;
  for (const chunk of set.chunks) {
    const x0 = chunk.cx << CHUNK_SHIFT;
    const y0 = chunk.cy << CHUNK_SHIFT;
    const { indices, before, after } = chunk;
    for (let i = 0; i < before.length; i++) {
      const index = indices === null ? i : indices[i]!;
      cells[n++] = { x: x0 | (index & CHUNK_MASK), y: y0 | (index >> CHUNK_SHIFT), before: before[i]!, after: after[i]! };
    }
  }
  return Object.freeze(cells);
}

/**
 * @internal Turns `target` into a frozen {@link LayerPatch}-shaped object backed by `set`:
 * `cells` is an enumerable getter that builds the per-cell list on first read.
 */
export function withCellChanges<T extends { readonly layerId: string }>(target: T, set: CellChangeSet): T & LayerPatch {
  let cells: readonly CellChange[] | null = null;
  Object.defineProperty(target, "cells", { enumerable: true, get: () => (cells ??= materialize(set)) });
  Object.defineProperty(target, CHANGES, { value: set });
  return Object.freeze(target) as T & LayerPatch;
}

/** @internal The compact changes behind a patch made by the store, or `undefined` for a plain patch object. */
export function cellChangesOf(patch: LayerPatch): CellChangeSet | undefined {
  return (patch as LayerPatch & WithChanges)[CHANGES];
}

/**
 * Number of changed cells in `patch`. Prefer this over `patch.cells.length`:
 * it does not build the per-cell list (a big fill changes a million cells).
 */
export function patchCellCount(patch: LayerPatch): number {
  return cellChangesOf(patch)?.size ?? patch.cells.length;
}

const INITIAL_CAPACITY = 32;

/** Changes of one chunk while recording: first `before` and last `after` per cell. */
class ChunkRecorder {
  readonly cx: number;
  readonly cy: number;
  /** local index → slot + 1 (0 = not recorded yet). */
  readonly #slots = new Uint16Array(CHUNK_AREA);
  #count = 0;
  #indices = new Uint16Array(INITIAL_CAPACITY);
  #before = new Uint32Array(INITIAL_CAPACITY);
  #after = new Uint32Array(INITIAL_CAPACITY);

  constructor(cx: number, cy: number) {
    this.cx = cx;
    this.cy = cy;
  }

  record(index: number, before: Cell, after: Cell): void {
    const slot = this.#slots[index]!;
    if (slot !== 0) {
      this.#after[slot - 1] = after;
      return;
    }
    let n = this.#count;
    if (n === this.#indices.length) this.#grow();
    this.#indices[n] = index;
    this.#before[n] = before;
    this.#after[n] = after;
    this.#slots[index] = ++n;
    this.#count = n;
  }

  #grow(): void {
    const capacity = Math.min(CHUNK_AREA, this.#indices.length * 2);
    const indices = new Uint16Array(capacity);
    const before = new Uint32Array(capacity);
    const after = new Uint32Array(capacity);
    indices.set(this.#indices);
    before.set(this.#before);
    after.set(this.#after);
    this.#indices = indices;
    this.#before = before;
    this.#after = after;
  }

  /** The recorded changes with no-op cells (`before === after`) dropped, or `null` when none remain. */
  build(): ChunkCellChanges | null {
    const count = this.#count;
    const indices = this.#indices;
    const before = this.#before;
    const after = this.#after;
    let changed = 0;
    for (let i = 0; i < count; i++) if (before[i] !== after[i]) changed++;
    if (changed === 0) return null;
    const key = chunkKey(this.cx, this.cy);
    if (changed === CHUNK_AREA) {
      // Whole chunk: store in local order and drop the index array.
      const b = new Uint32Array(CHUNK_AREA);
      const a = new Uint32Array(CHUNK_AREA);
      for (let i = 0; i < CHUNK_AREA; i++) {
        const index = indices[i]!;
        b[index] = before[i]!;
        a[index] = after[i]!;
      }
      return { cx: this.cx, cy: this.cy, key, indices: null, before: b, after: a };
    }
    if (changed === count && count === indices.length) return { cx: this.cx, cy: this.cy, key, indices, before, after };
    const outIndices = new Uint16Array(changed);
    const outBefore = new Uint32Array(changed);
    const outAfter = new Uint32Array(changed);
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (before[i] === after[i]) continue;
      outIndices[n] = indices[i]!;
      outBefore[n] = before[i]!;
      outAfter[n] = after[i]!;
      n++;
    }
    return { cx: this.cx, cy: this.cy, key, indices: outIndices, before: outBefore, after: outAfter };
  }
}

/** Changes of one layer while recording. Memory grows with the touched chunks, never with the map size. */
class LayerRecorder {
  /** `cy * 65536 + cx` → chunk recorder, in first-touched order. */
  readonly #chunks = new Map<number, ChunkRecorder>();
  #lastKey = -1;
  #last: ChunkRecorder | null = null;

  #chunk(cx: number, cy: number): ChunkRecorder {
    const key = cy * 65536 + cx;
    if (key === this.#lastKey) return this.#last!;
    let chunk = this.#chunks.get(key);
    if (!chunk) {
      chunk = new ChunkRecorder(cx, cy);
      this.#chunks.set(key, chunk);
    }
    this.#lastKey = key;
    this.#last = chunk;
    return chunk;
  }

  record(x: number, y: number, before: Cell, after: Cell): void {
    this.#chunk(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT).record(localIndex(x & CHUNK_MASK, y & CHUNK_MASK), before, after);
  }

  merge(set: CellChangeSet): void {
    for (const changes of set.chunks) {
      const chunk = this.#chunk(changes.cx, changes.cy);
      const { indices, before, after } = changes;
      for (let i = 0; i < before.length; i++) chunk.record(indices === null ? i : indices[i]!, before[i]!, after[i]!);
    }
  }

  build(): CellChangeSet | null {
    const chunks: ChunkCellChanges[] = [];
    let size = 0;
    for (const recorder of this.#chunks.values()) {
      const chunk = recorder.build();
      if (!chunk) continue;
      chunks.push(chunk);
      size += chunk.before.length;
    }
    return size === 0 ? null : Object.freeze({ size, chunks: Object.freeze(chunks) });
  }
}

/**
 * @internal Collects cell changes of in-bounds cells (`x`, `y` ≥ 0), keeping
 * the first `before` and the last `after` per cell. Discard after `build()`.
 */
export class PatchBuilder {
  readonly #layers = new Map<string, LayerRecorder>();
  #lastId: string | null = null;
  #last: LayerRecorder | null = null;

  #layer(layerId: string): LayerRecorder {
    if (this.#lastId === layerId) return this.#last!;
    let layer = this.#layers.get(layerId);
    if (!layer) {
      layer = new LayerRecorder();
      this.#layers.set(layerId, layer);
    }
    this.#lastId = layerId;
    this.#last = layer;
    return layer;
  }

  record(layerId: string, x: number, y: number, before: Cell, after: Cell): void {
    this.#layer(layerId).record(x, y, before, after);
  }

  /** Records every change of `set` (changes that happened after the ones recorded so far). */
  merge(layerId: string, set: CellChangeSet): void {
    this.#layer(layerId).merge(set);
  }

  /** Changes per layer with no-op cells dropped; layers without changes omitted. */
  build(): { layerId: string; changes: CellChangeSet }[] {
    const out: { layerId: string; changes: CellChangeSet }[] = [];
    for (const [layerId, layer] of this.#layers) {
      const changes = layer.build();
      if (changes) out.push({ layerId, changes });
    }
    return out;
  }
}
