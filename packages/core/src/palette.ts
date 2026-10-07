import { MAX_PALETTE_INDEX } from "./cell";

/** What a palette index points at. */
export interface PaletteEntry {
  readonly tilesetId: string;
  readonly tileId: number;
}

/**
 * Per-document table mapping a cell's palette index to a tile.
 *
 * Index `0` is reserved for the empty cell and never has an entry. The palette
 * is append-only: entries are never removed or reordered, so indices stored
 * in cells (and in undo history) stay valid.
 *
 * Reading is public; adding goes through `MapStore` (`addPaletteEntry` op or
 * `MapStore.getOrAddPaletteIndex`).
 */
export class Palette {
  /** `entries[i]` is palette index `i + 1`. */
  readonly #entries: PaletteEntry[] = [];
  readonly #lookup = new Map<string, number>();

  /** Number of entries (the highest valid palette index). */
  get size(): number {
    return this.#entries.length;
  }

  /** Entry for `index`, or `undefined` for `0` / unknown indices. */
  get(index: number): PaletteEntry | undefined {
    return index >= 1 ? this.#entries[index - 1] : undefined;
  }

  /** Index of an existing entry, or `0` when the tile is not in the palette. */
  indexOf(tilesetId: string, tileId: number): number {
    return this.#lookup.get(lookupKey(tilesetId, tileId)) ?? 0;
  }

  /** True when `index` is `0` or an existing entry. */
  has(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index <= this.#entries.length;
  }

  /** Entries in index order (`entries()[0]` is index 1). */
  entries(): readonly PaletteEntry[] {
    return this.#entries;
  }

  /**
   * @internal Mutation entry point used by the store and the parser.
   * Returns the existing index when the tile is already present.
   */
  _getOrAdd(tilesetId: string, tileId: number): number {
    const key = lookupKey(tilesetId, tileId);
    const existing = this.#lookup.get(key);
    if (existing !== undefined) return existing;
    if (this.#entries.length >= MAX_PALETTE_INDEX) throw new RangeError("Palette is full");
    this.#entries.push(Object.freeze({ tilesetId, tileId }));
    const index = this.#entries.length;
    this.#lookup.set(key, index);
    return index;
  }
}

function lookupKey(tilesetId: string, tileId: number): string {
  return `${tileId}:${tilesetId}`;
}
