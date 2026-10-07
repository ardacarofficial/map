/**
 * Autotile derivation: terrain grid → tiles. Pure functions; the store uses
 * the same code when a `paintTerrain` op re-derives the linked tile layer.
 *
 * Rules (see also `samples/tilesets/TEMPLATES.md`):
 *
 * - **blob47** (every `blob47-*` layout) — a cell whose grid value is terrain `t` gets the tile for
 *   its 8-neighbour mask: a neighbour bit is set when that neighbour holds
 *   `t` **or lies outside the map** (the map edge draws no border). Cells
 *   that do not hold a blob terrain get nothing from it.
 * - **corner16** — terrain lives on cell corners (vertices): painting a cell
 *   puts the terrain on its four corners (like Tiled's corner terrain brush).
 *   A vertex has terrain `t` when any in-map cell touching it holds `t`.
 *   So a painted cell is always fully covered (slot 15) and its 8
 *   neighbours get the matching transition tiles (half / quarter covered).
 *   Outside-map cells do not contribute (a painted edge cell still covers
 *   its outer corners itself). A cell whose corners are all empty gets nothing.
 * - **Several terrains on one layer** (v0.3 limitation): each terrain is
 *   drawn "over empty"; any other value counts as "different". A painted
 *   cell uses its own terrain; an unpainted cell next to corner16 terrains
 *   shows the transition of the smallest neighbouring corner16 terrain id.
 *   Proper terrain-over-terrain transitions are not supported.
 * - Values with no defined terrain (e.g. after `removeTerrain`) derive nothing.
 * - Variants: the slot's candidates are `[block tile, ...variants]`;
 *   `candidates[hash(doc.seed, x, y) % n]` is used.
 */
import type { MapDocument } from "./document";
import type { GridLayer } from "./layer";
import { isGridLayer } from "./layer";
import type { PaletteEntry } from "./palette";
import {
  BLOB_E,
  BLOB_N,
  BLOB_NE,
  BLOB_NW,
  BLOB_S,
  BLOB_SE,
  BLOB_SW,
  BLOB_W,
  CORNER_NE,
  CORNER_NW,
  CORNER_SE,
  CORNER_SW,
  corner16Slot,
  pickVariant,
  terrainCandidates,
  terrainSlotForMask,
  type Terrain,
} from "./terrain";

/** Which template slot of which terrain a cell shows. */
export interface TerrainSlot {
  readonly terrain: Terrain;
  readonly slot: number;
}

/** Neighbour offsets in blob bit order: N, NE, E, SE, S, SW, W, NW. */
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [0, -1, BLOB_N],
  [1, -1, BLOB_NE],
  [1, 0, BLOB_E],
  [1, 1, BLOB_SE],
  [0, 1, BLOB_S],
  [-1, 1, BLOB_SW],
  [-1, 0, BLOB_W],
  [-1, -1, BLOB_NW],
];

/**
 * The terrain slot cell (`x`, `y`) of `grid` shows, or `null` for "no tile".
 * Only reads the 3×3 neighbourhood, so a change to one cell affects at most
 * that cell and its 8 neighbours.
 */
