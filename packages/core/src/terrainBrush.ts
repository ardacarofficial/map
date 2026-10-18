/**
 * Terrain brush solver (pure). Works on **any** tile layer: it reads the
 * terrain tags (see `terrainSet.ts`) of the tiles already on the layer and
 * returns plain tile writes. The store applies them with `paintCells`, so
 * undo, export and collision are unchanged.
 *
 * ## Corner sets (Tiled-like)
 *
 * Terrain lives on cell corners (vertices). Painting a cell puts the brush
 * terrain on its four corners; every touched cell (painted cells and their
 * 8 neighbours) then needs a tile whose tagged corners match. A neighbour's
 * other corners come from its current tile's tags (an empty cell has
 * terrain 0 on every corner).
 *
 * When no tile matches (e.g. there is a grass–dirt and a dirt–water
 * transition but no grass–water one), the solver changes the neighbour's
 * free corners to an **intermediate terrain** on the shortest path in the
 * set's transition graph (terrains are linked when one tile shows both)
 * and continues outward from there, ring by ring. Limits:
 * - the path may widen the painted area by at most `maxExpand` cells
 *   (default 4); beyond that the best partial match is used;
 * - one intermediate terrain per ring, so a path of k missing transitions
 *   needs k rings;
 * - the choice is greedy (cheapest tile per cell, in a fixed order), not a
 *   global optimum.
 *
 * ## Blob sets
 *
 * A cell belongs to terrain `t` when its tile is tagged `terrainId = t`.
 * Each touched cell of a terrain gets the tile for its 8-neighbour mask
 * (neighbours of the same terrain; neighbours **outside the map count as
 * the same terrain**, so the map edge draws no border — as in v0.3). If the
 * set has no tile for that mask, the closest mask (fewest differing bits)
 * is used. `boundary: "empty"` opts into real map-edge caps; the default remains solid.
 *
 * ## Shared rules
 *
 * - Cells whose tile is not tagged in the set (manual tiles, other
 *   tilesets) are **never changed** unless painted themselves; they count
 *   as "something else" for their neighbours.
 * - A cell whose current tile already fits keeps it (no variant re-roll).
 * - Several tiles with the same tags are variants: one is picked with
 *   `cellHash(doc.seed, x, y)` (sorted by tile id), so undo and reopening
 *   never change the choice.
 * - Deterministic: same document and input, same writes, same order
 *   (row-major).
 */
import { cellFlags, cellPaletteIndex, EMPTY_CELL, FLIP_D, FLIP_H, FLIP_V, type Cell } from "./cell";
import type { MapDocument } from "./document";
import type { CellPoint, CellRect } from "./geometry";
import { assertOrientation, inverseOrientation } from "./nineSlice";
import { isTileLayer, type TileLayer } from "./layer";
import type { PaletteEntry } from "./palette";
import { pickVariant, reduceBlobMask } from "./terrain";
import {
  flipBlobMask,
  flipCorners,
  getTerrainSet,
  terrainTagOf,
  type TerrainCorners,
  type TerrainSet,
} from "./terrainSet";

/** Which terrain the brush paints. */
export interface TerrainBrush {
  readonly tilesetId: string;
  readonly setId: string;
  /** Terrain id of the set; 0 paints "no terrain" (like the eraser without a background). */
  readonly terrainId: number;
}

/** One tile the brush writes: `tile: null` = empty cell. */
export interface TerrainTileWrite {
  readonly x: number;
  readonly y: number;
  readonly tile: PaletteEntry | null;
  /** H/V/D bits composed with the chosen tile; omitted for the default orientation. */
  readonly flags?: number;
}

/** Solver options. */
export interface TerrainSolveOptions {
  /** D4 H/V/D flags applied to the complete tile recipe. Default 0. */
  readonly orientation?: number;
  /** Blob neighbours beyond map bounds: legacy default solid; smart roads use empty. */
  readonly boundary?: "solid" | "empty";
  /** Corner sets: how many cells beyond the painted ones intermediate terrains may spread. Default 4. */
  readonly maxExpand?: number;
}

/** Default of {@link TerrainSolveOptions.maxExpand}. */
export const DEFAULT_TERRAIN_EXPAND = 4;

// ------------------------------------------------------------------ set index (cached per frozen set)

