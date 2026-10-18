/**
 * Saved random sets (round 4): a named list of candidates — single tiles or
 * whole stamps — that the random brush scatters over the map.
 *
 * Random sets are **project-level data**, like tilesets and entity types:
 * they are saved in `project.smap` (`randomSets`) and every open level's
 * {@link MapDocument} carries the same list (`document.randomSets`).
 * Changes go through the undoable `setRandomSet` / `removeRandomSet` ops of
 * the active level's store; the editor brings other levels in line the way
 * it does for entity types (`createDocument({ randomSets })` /
 * `parseLevel(…, { randomSets })` with the active document's list).
 *
 * Every choice is `hash(seed, x, y)` — never a sequential RNG — so the same
 * set, seed and cell always give the same result (repainting, undo/redo and
 * replays are stable), and a preview shows exactly what will be placed.
 */
import { CELL_FLAG_MASK, FLIP_H, FLIP_V } from "./cell";
import type { CellRect } from "./geometry";
import { stampIdProblem } from "./stamp";
import { cellHash } from "./hash";

/** A single tile candidate. `flags` are cell flip bits (`FLIP_H | FLIP_V | FLIP_D`), default 0. */
export interface RandomTileCandidate {
  readonly kind: "tile";
  readonly tilesetId: string;
  readonly tileId: number;
  readonly flags?: number;
  /** Relative chance, ≥ 0; defaults to 1. */
  readonly weight?: number;
}

/** A stamp candidate (`stamps/<stampId>.json`), placed with its top-left corner at the anchor cell. */
export interface RandomStampCandidate {
  readonly kind: "stamp";
  readonly stampId: string;
  /** Relative chance, ≥ 0; defaults to 1. */
  readonly weight?: number;
}

export type RandomCandidate = RandomTileCandidate | RandomStampCandidate;

/** A saved random set. */
export interface RandomSet {
  /** Unique within the project; any non-empty string (≤ 128 chars). */
  readonly id: string;
  readonly name: string;
  /** At least one; the weights must not all be 0. */
  readonly candidates: readonly RandomCandidate[];
  /**
   * Chance in `[0, 1]` that a cell (or chunk) is left alone (nothing
   * placed): 0 (default) fills every cell, 0.75 leaves about three in four
   * empty — sparse grass tufts, scattered rocks.
   */
  readonly scatter?: number;
  /**
   * Decide once per aligned block of `w` × `h` cells instead of per cell:
   * every cell of a block shares one pick (made at the block's top-left
   * cell, the anchor). Useful for stamp candidates and 2×2 tile groups.
   * Default 1 × 1.
   */
  readonly chunk?: { readonly w: number; readonly h: number };
  /** Also flip each pick randomly on X and / or Y (deterministic per anchor). Default false. */
  readonly randomFlip?: boolean;
}

/** Result of {@link pickRandomCandidate}. */
export interface RandomPick {
  readonly candidate: RandomCandidate;
  /**
   * Flip bits to apply: for a tile candidate its own `flags` combined
   * (XOR) with the random flip; for a stamp candidate only `FLIP_H` / `FLIP_V`
   * (= `placeStamp` `flip.x` / `flip.y`).
   */
  readonly flags: number;
  /** Anchor cell the pick was made for (the chunk's top-left cell, or the cell itself). */
  readonly anchorX: number;
  readonly anchorY: number;
}

/** Largest chunk side. */
export const MAX_RANDOM_CHUNK = 64;

const SALT_PICK = 0x9e3779b9; // same salt as `pickRandomTile`
const SALT_SCATTER = 0x7f4a7c15;
const SALT_FLIP = 0x2545f491;