export function terrainSlotAt(
  doc: MapDocument,
  grid: GridLayer,
  x: number,
  y: number,
  terrains: ReadonlyMap<number, Terrain> = doc.terrainMap(),
): TerrainSlot | null {
  const { width, height } = doc.map;
  const inMap = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < width && cy < height;
  const value = grid.getCell(x, y);

  if (value !== 0) {
    const terrain = terrains.get(value);
    if (!terrain) return null;
    if (terrain.template === "corner16") return { terrain, slot: corner16Slot(15) };
    // Every other template is a blob47 layout.
    let mask = 0;
    for (const [dx, dy, bit] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inMap(nx, ny) || grid.getCell(nx, ny) === value) mask |= bit;
    }
    return { terrain, slot: terrainSlotForMask(terrain.template, mask) };
  }

  // Empty cell: corner16 terrains of neighbours spill onto its corners.
  let best: Terrain | null = null;
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inMap(nx, ny)) continue;
    const v = grid.getCell(nx, ny);
    if (v === 0 || (best && v >= best.id)) continue;
    const terrain = terrains.get(v);
    if (terrain && terrain.template === "corner16") best = terrain;
  }
  if (!best) return null;
  const t = best.id;
  const has = (dx: number, dy: number) => inMap(x + dx, y + dy) && grid.getCell(x + dx, y + dy) === t;
  let mask = 0;
  // Each corner vertex is shared by this cell (empty here) and three neighbours.
  if (has(0, -1) || has(1, -1) || has(1, 0)) mask |= CORNER_NE;
  if (has(1, 0) || has(1, 1) || has(0, 1)) mask |= CORNER_SE;
  if (has(0, 1) || has(-1, 1) || has(-1, 0)) mask |= CORNER_SW;
  if (has(-1, 0) || has(-1, -1) || has(0, -1)) mask |= CORNER_NW;
  return { terrain: best, slot: corner16Slot(mask) };
}

/** Candidate cache shared by the derivation helpers. */
export class TerrainTiles {
  readonly #doc: MapDocument;
  readonly #cache = new Map<number, number[][] | null>();

  constructor(doc: MapDocument) {
    this.#doc = doc;
  }

  /** Candidate tile ids per slot for `terrain`, or `null` when its tileset is missing. */
  candidates(terrain: Terrain): number[][] | null {
    let c = this.#cache.get(terrain.id);
    if (c === undefined) {
      const tileset = this.#doc.getTileset(terrain.tilesetId);
      c = tileset ? terrainCandidates(tileset, terrain) : null;
      this.#cache.set(terrain.id, c);
    }
    return c;
  }

  /** Tile id shown at (`x`, `y`) for `slot`, variant picked by `hash(seed, x, y)`. */
  tileId(slot: TerrainSlot, x: number, y: number): number | null {
    const list = this.candidates(slot.terrain)?.[slot.slot];
    if (!list || list.length === 0) return null;
    return list[pickVariant(list.length, this.#doc.seed, x, y)]!;
  }
}

/**
 * The tile terrain layer `layerId` derives at (`x`, `y`), or `null` for "empty".
 * Handy for brush previews and tests.
 * @throws Error when `layerId` is not a grid layer.
 */
export function terrainTileAt(doc: MapDocument, layerId: string, x: number, y: number): PaletteEntry | null {
  const grid = doc.getLayer(layerId);
  if (!isGridLayer(grid)) throw new Error(`terrainTileAt: "${layerId}" is not a grid layer`);
  const slot = terrainSlotAt(doc, grid, x, y);
  if (!slot) return null;
  const tileId = new TerrainTiles(doc).tileId(slot, x, y);
  return tileId === null ? null : { tilesetId: slot.terrain.tilesetId, tileId };
}

/**
 * From-scratch derivation of a whole terrain layer: `width × height`
 * entries, row-major, `null` = empty. The store's incremental updates must
 * always equal this (tested).
 * @throws Error when `layerId` is not a grid layer.
 */
export function deriveTerrainTiles(doc: MapDocument, layerId: string): (PaletteEntry | null)[] {
  const grid = doc.getLayer(layerId);
  if (!isGridLayer(grid)) throw new Error(`deriveTerrainTiles: "${layerId}" is not a grid layer`);
  const { width, height } = doc.map;
  const terrains = doc.terrainMap();
  const tiles = new TerrainTiles(doc);
  const out: (PaletteEntry | null)[] = new Array<PaletteEntry | null>(width * height).fill(null);
  if (grid.role !== "terrain") return out;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const slot = terrainSlotAt(doc, grid, x, y, terrains);
      if (!slot) continue;
      const tileId = tiles.tileId(slot, x, y);
      if (tileId !== null) out[y * width + x] = { tilesetId: slot.terrain.tilesetId, tileId };
    }
  }
  return out;
}