interface CornerConfig {
  readonly corners: TerrainCorners;
  readonly key: number;
  /** Tile ids with exactly these corners, ascending. Empty for the virtual "all zero = empty cell". */
  readonly tileIds: readonly number[];
}

interface SetIndex {
  /** Corner sets: distinct corner configurations, in a fixed order (by first tile id; virtual empty first). */
  readonly configs: readonly CornerConfig[];
  readonly configByKey: ReadonlyMap<number, CornerConfig>;
  /** Terrain graph distance `dist[a * n + b]` (n = max id + 1); `Infinity` when unreachable. */
  readonly dist: Float64Array;
  readonly n: number;
  /** Blob sets: terrain id → mask → tile ids (ascending). */
  readonly blob: ReadonlyMap<number, ReadonlyMap<number, readonly number[]>>;
}

const cornerKey = (c: TerrainCorners) => ((c[0]! << 24) | (c[1]! << 16) | (c[2]! << 8) | c[3]!) >>> 0;

const INDEX_CACHE = new WeakMap<TerrainSet, SetIndex>();

function setIndex(set: TerrainSet): SetIndex {
  let index = INDEX_CACHE.get(set);
  if (index) return index;
  const n = Math.max(0, ...set.terrains.map((t) => t.id)) + 1;
  const configByKey = new Map<number, { corners: TerrainCorners; key: number; tileIds: number[] }>();
  const empty = { corners: [0, 0, 0, 0] as TerrainCorners, key: 0, tileIds: [] as number[] };
  configByKey.set(0, empty);
  const blob = new Map<number, Map<number, number[]>>();
  const dist = new Float64Array(n * n).fill(Infinity);
  for (let a = 0; a < n; a++) dist[a * n + a] = 0;
  for (const tag of set.tiles) {
    if (set.kind === "corner" && tag.corners) {
      const key = cornerKey(tag.corners);
      if (key === 0) continue; // all-zero = empty cell
      let config = configByKey.get(key);
      if (!config) {
        config = { corners: tag.corners, key, tileIds: [] };
        configByKey.set(key, config);
      }
      config.tileIds.push(tag.tileId);
      for (const a of tag.corners) for (const b of tag.corners) if (a !== b && a < n && b < n) dist[a * n + b] = 1;
    } else if (set.kind === "blob" && tag.terrainId !== undefined) {
      let byMask = blob.get(tag.terrainId);
      if (!byMask) blob.set(tag.terrainId, (byMask = new Map()));
      const mask = reduceBlobMask(tag.mask ?? 0);
      const list = byMask.get(mask);
      if (list) list.push(tag.tileId);
      else byMask.set(mask, [tag.tileId]);
    }
  }
  // Floyd–Warshall: sets have a handful of terrains.
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const ik = dist[i * n + k]!;
      if (ik === Infinity) continue;
      for (let j = 0; j < n; j++) {
        const d = ik + dist[k * n + j]!;
        if (d < dist[i * n + j]!) dist[i * n + j] = d;
      }
    }
  }
  index = { configs: [...configByKey.values()], configByKey, dist, n, blob };
  INDEX_CACHE.set(set, index);
  return index;
}

// ------------------------------------------------------------------ cell reading

/** How the solver sees a cell. */
type CellInfo =
  | { readonly kind: "empty" }
  | { readonly kind: "fixed" }
  | { readonly kind: "corner"; readonly corners: TerrainCorners }
  | { readonly kind: "blob"; readonly terrainId: number; readonly mask: number };

const EMPTY_INFO: CellInfo = Object.freeze({ kind: "empty" });
const FIXED_INFO: CellInfo = Object.freeze({ kind: "fixed" });

function readCell(doc: MapDocument, set: TerrainSet, tilesetId: string, cell: Cell): CellInfo {
  return terrainTileInfo(set, tilesetId, cell === EMPTY_CELL ? null : doc.palette.get(cellPaletteIndex(cell)) ?? undefined, cellFlags(cell));
}

