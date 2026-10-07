/**
 * Pure logic of the grid-layer overlays (terrain tint, collision overlay):
 * one 32×32 code raster per chunk, which store changes invalidate which
 * chunk, a small generation-based chunk cache, the RGBA image of a raster
 * and the outline edges of solid areas. No Pixi, no DOM: unit tested.
 */
import {
  CHUNK_AREA,
  CHUNK_MASK,
  CHUNK_SHIFT,
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  cellPaletteIndex,
  isGridLayer,
  type ChunkKey,
  type MapDocument,
  type StoreChangeEvent,
} from "@smap/core";

// ------------------------------------------------------------------ collision raster

/** Collision raster codes. */
export const COLL_NONE = 0;
/** Solid because a tile there is marked solid. */
export const COLL_SOLID = 1;
/** Forced solid by a collision layer. */
export const COLL_FORCED_SOLID = 2;
/** Forced passable by a collision layer (an exception). */
export const COLL_FORCED_PASSABLE = 3;

/** True for the codes that block movement. */
export function isSolidCode(code: number): boolean {
  return code === COLL_SOLID || code === COLL_FORCED_SOLID;
}

/**
 * Collision codes of chunk (`cx`, `cy`), index = `localY * 32 + localX`.
 * Same rules as core `collisionAt`: the topmost collision layer with a
 * non-zero value wins, otherwise any tile layer's solid tile makes the cell
 * solid. `solid` is core `solidPaletteMask(doc)`. Cells outside the map are
 * `COLL_NONE`.
 */
export function collisionChunkRaster(
  doc: MapDocument,
  cx: number,
  cy: number,
  solid: Uint8Array,
  out: Uint8Array = new Uint8Array(CHUNK_AREA),
): Uint8Array {
  out.fill(COLL_NONE);
  const layers = doc.layers;
  for (const layer of layers) {
    if (isGridLayer(layer)) continue;
    const chunk = layer.getChunk(cx, cy);
    if (!chunk) continue;
    const data = chunk.data;
    for (let i = 0; i < CHUNK_AREA; i++) {
      const v = data[i]!;
      if (v !== 0 && solid[cellPaletteIndex(v)] === 1) out[i] = COLL_SOLID;
    }
  }
  // Exceptions bottom to top, so the topmost collision layer wins.
  for (const layer of layers) {
    if (!isGridLayer(layer) || layer.role !== "collision") continue;
    const chunk = layer.getChunk(cx, cy);
    if (!chunk) continue;
    const data = chunk.data;
    for (let i = 0; i < CHUNK_AREA; i++) {
      const v = data[i]!;
      if (v === COLLISION_SOLID) out[i] = COLL_FORCED_SOLID;
      else if (v === COLLISION_PASSABLE) out[i] = COLL_FORCED_PASSABLE;
    }
  }
  clipToMap(out, cx, cy, doc.map.width, doc.map.height);
  return out;
}

/**
 * Terrain tint raster of a grid layer chunk: 1 where a value is painted.
 * `data` is the layer chunk's data (or undefined for an empty chunk).
 */
export function paintedChunkRaster(data: ArrayLike<number> | undefined, out: Uint8Array = new Uint8Array(CHUNK_AREA)): Uint8Array {
  out.fill(0);
  if (data) for (let i = 0; i < CHUNK_AREA; i++) if (data[i] !== 0) out[i] = 1;
  return out;
}

function clipToMap(out: Uint8Array, cx: number, cy: number, width: number, height: number): void {
  const x0 = cx << CHUNK_SHIFT;
  const y0 = cy << CHUNK_SHIFT;
  if (x0 + CHUNK_MASK < width && y0 + CHUNK_MASK < height && x0 >= 0 && y0 >= 0) return;
  for (let i = 0; i < CHUNK_AREA; i++) {
    const x = x0 + (i & CHUNK_MASK);
    const y = y0 + (i >> CHUNK_SHIFT);
    if (x < 0 || y < 0 || x >= width || y >= height) out[i] = COLL_NONE;
  }
}

/** RGBA colour (0..255 each) per raster code; index 0 is ignored (transparent). */
export type CodeColors = readonly (readonly [number, number, number, number] | null)[];

/**
 * 32×32 RGBA pixels of a raster (one pixel per cell), or null when every
 * cell is transparent (no texture needed).
 */
export function rasterImage(raster: Uint8Array, colors: CodeColors): Uint8ClampedArray | null {
  let data: Uint8ClampedArray | null = null;
  for (let i = 0; i < raster.length; i++) {
    const code = raster[i]!;
    if (code === 0) continue;
    const c = colors[code];
    if (!c || c[3] === 0) continue;
    data ??= new Uint8ClampedArray(raster.length * 4);
    const o = i * 4;
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = c[3];
  }
  return data;
}

/** `0xRRGGBB` + alpha (0..1) → RGBA bytes. */
export function rgba(color: number, alpha: number): [number, number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255, Math.round(Math.min(1, Math.max(0, alpha)) * 255)];
}

// ------------------------------------------------------------------ invalidation

/** Which chunks of an overlay a change made stale. */
export interface Invalidation {
  /** Every chunk is stale. */
  readonly all: boolean;
  readonly keys: readonly ChunkKey[];
}

const NOTHING: Invalidation = Object.freeze({ all: false, keys: Object.freeze([]) });
const EVERYTHING: Invalidation = Object.freeze({ all: true, keys: Object.freeze([]) });