/** Why `set` is not a valid random set, or `null`. */
export function randomSetProblem(set: RandomSet): string | null {
  if (typeof set !== "object" || set === null) return "random set must be an object";
  if (typeof set.id !== "string" || set.id.length === 0 || set.id.length > 128) return "random set id must be a non-empty string of at most 128 characters";
  if (typeof set.name !== "string") return `random set "${set.id}": name must be a string`;
  if (!Array.isArray(set.candidates) || set.candidates.length === 0) return `random set "${set.id}": needs at least one candidate`;
  let total = 0;
  for (const [i, c] of set.candidates.entries()) {
    const at = `random set "${set.id}" candidate ${i}`;
    if (typeof c !== "object" || c === null) return `${at}: must be an object`;
    const w = c.weight ?? 1;
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0) return `${at}: weight must be a finite number ≥ 0`;
    total += w;
    if (c.kind === "tile") {
      if (typeof c.tilesetId !== "string" || c.tilesetId.length === 0) return `${at}: tilesetId must be a non-empty string`;
      if (!Number.isInteger(c.tileId) || c.tileId < 0) return `${at}: tileId must be an integer ≥ 0`;
      const flags = c.flags ?? 0;
      if (!Number.isInteger(flags) || flags < 0 || (flags & ~CELL_FLAG_MASK) !== 0) return `${at}: flags may only hold flip bits`;
    } else if (c.kind === "stamp") {
      const problem = stampIdProblem(c.stampId);
      if (problem) return `${at}: ${problem}`;
    } else {
      return `${at}: kind must be "tile" or "stamp"`;
    }
  }
  if (total <= 0) return `random set "${set.id}": all weights are 0`;
  if (set.scatter !== undefined && (typeof set.scatter !== "number" || !(set.scatter >= 0 && set.scatter <= 1))) {
    return `random set "${set.id}": scatter must be a number in [0, 1]`;
  }
  if (set.chunk !== undefined) {
    const { w, h } = set.chunk ?? ({} as { w?: number; h?: number });
    const ok = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_RANDOM_CHUNK;
    if (!ok(w) || !ok(h)) return `random set "${set.id}": chunk w and h must be integers in [1, ${MAX_RANDOM_CHUNK}]`;
  }
  if (set.randomFlip !== undefined && typeof set.randomFlip !== "boolean") return `random set "${set.id}": randomFlip must be a boolean`;
  return null;
}

/** Problem with a whole list (each set valid, ids unique), or `null`. */
export function randomSetsProblem(sets: readonly RandomSet[]): string | null {
  const ids = new Set<string>();
  for (const set of sets) {
    const problem = randomSetProblem(set);
    if (problem) return problem;
    if (ids.has(set.id)) return `duplicate random set id "${set.id}"`;
    ids.add(set.id);
  }
  return null;
}

/**
 * Canonical frozen copy with a fixed key order; defaults are left out
 * (`flags` 0, `weight` 1, `scatter` 0, `chunk` 1 × 1, `randomFlip` false), so
 * equal sets serialize to equal bytes. Does not validate (see {@link randomSetProblem}).
 */
export function normalizeRandomSet(set: RandomSet): RandomSet {
  const candidates = set.candidates.map((c): RandomCandidate => {
    const weight = c.weight !== undefined && c.weight !== 1 ? { weight: c.weight } : {};
    if (c.kind === "stamp") return Object.freeze({ kind: "stamp", stampId: c.stampId, ...weight });
    const flags = (c.flags ?? 0) >>> 0;
    return Object.freeze({ kind: "tile", tilesetId: c.tilesetId, tileId: c.tileId, ...(flags !== 0 ? { flags } : {}), ...weight });
  });
  const chunk = set.chunk && (set.chunk.w !== 1 || set.chunk.h !== 1) ? { chunk: Object.freeze({ w: set.chunk.w, h: set.chunk.h }) } : {};
  return Object.freeze({
    id: set.id,
    name: set.name,
    candidates: Object.freeze(candidates),
    ...(set.scatter !== undefined && set.scatter !== 0 ? { scatter: set.scatter } : {}),
    ...chunk,
    ...(set.randomFlip ? { randomFlip: true } : {}),
  });
}

