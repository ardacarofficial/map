/**
 * Random brush (v0.6): the user picks a few tiles and the brush puts one of
 * them in each cell. The choice is `hash(seed, x, y)` — never a sequential
 * RNG — so a cell always gets the same tile for the same set and seed
 * (repainting is stable, redo and replays give the same picture).
 */
import { cellHash } from "./terrain";

/** One candidate of a random brush. */
export interface RandomTile {
  readonly tilesetId: string;
  readonly tileId: number;
  /** Relative chance, ≥ 0; defaults to 1. */
  readonly weight?: number;
}

/** Salt so the brush is not correlated with terrain variant picks of the same seed. */
const SALT = 0x9e3779b9;

/**
 * The candidate for cell (`x`, `y`). Deterministic in (`set`, `seed`, `x`, `y`).
 * Pass the document seed (or any per-brush number) as `seed`.
 * @throws RangeError on an empty set, a negative / non-finite weight, or all weights 0.
 */
export function pickRandomTile<T extends RandomTile>(set: readonly T[], seed: number, x: number, y: number): T {
  if (set.length === 0) throw new RangeError("pickRandomTile: the set is empty");
  let total = 0;
  for (const t of set) {
    const w = t.weight ?? 1;
    if (!Number.isFinite(w) || w < 0) throw new RangeError(`pickRandomTile: weight must be a finite number ≥ 0, got ${w}`);
    total += w;
  }
  if (total <= 0) throw new RangeError("pickRandomTile: all weights are 0");
  if (set.length === 1) return set[0]!;
  const r = (cellHash((seed ^ SALT) >>> 0, x, y) / 0x1_0000_0000) * total;
  let acc = 0;
  for (const t of set) {
    acc += t.weight ?? 1;
    if (r < acc) return t;
  }
  // Rounding at the very top end: the last candidate with weight > 0.
  for (let i = set.length - 1; i >= 0; i--) if ((set[i]!.weight ?? 1) > 0) return set[i]!;
  return set[set.length - 1]!;
}
