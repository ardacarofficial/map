/**
 * Random brush set editing (v0.6). Pure functions of the editor state so the
 * rules are testable; `toggleRandomTile` applies them to the store.
 *
 * Rules:
 * - Alt+click (or a click in "Rastgele" mode) toggles a tile in the set.
 * - The first toggle starts from the tile that is already selected, so
 *   "pick a tile, Alt+click another" gives a set of two.
 * - A set of fewer than two tiles is not a random brush: it collapses into
 *   a plain selection of the remaining tile (`randomSet` stays empty).
 * - Picking a tile normally clears the set (see the tileset panel).
 */
import { useEditorStore, type TileSelection } from "../state/editorStore";

export interface RandomTileEntry {
  tilesetId: string;
  tileId: number;
  weight?: number;
}

export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 9;

const same = (a: TileSelection, b: TileSelection) => a.tilesetId === b.tilesetId && a.tileId === b.tileId;

export function inRandomSet(set: readonly RandomTileEntry[], tile: TileSelection): boolean {
  return set.some((t) => same(t, tile));
}

/** Result of a toggle: the new set and the plain selection to keep. */
export interface RandomToggleResult {
  randomSet: RandomTileEntry[];
  selection: TileSelection | null;
}

/** Adds `tile` to the set, or removes it when it is in there (see module doc). */
export function toggleInSet(
  set: readonly RandomTileEntry[],
  selection: TileSelection | null,
  tile: TileSelection,
): RandomToggleResult {
  let next: RandomTileEntry[];
  if (set.length === 0) {
    // Start from the selected tile; toggling the selected tile itself does nothing useful.
    next = selection && !same(selection, tile) ? [{ ...selection }, { ...tile }] : [{ ...tile }];
  } else if (inRandomSet(set, tile)) {
    next = set.filter((t) => !same(t, tile));
  } else {
    next = [...set, { tilesetId: tile.tilesetId, tileId: tile.tileId }];
  }
  if (next.length < 2) {
    const only = next[0];
    return { randomSet: [], selection: only ? { tilesetId: only.tilesetId, tileId: only.tileId } : selection };
  }
  const first = next[0]!;
  return { randomSet: next, selection: { tilesetId: first.tilesetId, tileId: first.tileId } };
}

/** Changes one tile's weight by `delta`, clamped to [MIN_WEIGHT, MAX_WEIGHT]. Weight 1 is stored as "no weight". */
export function changeWeight(set: readonly RandomTileEntry[], tile: TileSelection, delta: number): RandomTileEntry[] {
  return set.map((t) => {
    if (!same(t, tile)) return t;
    const weight = Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, (t.weight ?? 1) + delta));
    return weight === 1 ? { tilesetId: t.tilesetId, tileId: t.tileId } : { ...t, weight };
  });
}

/** Chance of each tile in percent (rounded), in set order. */
export function randomChances(set: readonly RandomTileEntry[]): number[] {
  const total = set.reduce((sum, t) => sum + (t.weight ?? 1), 0);
  return set.map((t) => (total > 0 ? Math.round(((t.weight ?? 1) / total) * 100) : 0));
}

// ------------------------------------------------------------------ store actions

/** Toggles `tile` in the random set; makes the brush paint with it. */
export function toggleRandomTile(tile: TileSelection): void {
  const s = useEditorStore.getState();
  const result = toggleInSet(s.randomSet, s.selection, tile);
  s.setRandomSet(result.randomSet);
  s.setSelection(result.selection);
  s.setStamp(null);
  if (s.tool !== "brush" && s.tool !== "fill" && s.tool !== "rect") s.setTool("brush");
}

export function setRandomWeight(tile: TileSelection, delta: number): void {
  const s = useEditorStore.getState();
  s.setRandomSet(changeWeight(s.randomSet, tile, delta));
}

/** Removes one tile from the set (collapsing to a plain selection below two). */
export function removeRandomTile(tile: TileSelection): void {
  const s = useEditorStore.getState();
  if (!inRandomSet(s.randomSet, tile)) return;
  const result = toggleInSet(s.randomSet, s.selection, tile);
  s.setRandomSet(result.randomSet);
  s.setSelection(result.selection);
}

export function clearRandomSet(): void {
  useEditorStore.getState().setRandomSet([]);
}