/**
 * Collision overlay chunks a store change affects:
 * - cell changes of tile layers and collision layers (terrain grids change
 *   collision only through their derived tile layer, which is listed too);
 * - everything on `tilesets` (solid metadata), `layers` (order, add/remove)
 *   and `map` (resize). `palette` is append-only and changes nothing.
 * `isTerrainGrid(layerId)` tells terrain grid layers apart.
 */
export function collisionInvalidation(e: StoreChangeEvent, isTerrainGrid: (layerId: string) => boolean): Invalidation {
  if (e.structure.includes("tilesets") || e.structure.includes("layers") || e.structure.includes("map")) return EVERYTHING;
  if (e.cells.length === 0) return NOTHING;
  const keys: ChunkKey[] = [];
  for (const d of e.cells) if (!isTerrainGrid(d.layerId)) keys.push(...d.chunks);
  return keys.length > 0 ? { all: false, keys } : NOTHING;
}

/** Terrain tint chunks of layer `layerId` a store change affects (`layers` / `map` → all). */
export function layerInvalidation(e: StoreChangeEvent, layerId: string): Invalidation {
  if (e.structure.includes("layers") || e.structure.includes("map")) return EVERYTHING;
  const d = e.cells.find((c) => c.layerId === layerId);
  return d && d.chunks.length > 0 ? { all: false, keys: d.chunks } : NOTHING;
}

/**
 * Per-chunk cache with lazy rebuilds. `invalidate` marks chunks stale (all
 * of them by bumping a generation); `get` rebuilds a missing or stale entry.
 * Empty results are cached too, so off-map / empty chunks are built once.
 */
export class ChunkCache<T> {
  #generation = 0;
  readonly #entries = new Map<ChunkKey, { generation: number; value: T }>();
  readonly #stale = new Set<ChunkKey>();

  invalidate(inv: Invalidation): void {
    if (inv.all) {
      this.#generation++;
      this.#stale.clear();
      return;
    }
    for (const k of inv.keys) if (this.#entries.has(k)) this.#stale.add(k);
  }

  /** True when `key` has no entry or a stale one. */
  isStale(key: ChunkKey): boolean {
    const e = this.#entries.get(key);
    return !e || e.generation !== this.#generation || this.#stale.has(key);
  }

  /** Entry of `key`, (re)built with `build(previous)` when missing or stale. */
  get(key: ChunkKey, build: (previous: T | undefined) => T): T {
    const e = this.#entries.get(key);
    if (e && !this.isStale(key)) return e.value;
    const value = build(e?.value);
    this.#entries.set(key, { generation: this.#generation, value });
    this.#stale.delete(key);
    return value;
  }

  /** Current entry without rebuilding (may be stale). */
  peek(key: ChunkKey): T | undefined {
    return this.#entries.get(key)?.value;
  }

  *values(): IterableIterator<T> {
    for (const e of this.#entries.values()) yield e.value;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Drops every entry, calling `dispose` on each. */
  clear(dispose?: (value: T) => void): void {
    if (dispose) for (const e of this.#entries.values()) dispose(e.value);
    this.#entries.clear();
    this.#stale.clear();
  }
}

// ------------------------------------------------------------------ outline

/**
 * Outline of the solid area inside cells `[x0, x1) × [y0, y1)`, as merged
 * runs along cell boundaries. A horizontal edge at `line = y` runs along the
 * top of row `y` from cell `from` to `to` (exclusive); a vertical edge at
 * `line = x` along the left of column `x`. `inside` tells which side is
 * solid: for horizontal edges `"after"` = the row below, for vertical edges
 * `"after"` = the column to the right. `solidAt` may be asked about cells
 * one outside the range.
 */
export interface Edge {
  readonly horizontal: boolean;
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly inside: "before" | "after";
}

export function solidEdges(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  solidAt: (x: number, y: number) => boolean,
): Edge[] {
  const out: Edge[] = [];
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return out;
  // Row of solid flags with one extra row/column of margin on each side.
  const W = w + 2;
  const H = h + 2;
  const grid = new Uint8Array(W * H);
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) grid[(y + 1) * W + (x + 1)] = solidAt(x0 + x, y0 + y) ? 1 : 0;
  }
  const at = (x: number, y: number) => grid[(y + 1) * W + (x + 1)]!;
  // Horizontal boundaries: lines y = 0..h (between row y-1 and row y).
  for (let y = 0; y <= h; y++) {
    let runStart = -1;
    let runInside: "before" | "after" = "after";
    for (let x = 0; x <= w; x++) {
      let kind: "before" | "after" | null = null;
      if (x < w) {
        const a = at(x, y - 1);
        const b = at(x, y);
        if (a !== b) kind = b ? "after" : "before";
      }
      if (runStart >= 0 && kind !== runInside) {
        out.push({ horizontal: true, line: y0 + y, from: x0 + runStart, to: x0 + x, inside: runInside });
        runStart = -1;
      }
      if (kind && runStart < 0) {
        runStart = x;
        runInside = kind;
      }
    }
  }
  // Vertical boundaries: lines x = 0..w (between column x-1 and column x).
  for (let x = 0; x <= w; x++) {
    let runStart = -1;
    let runInside: "before" | "after" = "after";
    for (let y = 0; y <= h; y++) {
      let kind: "before" | "after" | null = null;
      if (y < h) {
        const a = at(x - 1, y);
        const b = at(x, y);
        if (a !== b) kind = b ? "after" : "before";
      }
      if (runStart >= 0 && kind !== runInside) {
        out.push({ horizontal: false, line: x0 + x, from: y0 + runStart, to: y0 + y, inside: runInside });
        runStart = -1;
      }
      if (kind && runStart < 0) {
        runStart = y;
        runInside = kind;
      }
    }
  }
  return out;
}
