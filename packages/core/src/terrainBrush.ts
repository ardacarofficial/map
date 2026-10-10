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
 * is used.
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
}

/** Solver options. */
export interface TerrainSolveOptions {
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
  if (cell === EMPTY_CELL) return EMPTY_INFO;
  const entry = doc.palette.get(cellPaletteIndex(cell));
  if (!entry || entry.tilesetId !== tilesetId) return FIXED_INFO;
  const tag = terrainTagOf(set, entry.tileId);
  if (!tag) return FIXED_INFO;
  const flags = cellFlags(cell);
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
  const solver = new Solver(doc, layer, set, brush.tilesetId);
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

  constructor(doc: MapDocument, layer: TileLayer, set: TerrainSet, tilesetId: string) {
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
    return { x, y, tile: { tilesetId: this.#tilesetId, tileId: tileIds[pickVariant(tileIds.length, this.#doc.seed, x, y)]! } };
  }

  // -------------------------------------------------------------- corner

  solveCorners(painted: readonly number[], terrain: number, maxExpand: number): TerrainTileWrite[] {
    const W = this.#width;
    const H = this.#height;
    const VW = W + 1;
    const index = setIndex(this.#set);
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
        bestCost = 0;
      } else {
        for (const config of index.configs) {
          let cost = 0;
          for (let k = 0; k < 4 && cost < bestCost; k++) {
            const have = config.corners[k]!;
            const w = want[k]!;
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
      const cur = current(i);
      if (cur && cornerKey(cur) === config.key) {
        // Already shows these corners (an empty cell stays empty).
        if (!paintedSet.has(i) || this.#cellInfo(i).kind !== "fixed") continue;
      }
      if (config.key === 0 && this.#cellInfo(i).kind === "empty") continue;
      writes.push(this.#write(i, config.key === 0 ? null : config.tileIds));
    }
    return writes;
  }

  // -------------------------------------------------------------- blob

  solveBlob(painted: readonly number[], terrain: number): TerrainTileWrite[] {
    const W = this.#width;
    const H = this.#height;
    const index = setIndex(this.#set);
    const paintedSet = new Set(painted);
    /** Membership: terrain id, 0 = empty, -1 = fixed (something else). */
    const member = (i: number): number => {
      if (paintedSet.has(i)) return terrain;
      const info = this.#cellInfo(i);
      return info.kind === "blob" ? info.terrainId : info.kind === "empty" ? 0 : -1;
    };
    const affected = new Set<number>();
    for (const i of painted) {
      const x = i % W;
      const y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) affected.add(ny * W + nx);
        }
      }
    }
    // Bit order N, NE, E, SE, S, SW, W, NW (cr31).
    const offsets: readonly (readonly [number, number])[] = [
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
    ];
    const writes: TerrainTileWrite[] = [];
    for (const i of [...affected].sort((a, b) => a - b)) {
      const isPainted = paintedSet.has(i);
      const info = this.#cellInfo(i);
      const m = member(i);
      if (!isPainted && info.kind !== "blob") continue; // empty / manual neighbours stay
      if (m <= 0) {
        if (info.kind !== "empty") writes.push(this.#write(i, null));
        continue;
      }
      const x = i % W;
      const y = (i - x) / W;
      let raw = 0;
      offsets.forEach(([dx, dy], bit) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || member(ny * W + nx) === m) raw |= 1 << bit;
      });
      const mask = reduceBlobMask(raw);
      if (info.kind === "blob" && info.terrainId === m && info.mask === mask) continue;
      const byMask = index.blob.get(m);
      if (!byMask || byMask.size === 0) continue; // the terrain has no tiles at all
      let tileIds = byMask.get(mask);
      if (!tileIds) {
        let bestDiff = Infinity;
        for (const [candidate, ids] of [...byMask].sort((a, b) => a[0] - b[0])) {
          const diff = popcount(candidate ^ mask);
          if (diff < bestDiff) {
            bestDiff = diff;
            tileIds = ids;
          }
        }
      }
      writes.push(this.#write(i, tileIds!));
    }
    return writes;
  }
}

function popcount(v: number): number {
  let c = 0;
  for (let x = v >>> 0; x !== 0; x &= x - 1) c++;
  return c;
}