/** Reads a resolved tile without a document palette; shared by virtual previews and the document solver. */
export function terrainTileInfo(set: TerrainSet, tilesetId: string, entry: PaletteEntry | null | undefined, flags = 0): CellInfo {
  if (entry === null) return EMPTY_INFO;
  if (!entry || entry.tilesetId !== tilesetId) return FIXED_INFO;
  const tag = terrainTagOf(set, entry.tileId);
  if (!tag) return FIXED_INFO;
  const h = (flags & FLIP_H) !== 0;
  const v = (flags & FLIP_V) !== 0;
  const d = (flags & FLIP_D) !== 0;
  if (set.kind === "corner") {
    const corners = tag.corners ?? [0, 0, 0, 0];
    return { kind: "corner", corners: flags === 0 ? corners : flipCorners(corners, h, v, d) };
  }
  const mask = tag.mask ?? 0;
  return { kind: "blob", terrainId: tag.terrainId ?? 0, mask: reduceBlobMask(flags === 0 ? mask : flipBlobMask(mask, h, v, d)) };
}

/**
 * Terrain information of cell (`x`, `y`) of `layerId` for set `setId` of
 * `tilesetId`: `"empty"`, `"fixed"` (a tile not tagged in the set), or its
 * corners / blob membership as shown on screen (flips applied).
 * For UI (hover info, eyedropper). `null` for an unknown set or a non-tile layer.
 */
export function terrainCellInfo(
  doc: MapDocument,
  layerId: string,
  x: number,
  y: number,
  tilesetId: string,
  setId: string,
): CellInfo | null {
  const layer = doc.getLayer(layerId);
  const set = getTerrainSet(doc.getTileset(tilesetId), setId);
  if (!isTileLayer(layer) || !set) return null;
  return readCell(doc, set, tilesetId, layer.getCell(x, y));
}

export type { CellInfo as TerrainCellInfo };

// ------------------------------------------------------------------ public API

function resolve(doc: MapDocument, layerId: string, brush: TerrainBrush, what: string): { layer: TileLayer; set: TerrainSet } {
  const layer = doc.getLayer(layerId);
  if (!layer) throw new Error(`${what}: unknown layer "${layerId}"`);
  if (!isTileLayer(layer)) throw new TypeError(`${what}: "${layerId}" is not a tile layer`);
  const tileset = doc.getTileset(brush.tilesetId);
  if (!tileset) throw new Error(`${what}: unknown tileset "${brush.tilesetId}"`);
  const set = getTerrainSet(tileset, brush.setId);
  if (!set) throw new Error(`${what}: unknown terrain set "${brush.setId}" in tileset "${brush.tilesetId}"`);
  if (brush.terrainId !== 0 && !set.terrains.some((t) => t.id === brush.terrainId)) {
    throw new Error(`${what}: terrain set "${brush.setId}" has no terrain ${brush.terrainId}`);
  }
  return { layer, set };
}

/**
 * Tiles to write when the terrain brush paints `cells` of tile layer
 * `layerId` with `brush`: the painted cells plus affected neighbours (see
 * the module doc). Out-of-map cells are ignored. Only cells whose tile
 * actually changes are returned, row-major.
 * @throws Error on an unknown layer / tileset / set / terrain, or a non-tile layer.
 */
export function terrainPaint(
  doc: MapDocument,
  layerId: string,
  cells: readonly { readonly x: number; readonly y: number }[],
  brush: TerrainBrush,
  options: TerrainSolveOptions = {},
): TerrainTileWrite[] {
  const { layer, set } = resolve(doc, layerId, brush, "terrainPaint");
  if ((options.orientation ?? 0) & FLIP_D && doc.map.tileWidth !== doc.map.tileHeight) throw new Error("quarter-turn terrain orientation requires square map tiles");
  const solver = new Solver(doc, layer, set, brush.tilesetId, options);
  const painted = solver.painted(cells);
  if (painted.length === 0) return [];
  return set.kind === "corner"
    ? solver.solveCorners(painted, brush.terrainId, options.maxExpand ?? DEFAULT_TERRAIN_EXPAND)
    : solver.solveBlob(painted, brush.terrainId);
}

/**
 * Tiles to write when the terrain eraser erases `cells`: their terrain
 * becomes the set's `background` (0 = empty cells when it has none) and the
 * neighbours are re-solved. Same rules as {@link terrainPaint}.
 */
export function terrainErase(
  doc: MapDocument,
  layerId: string,
  cells: readonly { readonly x: number; readonly y: number }[],
  target: { readonly tilesetId: string; readonly setId: string },
  options: TerrainSolveOptions = {},
): TerrainTileWrite[] {
  const set = getTerrainSet(doc.getTileset(target.tilesetId), target.setId);
  return terrainPaint(doc, layerId, cells, { ...target, terrainId: set?.background ?? 0 }, options);
}

