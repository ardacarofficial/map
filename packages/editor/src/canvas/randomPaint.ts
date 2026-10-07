/**
 * Random brush (v0.6) as the paint tools use it: one tile of the set per
 * cell, chosen by core `pickRandomTile(set, seed, x, y)`. Deterministic, so
 * previews show exactly what a click will paint and repainting is stable.
 * Pure: unit tested.
 */
import { makeCell, pickRandomTile, type RandomTile } from "@smap/core";

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
    if (index > 0) usable.push({ tile, cell: makeCell(index) });
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