/**
 * The chunk (see {@link RandomSet.chunk}) containing cell (`x`, `y`): an
 * aligned `w` × `h` rectangle (negative coordinates included); `1 × 1` at
 * the cell itself when the set has no chunk.
 */
export function randomChunkAt(set: RandomSet, x: number, y: number): CellRect {
  const w = set.chunk?.w ?? 1;
  const h = set.chunk?.h ?? 1;
  return { x: Math.floor(x / w) * w, y: Math.floor(y / h) * h, width: w, height: h };
}

/**
 * What the random brush puts at cell (`x`, `y`), or `null` = leave the cell
 * alone (scatter). Deterministic in (`set`, `seed`, anchor cell): every cell
 * of one chunk gets the same answer. Weights pick the candidate; `scatter`
 * and `randomFlip` use independent hashes, so changing them never changes
 * which candidate a cell gets.
 * @throws RangeError when the set is invalid ({@link randomSetProblem}).
 */
export function pickRandomCandidate(set: RandomSet, seed: number, x: number, y: number): RandomPick | null {
  const problem = randomSetProblem(set);
  if (problem) throw new RangeError(`pickRandomCandidate: ${problem}`);
  const { x: ax, y: ay } = randomChunkAt(set, x, y);
  const s = seed >>> 0;
  const scatter = set.scatter ?? 0;
  if (scatter > 0 && cellHash((s ^ SALT_SCATTER) >>> 0, ax, ay) / 0x1_0000_0000 < scatter) return null;
  const candidate = weightedPick(set.candidates, cellHash((s ^ SALT_PICK) >>> 0, ax, ay));
  let flip = 0;
  if (set.randomFlip) {
    const h = cellHash((s ^ SALT_FLIP) >>> 0, ax, ay);
    flip = ((h & 1 ? FLIP_H : 0) | (h & 2 ? FLIP_V : 0)) >>> 0;
  }
  const flags = candidate.kind === "tile" ? ((candidate.flags ?? 0) ^ flip) >>> 0 : flip;
  return { candidate, flags, anchorX: ax, anchorY: ay };
}

function weightedPick(list: readonly RandomCandidate[], hash: number): RandomCandidate {
  if (list.length === 1) return list[0]!;
  let total = 0;
  for (const c of list) total += c.weight ?? 1;
  const r = (hash / 0x1_0000_0000) * total;
  let acc = 0;
  for (const c of list) {
    acc += c.weight ?? 1;
    if (r < acc && (c.weight ?? 1) > 0) return c;
  }
  for (let i = list.length - 1; i >= 0; i--) if ((list[i]!.weight ?? 1) > 0) return list[i]!;
  return list[list.length - 1]!;
}

/**
 * The sets with tile candidates of `tilesetId` remapped through `remap`
 * (`null` = the tile is gone → the candidate is dropped). A set left
 * without candidates (or with only zero weights) is removed. Returns the
 * input array itself when nothing changes. Used by `removeTileset` (every
 * tile gone) and tileset grid edits.
 */
export function remapRandomSetsForTileset(
  sets: readonly RandomSet[],
  tilesetId: string,
  remap: (tileId: number) => number | null,
): readonly RandomSet[] {
  let changed = false;
  const out: RandomSet[] = [];
  for (const set of sets) {
    let setChanged = false;
    const candidates: RandomCandidate[] = [];
    for (const c of set.candidates) {
      if (c.kind !== "tile" || c.tilesetId !== tilesetId) {
        candidates.push(c);
        continue;
      }
      const to = remap(c.tileId);
      if (to === c.tileId) {
        candidates.push(c);
        continue;
      }
      setChanged = true;
      if (to !== null) candidates.push({ ...c, tileId: to });
    }
    if (!setChanged) {
      out.push(set);
      continue;
    }
    changed = true;
    const next = normalizeRandomSet({ ...set, candidates });
    if (randomSetProblem(next) === null) out.push(next);
  }
  return changed ? out : sets;
}