/**
 * The cells a terrain fill starting at (`x`, `y`) covers: the 4-connected
 * region of cells with the same terrain membership as the start cell
 * (corner sets: cells whose four corners are all the same terrain; blob
 * sets: cells of the same terrain; empty cells count as terrain 0). When the
 * start cell is mixed (a transition tile) or not tagged, the region is the
 * cells with exactly the same cell value. Row-major. Empty for an
 * out-of-map start.
 */
export function terrainFillRegion(
  doc: MapDocument,
  layerId: string,
  x: number,
  y: number,
  target: { readonly tilesetId: string; readonly setId: string },
): { x: number; y: number }[] {
  const { layer, set } = resolve(doc, layerId, { ...target, terrainId: 0 }, "terrainFill");
  if (!doc.inBounds(x, y)) return [];
  const { width, height } = doc.map;
  const keyOf = (cx: number, cy: number): string => {
    const cell = layer.getCell(cx, cy);
    const info = readCell(doc, set, target.tilesetId, cell);
    switch (info.kind) {
      case "empty":
        return "t0";
      case "corner": {
        const c = info.corners;
        return c[0] === c[1] && c[1] === c[2] && c[2] === c[3] ? `t${c[0]}` : `c${cell}`;
      }
      case "blob":
        return `t${info.terrainId}`;
      default:
        return `c${cell}`;
    }
  };
  const start = keyOf(x, y);
  const seen = new Uint8Array(width * height);
  const stack = [y * width + x];
  seen[y * width + x] = 1;
  const out: number[] = [];
  while (stack.length > 0) {
    const i = stack.pop()!;
    out.push(i);
    const cx = i % width;
    const cy = (i - cx) / width;
    const visit = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const ni = ny * width + nx;
      if (seen[ni]) return;
      seen[ni] = 1;
      if (keyOf(nx, ny) === start) stack.push(ni);
    };
    visit(cx + 1, cy);
    visit(cx - 1, cy);
    visit(cx, cy + 1);
    visit(cx, cy - 1);
  }
  out.sort((a, b) => a - b);
  return out.map((i) => ({ x: i % width, y: Math.floor(i / width) }));
}

/**
 * Terrain fill: {@link terrainPaint} over {@link terrainFillRegion}
 * (`brush.terrainId` 0 fills with "no terrain").
 */
export function terrainFill(
  doc: MapDocument,
  layerId: string,
  x: number,
  y: number,
  brush: TerrainBrush,
  options: TerrainSolveOptions = {},
): TerrainTileWrite[] {
  const region = terrainFillRegion(doc, layerId, x, y, brush);
  return region.length === 0 ? [] : terrainPaint(doc, layerId, region, brush, options);
}

// ------------------------------------------------------------------ solver

/** Cost of leaving a corner fixed by the brush (or a neighbour's decision) unmatched. */
const COST_HARD = 1000;
/** Cost of a free corner that may not change (beyond `maxExpand`) left unmatched. */
const COST_STUCK = 300;
/** Tie-break cost of a corner that differs from what the cell shows now. */
const COST_KEEP = 1;
/** Cost per terrain-graph step when changing a free corner. */
const COST_STEP = 10;
/**
 * Cost of changing a free corner to a terrain with no path to its current
 * one. Higher than leaving a fixed corner unmatched: a terrain without
 * transitions stays where it is painted instead of flooding the neighbours.
 */
const COST_NO_PATH = 1500;

class Solver {
  readonly #doc: MapDocument;
  readonly #layer: TileLayer;
  readonly #set: TerrainSet;
  readonly #tilesetId: string;
  readonly #width: number;
  readonly #height: number;
  readonly #info = new Map<number, CellInfo>();
  readonly #options: TerrainSolveOptions;

  constructor(doc: MapDocument, layer: TileLayer, set: TerrainSet, tilesetId: string, options: TerrainSolveOptions) {
    assertOrientation(options.orientation ?? 0);
    this.#options = options;
    this.#doc = doc;
    this.#layer = layer;
    this.#set = set;
    this.#tilesetId = tilesetId;
    this.#width = doc.map.width;
    this.#height = doc.map.height;
  }

