/**
 * Random brush (v0.6) as the paint tools use it: one tile of the set per
 * cell, chosen by core `pickRandomTile(set, seed, x, y)`. Deterministic, so
 * previews show exactly what a click will paint and repainting is stable.
 * Pure: unit tested.
 */
import {
  FLIP_H,
  FLIP_V,
  makeCell,
  pickRandomCandidate,
  pickRandomTile,
  type CellPoint,
  type RandomCandidate,
  type RandomSet,
  type RandomTile,
} from "@smap/core";

/**
 * A candidate may carry flip bits (FLIP_H / FLIP_V / FLIP_D: the brush was
 * mirrored or turned with X / Y / Z); without them it paints unflipped.
 */
export type OrientedRandomTile = RandomTile & { readonly flags?: number };

/** Flip bits of a random brush candidate (0 when it has none). */
export function randomTileFlags(tile: RandomTile): number {
  const flags = (tile as OrientedRandomTile).flags;
  return typeof flags === "number" ? flags >>> 0 : 0;
}

/** Cache key of a random set (tiles, weights and orientation). */
export function randomSetKey(set: readonly RandomTile[]): string {
  return set.map((t) => `${t.tilesetId}/${t.tileId}*${t.weight ?? 1}~${randomTileFlags(t)}`).join(",");
}

/** A random brush applies only with at least two tiles. */
export function isRandomBrush(set: readonly RandomTile[]): boolean {
  return set.length >= 2;
}

/**
 * Cell writer for `set`: `(x, y) → cell`. `indexOf` resolves a tile to its
 * palette index (adding it when needed; call inside the transaction) and
 * returns 0 when the tile cannot be painted (missing tileset); such tiles
 * are left out of the set. Returns null when nothing in the set is usable.
 */
export function randomCellPicker(
  set: readonly RandomTile[],
  seed: number,
  indexOf: (tilesetId: string, tileId: number) => number,
): ((x: number, y: number) => number) | null {
  const usable: { tile: RandomTile; cell: number }[] = [];
  for (const tile of set) {
    if ((tile.weight ?? 1) <= 0) continue;
    const index = indexOf(tile.tilesetId, tile.tileId);
    if (index > 0) usable.push({ tile, cell: makeCell(index, randomTileFlags(tile)) });
  }
  if (usable.length === 0) return null;
  const candidates = usable.map((u) => ({
    tilesetId: u.tile.tilesetId,
    tileId: u.tile.tileId,
    ...(u.tile.weight !== undefined ? { weight: u.tile.weight } : {}),
    cell: u.cell,
  }));
  return (x, y) => pickRandomTile(candidates, seed, x, y).cell;
}

/**
 * The tile `set` puts at (x, y) (previews, no palette needed). `ok` must
 * reject the same tiles `indexOf` rejects in {@link randomCellPicker}.
 */
export function randomTileAt<T extends RandomTile>(
  set: readonly T[],
  seed: number,
  x: number,
  y: number,
  ok: (tile: T) => boolean = () => true,
): T | null {
  const usable = set.filter((t) => (t.weight ?? 1) > 0 && ok(t));
  return usable.length > 0 ? pickRandomTile(usable, seed, x, y) : null;
}

// ------------------------------------------------------------------ round 4: core RandomSet (tile + stamp candidates)

/** Where a stamp candidate goes: its top-left at the pick's anchor, flipped by the random flip. */
export interface RandomStampPlacement {
  readonly stampId: string;
  readonly x: number;
  readonly y: number;
  readonly flip: { readonly x: boolean; readonly y: boolean };
}

/** A tile candidate's write at one cell (flags = its own flip bits XOR the random flip). */
export interface RandomTilePlacement {
  readonly x: number;
  readonly y: number;
  readonly tilesetId: string;
  readonly tileId: number;
  readonly flags: number;
}

/** What a random brush puts on a set of cells. */
export interface RandomPaintPlan {
  readonly tiles: RandomTilePlacement[];
  readonly stamps: RandomStampPlacement[];
}

/**
 * `set` without the candidates `ok` rejects (missing tileset, missing
 * stamp…), or null when none is left. Returns `set` itself when all are
 * usable. Paint and preview must filter with the same `ok` so they agree.
 */
export function usableRandomSet(set: RandomSet, ok: (candidate: RandomCandidate) => boolean): RandomSet | null {
  const candidates = set.candidates.filter(ok);
  if (candidates.length === set.candidates.length) return set;
  if (!candidates.some((c) => (c.weight ?? 1) > 0)) return null;
  return { ...set, candidates };
}

/**
 * The random brush's decisions over `cells` (core `pickRandomCandidate`
 * with `seed`, so deterministic per anchor):
 * - a tile candidate writes its tile at the cell;
 * - a stamp candidate is placed once per anchor (the chunk's top-left
 *   cell), however many of the chunk's cells are covered; `placed` holds
 *   the anchors ("x,y") already placed — pass the same set for every call
 *   of one stroke so a stamp is not placed twice;
 * - scatter → nothing (the cell is left as it is).
 */
export function planRandomPaint(set: RandomSet, seed: number, cells: Iterable<CellPoint>, placed: Set<string> = new Set()): RandomPaintPlan {
  const tiles: RandomTilePlacement[] = [];
  const stamps: RandomStampPlacement[] = [];
  for (const { x, y } of cells) {
    const pick = pickRandomCandidate(set, seed, x, y);
    if (!pick) continue;
    const c = pick.candidate;
    if (c.kind === "tile") {
      tiles.push({ x, y, tilesetId: c.tilesetId, tileId: c.tileId, flags: pick.flags });
      continue;
    }
    const key = `${pick.anchorX},${pick.anchorY}`;
    if (placed.has(key)) continue;
    placed.add(key);
    stamps.push({ stampId: c.stampId, x: pick.anchorX, y: pick.anchorY, flip: { x: (pick.flags & FLIP_H) !== 0, y: (pick.flags & FLIP_V) !== 0 } });
  }
  return { tiles, stamps };
}

/** Cache key of a core random set + seed (previews). */
export function randomPlanKey(set: RandomSet, seed: number): string {
  return `${seed >>> 0}:${JSON.stringify(set)}`;
}