  /** Distinct in-map painted cell indices, ascending. */
  painted(cells: readonly { readonly x: number; readonly y: number }[]): number[] {
    const seen = new Set<number>();
    for (const { x, y } of cells) if (this.#doc.inBounds(x, y)) seen.add(y * this.#width + x);
    return [...seen].sort((a, b) => a - b);
  }

  #cellInfo(i: number): CellInfo {
    let info = this.#info.get(i);
    if (!info) {
      const x = i % this.#width;
      info = readCell(this.#doc, this.#set, this.#tilesetId, this.#layer.getCell(x, (i - x) / this.#width));
      this.#info.set(i, info);
    }
    return info;
  }

  #write(i: number, tileIds: readonly number[] | null): TerrainTileWrite {
    const x = i % this.#width;
    const y = (i - x) / this.#width;
    if (!tileIds || tileIds.length === 0) return { x, y, tile: null };
    return { x, y, tile: { tilesetId: this.#tilesetId, tileId: tileIds[pickVariant(tileIds.length, this.#doc.seed, x, y)]! }, ...(this.#options.orientation ? { flags: this.#options.orientation } : {}) };
  }

  // -------------------------------------------------------------- corner

  solveCorners(painted: readonly number[], terrain: number, maxExpand: number): TerrainTileWrite[] {
    const W = this.#width;
    const H = this.#height;
    const VW = W + 1;
    const orientation = this.#options.orientation ?? 0;
    const h = !!(orientation & FLIP_H), v = !!(orientation & FLIP_V), d = !!(orientation & FLIP_D);
    const index = setIndex(orientation ? { ...this.#set, tiles: this.#set.tiles.map(t => t.corners ? { ...t, corners: flipCorners(t.corners, h, v, d) } : t) } : this.#set);
    const { dist, n } = index;
    const hard = new Map<number, number>();
    const paintedSet = new Set(painted);
    const vertices = (i: number): [number, number, number, number] => {
      const x = i % W;
      const y = (i - x) / W;
      const v = y * VW + x;
      return [v, v + 1, v + VW + 1, v + VW]; // nw, ne, se, sw
    };
    for (const i of painted) for (const v of vertices(i)) hard.set(v, terrain);

    // Distance (in cells) from the painted area, for the expansion limit.
    const distance = new Map<number, number>();
    for (const i of painted) distance.set(i, 0);

    const solvable = (i: number) => paintedSet.has(i) || this.#cellInfo(i).kind !== "fixed";
    const queue: number[] = [];
    const queued = new Set<number>();
    const enqueue = (i: number, d: number) => {
      const prev = distance.get(i);
      if (prev === undefined || d < prev) distance.set(i, d);
      if (queued.has(i) || !solvable(i)) return;
      queued.add(i);
      queue.push(i);
    };
    const initial = new Set<number>();
    for (const i of painted) {
      const x = i % W;
      const y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) initial.add(ny * W + nx);
        }
      }
    }
    for (const i of [...initial].sort((a, b) => a - b)) enqueue(i, paintedSet.has(i) ? 0 : 1);

    const chosen = new Map<number, CornerConfig>();
    const current = (i: number): TerrainCorners | null => {
      const info = this.#cellInfo(i);
      if (info.kind === "corner") return info.corners;
      if (info.kind === "empty") return [0, 0, 0, 0];
      return null; // fixed
    };
    const terrainDist = (a: number, b: number) => (a < n && b < n ? dist[a * n + b]! : a === b ? 0 : Infinity);

    // Each vertex becomes hard at most once, so every cell is solved at most 5 times.
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi]!;
      queued.delete(i);
      const vs = vertices(i);
      const own = current(i) ?? [terrain, terrain, terrain, terrain];
      const want: number[] = [0, 0, 0, 0];
      const isHard: boolean[] = [false, false, false, false];
      for (let k = 0; k < 4; k++) {
        const h = hard.get(vs[k]!);
        isHard[k] = h !== undefined;
        want[k] = h ?? own[k]!;
      }
      const d = distance.get(i) ?? maxExpand + 1;
      const canChange = d <= maxExpand;
      let best: CornerConfig | null = null;
      let bestCost = Infinity;
      const exact = index.configByKey.get(cornerKey(want as unknown as TerrainCorners));
      if (exact && (exact.key === 0 || exact.tileIds.length > 0)) {
        best = exact;
      } else {
        for (const config of index.configs) {
          let cost = 0;
          for (let k = 0; k < 4 && cost < bestCost; k++) {
            const have = config.corners[k]!;
            const w = want[k]!;
            // Tie-break: keep what the cell shows now.
            if (have !== own[k]) cost += COST_KEEP;
            if (have === w) continue;
            if (isHard[k]) cost += COST_HARD;
            else if (canChange) {
              const td = terrainDist(have, w);
              cost += td === Infinity ? COST_NO_PATH : COST_STEP * td;
            } else cost += COST_STUCK;
          }
          if (cost < bestCost) {
            bestCost = cost;
            best = config;
          }
        }
      }
      if (!best) continue;
      chosen.set(i, best);
      if (!canChange) continue;
      // Changed free corners become fixed; the cells sharing them are re-solved.
      for (let k = 0; k < 4; k++) {
        if (isHard[k] || best.corners[k] === want[k]) continue;
        const v = vs[k]!;
        hard.set(v, best.corners[k]!);
        const vx = v % VW;
        const vy = (v - vx) / VW;
        for (const [cx, cy] of [
          [vx - 1, vy - 1],
          [vx, vy - 1],
          [vx, vy],
          [vx - 1, vy],
        ] as const) {
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
          const ci = cy * W + cx;
          if (ci !== i) enqueue(ci, d + 1);
        }
      }
    }

    const writes: TerrainTileWrite[] = [];
    for (const i of [...chosen.keys()].sort((a, b) => a - b)) {
      const config = chosen.get(i)!;
      const cur = current(i); // null only for a painted manual tile, which is always replaced
      if (cur && cornerKey(cur) === config.key) continue; // already shows these corners
      writes.push(this.#write(i, config.key === 0 ? null : config.tileIds));
    }
    return writes;
  }

  // -------------------------------------------------------------- blob

  solveBlob(painted: readonly number[], terrain: number): TerrainTileWrite[] {
    const points = painted.map(i => ({ x: i % this.#width, y: Math.floor(i / this.#width) }));
    return solveBlobFromReader({
      width: this.#width, height: this.#height, seed: this.#doc.seed,
      read: (x, y) => {
        const cell = this.#layer.getCell(x, y);
        return { tile: cell === 0 ? null : this.#doc.palette.get(cellPaletteIndex(cell)), flags: cellFlags(cell) };
      },
    }, this.#set, { tilesetId: this.#tilesetId, setId: this.#set.id, terrainId: terrain }, terrainMembership(points), this.#options);
  }
}

function popcount(v: number): number {
  let c = 0;
  for (let x = v >>> 0; x !== 0; x &= x - 1) c++;
  return c;
}


/** Palette-independent tile source for a blob solve, including virtual area/road preview cells. */
export interface TerrainTileReader {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly read: (x: number, y: number) => { readonly tile: PaletteEntry | null | undefined; readonly flags?: number };
}

/** Full virtual paint/erase membership. Bounds are half-open; contains must be pure and independent of a preview window. */
export interface TerrainMembership {
  readonly bounds: CellRect;
  readonly contains: (x: number, y: number) => boolean;
  /** Optional exact members, to avoid scanning a sparse stroke's bounding rectangle. */
  readonly cells?: readonly CellPoint[];
}

/** Immutable, deduplicated integer stroke membership. Reordering inputs has no effect. */
export function terrainMembership(cells: readonly CellPoint[]): TerrainMembership {
  const seen = new Map<string, CellPoint>();
  for (const p of cells) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) throw new TypeError("membership coordinates must be integers");
    seen.set(`${p.x},${p.y}`, Object.freeze({ x: p.x, y: p.y }));
  }
  const points = Object.freeze([...seen.values()].sort((a, b) => a.y - b.y || a.x - b.x));
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  return { bounds: points.length ? { x, y, width: right - x + 1, height: bottom - y + 1 } : { x: 0, y: 0, width: 0, height: 0 }, cells: points, contains: (cx, cy) => seen.has(`${cx},${cy}`) };
}

/** Blob preview options. Returned writes are restricted to window plus a one-cell halo; reads use complete membership. */
export interface TerrainBlobSolveOptions extends TerrainSolveOptions {
  readonly window?: CellRect;
  /** Optional virtual membership beyond map bounds (e.g. an unclipped area). Overrides boundary only there. */
  readonly outside?: (x: number, y: number) => number;
}

/**
 * The single blob topology implementation. Reads current tiles through a pure reader and overlays full membership.
 * Only members and their one-cell neighbours can change; manual neighbours stay fixed, fitting cells retain exact flags.
 * Orientation looks up candidates in inverse mask space and emits oriented flags. Legacy nearest-mask fallback is retained;
 * a completed nine-slice bank has every mask and never uses it.
 */
export function solveBlobFromReader(reader: TerrainTileReader, set: TerrainSet, brush: TerrainBrush, membership: TerrainMembership, options: TerrainBlobSolveOptions = {}): TerrainTileWrite[] {
  if (set.kind !== "blob") throw new TypeError("reader blob solve requires a blob terrain set");
  const orientation = options.orientation ?? 0;
  assertOrientation(orientation);
  const inverse = inverseOrientation(orientation), index = setIndex(set), { width: W, height: H } = reader;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const cache = new Map<number, CellInfo>();
  const infoAt = (x: number, y: number) => {
    const i = y * W + x;
    let info = cache.get(i);
    if (!info) { const c = reader.read(x, y); info = terrainTileInfo(set, brush.tilesetId, c.tile, c.flags ?? 0); cache.set(i, info); }
    return info;
  };
  const member = (x: number, y: number) => {
    if (membership.contains(x, y)) return brush.terrainId;
    const c = infoAt(x, y);
    return c.kind === "blob" ? c.terrainId : c.kind === "empty" ? 0 : -1;
  };
  const affected = new Set<number>(), b = membership.bounds, window = options.window;
  const add = (x: number, y: number) => {
    if (inside(x, y) && (!window || (x >= window.x - 1 && y >= window.y - 1 && x < window.x + window.width + 1 && y < window.y + window.height + 1))) affected.add(y * W + x);
  };
  if (membership.cells && !window) {
    for (const p of membership.cells) if (inside(p.x, p.y)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(p.x + dx, p.y + dy);
  } else if (b.width > 0 && b.height > 0) {
    const x0 = Math.max(0, b.x - 1, window ? window.x - 1 : 0), y0 = Math.max(0, b.y - 1, window ? window.y - 1 : 0);
    const x1 = Math.min(W, b.x + b.width + 1, window ? window.x + window.width + 1 : W), y1 = Math.min(H, b.y + b.height + 1, window ? window.y + window.height + 1 : H);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      let touched = false;
      for (let dy = -1; dy <= 1 && !touched; dy++) for (let dx = -1; dx <= 1; dx++) if (inside(x + dx, y + dy) && membership.contains(x + dx, y + dy)) { touched = true; break; }
      if (touched) add(x, y);
    }
  }
  const offsets = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
  const writes: TerrainTileWrite[] = [];
  for (const i of [...affected].sort((a, b) => a - b)) {
    const x = i % W, y = Math.floor(i / W), info = infoAt(x, y), m = member(x, y);
    if (!membership.contains(x, y) && info.kind !== "blob") continue;
    if (m <= 0) { if (info.kind !== "empty") writes.push({ x, y, tile: null }); continue; }
    let raw = 0;
    offsets.forEach(([dx, dy], bit) => {
      const nx = x + dx, ny = y + dy;
      if (inside(nx, ny) ? member(nx, ny) === m : options.outside ? options.outside(nx, ny) === m : options.boundary !== "empty") raw |= 1 << bit;
    });
    const mask = reduceBlobMask(raw);
    if (info.kind === "blob" && info.terrainId === m && info.mask === mask) continue;
    const lookup = flipBlobMask(mask, !!(inverse & FLIP_H), !!(inverse & FLIP_V), !!(inverse & FLIP_D));
    const byMask = index.blob.get(m);
    if (!byMask || byMask.size === 0) continue;
    let ids = byMask.get(lookup);
    if (!ids) {
      let best = Infinity;
      for (const [candidate, choices] of [...byMask].sort((a, b) => a[0] - b[0])) {
        const diff = popcount(candidate ^ lookup);
        if (diff < best) { best = diff; ids = choices; }
      }
    }
    writes.push({ x, y, tile: { tilesetId: brush.tilesetId, tileId: ids![pickVariant(ids!.length, reader.seed, x, y)]! }, ...(orientation ? { flags: orientation } : {}) });
  }
  return writes;
}
