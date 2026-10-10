/**
 * Random brush. Pure functions of the editor state so the rules are
 * testable; the store actions below apply them.
 *
 * Where a random brush comes from (round 4 — there is no "Rastgele" mode
 * in the tileset any more):
 * - Select a block in the tileset / a palette, then "Rastgele yap" on the
 *   brush card ({@link makeRandomFromStamp}): every non-empty tile of the
 *   selection becomes a candidate.
 * - Alt + drag a rectangle in the tileset ({@link addTilesToRandom}); a
 *   plain Alt + click toggles one tile ({@link toggleRandomTile}).
 * - A saved set (core `RandomSet`, project data): {@link loadRandomSet}.
 * - "Rastgele sete ekle" on a stamp ({@link addStampToRandomSet}).
 *
 * The tile candidates live in the editor store (`randomSet`, what the
 * canvas paints with); stamp candidates, scatter, random flip and the
 * loaded saved set live in {@link useRandomBrush}. {@link currentRandomSet}
 * combines both into one core `RandomSet` (for `pickRandomCandidate`).
 *
 * Rules kept from v0.6:
 * - The first Alt + click starts from the tile that is already selected,
 *   so "pick a tile, Alt+click another" gives a set of two.
 * - A brush of fewer than two candidates is not a random brush: it
 *   collapses into a plain selection of the remaining tile.
 * - Picking a tile normally clears the set (see the tileset panel).
 */
import {
  cellPaletteIndex,
  normalizeRandomSet,
  randomSetProblem,
  type RandomCandidate,
  type RandomSet,
  type RandomStampCandidate,
  type TileClip,
} from "@smap/core";
import { create } from "zustand";

import { t } from "../i18n";
import { useEditorStore, type TileSelection } from "../state/editorStore";
import { toast } from "../ui/toast/toastStore";

export interface RandomTileEntry {
  tilesetId: string;
  tileId: number;
  weight?: number;
  /** Flip bits (the brush was mirrored / turned); omitted when 0. */
  flags?: number;
}

/** `t` with weight `w` (1 = no weight stored), other fields kept. */
function withWeight<T extends { weight?: number }>(t: T, w: number): T {
  const { weight: _old, ...rest } = t;
  return (w === 1 ? rest : { ...rest, weight: w }) as T;
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
  return collapse(next, selection);
}

/** A set below two tiles is a plain selection (see module doc). */
function collapse(next: RandomTileEntry[], selection: TileSelection | null): RandomToggleResult {
  if (next.length < 2) {
    const only = next[0];
    return { randomSet: [], selection: only ? { tilesetId: only.tilesetId, tileId: only.tileId } : selection };
  }
  const first = next[0]!;
  return { randomSet: next, selection: { tilesetId: first.tilesetId, tileId: first.tileId } };
}

/**
 * Adds every tile of `tiles` that is not in the set yet (Alt + drag a
 * rectangle). Nothing is removed. An empty set starts from `tiles` alone
 * (the rectangle is the whole intent, unlike a single Alt + click).
 */
export function addToSet(set: readonly RandomTileEntry[], selection: TileSelection | null, tiles: readonly RandomTileEntry[]): RandomToggleResult {
  const next: RandomTileEntry[] = set.map((t) => ({ ...t }));
  for (const tile of tiles) {
    if (!inRandomSet(next, tile)) next.push({ tilesetId: tile.tilesetId, tileId: tile.tileId, ...(tile.flags ? { flags: tile.flags } : {}) });
  }
  return collapse(next, selection);
}

/**
 * The tile candidates of a stamp / multi-tile selection: every non-empty
 * cell of its tile layers, once per distinct tile, in reading order
 * (flip flags are not kept: a random tile is placed unflipped, or flipped
 * by the set's random flip). Grid layers (collision) are ignored.
 */
export function candidatesFromClip(clip: TileClip): RandomTileEntry[] {
  const out: RandomTileEntry[] = [];
  const seen = new Set<string>();
  for (const layer of clip.layers) {
    if (layer.grid) continue;
    for (const cell of layer.cells) {
      const index = cellPaletteIndex(cell);
      if (index === 0) continue;
      const entry = clip.palette[index - 1];
      if (!entry) continue;
      const key = `${entry.tilesetId}\u0000${entry.tileId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tilesetId: entry.tilesetId, tileId: entry.tileId });
    }
  }
  return out;
}

/** Changes one tile's weight by `delta`, clamped to [MIN_WEIGHT, MAX_WEIGHT]. Weight 1 is stored as "no weight". */
export function changeWeight(set: readonly RandomTileEntry[], tile: TileSelection, delta: number): RandomTileEntry[] {
  return set.map((t) => {
    if (!same(t, tile)) return t;
    return withWeight(t, Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, (t.weight ?? 1) + delta)));
  });
}

/** Chance of each tile in percent (rounded), in set order. */
export function randomChances(set: readonly { readonly weight?: number; readonly tilesetId?: string; readonly stampId?: string }[]): number[] {
  const total = set.reduce((sum, t) => sum + (t.weight ?? 1), 0);
  return set.map((t) => (total > 0 ? Math.round(((t.weight ?? 1) / total) * 100) : 0));
}

// ------------------------------------------------------------------ brush options (stamps, scatter, flip)

export interface RandomBrushOptions {
  /** Stamp candidates of the current random brush (tile candidates are the editor store's `randomSet`). */
  stamps: readonly RandomStampCandidate[];
  /** Chance in [0, 1] that a cell is left alone. */
  scatter: number;
  randomFlip: boolean;
  /** Decide per `w` × `h` block (1 × 1 = per cell). */
  chunk: { w: number; h: number };
  /** The saved set this brush was loaded from / saved as (null = unsaved). */
  activeSetId: string | null;
}

const DEFAULT_OPTIONS: RandomBrushOptions = { stamps: [], scatter: 0, randomFlip: false, chunk: { w: 1, h: 1 }, activeSetId: null };

export const useRandomBrush = create<RandomBrushOptions>()(() => ({ ...DEFAULT_OPTIONS }));

/** Candidates of a brush: tiles plus stamps. */
export function brushCandidates(tiles: readonly RandomTileEntry[], options: Pick<RandomBrushOptions, "stamps">): RandomCandidate[] {
  return [
    ...tiles.map(
      (t): RandomCandidate => ({
        kind: "tile",
        tilesetId: t.tilesetId,
        tileId: t.tileId,
        ...(t.flags ? { flags: t.flags } : {}),
        ...(t.weight !== undefined && t.weight !== 1 ? { weight: t.weight } : {}),
      }),
    ),
    ...options.stamps,
  ];
}

/**
 * The brush as one core `RandomSet` (id = the loaded set's, or `"brush"`),
 * or null when it has fewer than two candidates and no scatter (then it is
 * not a random brush). A single candidate with scatter > 0 is a valid
 * "sprinkle" brush.
 */
export function randomSetOf(tiles: readonly RandomTileEntry[], options: RandomBrushOptions, name = ""): RandomSet | null {
  const candidates = brushCandidates(tiles, options);
  if (candidates.length === 0) return null;
  if (candidates.length < 2 && options.scatter <= 0) return null;
  const set = normalizeRandomSet({
    id: options.activeSetId ?? "brush",
    name,
    candidates,
    scatter: options.scatter,
    chunk: options.chunk,
    randomFlip: options.randomFlip,
  });
  return randomSetProblem(set) === null ? set : null;
}

/** The current random brush as a core `RandomSet` (for `pickRandomCandidate`), or null. */
export function currentRandomSet(): RandomSet | null {
  return randomSetOf(useEditorStore.getState().randomSet, useRandomBrush.getState());
}

/** Number of candidates of the current random brush (tiles + stamps). */
export function randomCandidateCount(): number {
  return useEditorStore.getState().randomSet.length + useRandomBrush.getState().stamps.length;
}

/** A saved set's tile candidates as the editor store's `randomSet` list, and its brush options. */
export function brushFromSet(set: RandomSet): { tiles: RandomTileEntry[]; options: RandomBrushOptions } {
  const tiles: RandomTileEntry[] = [];
  const stamps: RandomStampCandidate[] = [];
  for (const c of set.candidates) {
    if (c.kind === "stamp") stamps.push(c);
    else {
      tiles.push({
        tilesetId: c.tilesetId,
        tileId: c.tileId,
        ...(c.weight !== undefined && c.weight !== 1 ? { weight: c.weight } : {}),
        ...(c.flags ? { flags: c.flags } : {}),
      });
    }
  }
  return {
    tiles,
    options: {
      stamps,
      scatter: set.scatter ?? 0,
      randomFlip: set.randomFlip ?? false,
      chunk: { w: set.chunk?.w ?? 1, h: set.chunk?.h ?? 1 },
      activeSetId: set.id,
    },
  };
}

/** A random set id not used yet ("random-1", …). */
export function uniqueRandomSetId(sets: readonly Pick<RandomSet, "id">[]): string {
  const taken = new Set(sets.map((s) => s.id));
  for (let n = 1; ; n++) if (!taken.has(`random-${n}`)) return `random-${n}`;
}

// ------------------------------------------------------------------ store actions

/** True while one of the actions below writes the editor's `randomSet` (so the reset watcher keeps the options). */
let writing = false;

function applyTiles(result: RandomToggleResult, keepStamp = false): void {
  const s = useEditorStore.getState();
  writing = true;
  try {
    s.setRandomSet(result.randomSet);
    s.setSelection(result.selection);
    if (!keepStamp) s.setStamp(null);
  } finally {
    writing = false;
  }
  if (s.tool !== "brush" && s.tool !== "fill" && s.tool !== "rect") s.setTool("brush");
}

// Picking a tile, a stamp, a recent item… clears the editor's random set: the stamp candidates and options go with it.
useEditorStore.subscribe((state, prev) => {
  if (writing || state.randomSet === prev.randomSet || state.randomSet.length > 0) return;
  const o = useRandomBrush.getState();
  if (o.stamps.length > 0 || o.activeSetId !== null || o.scatter !== 0 || o.randomFlip) useRandomBrush.setState({ ...DEFAULT_OPTIONS });
});

/** Toggles `tile` in the random set; makes the brush paint with it. */
export function toggleRandomTile(tile: TileSelection): void {
  const s = useEditorStore.getState();
  applyTiles(toggleInSet(s.randomSet, s.selection, tile));
}

/** Alt + drag: adds `tiles` to the random brush (see {@link addToSet}). */
export function addTilesToRandom(tiles: readonly RandomTileEntry[]): void {
  if (tiles.length === 0) return;
  const s = useEditorStore.getState();
  applyTiles(addToSet(s.randomSet, s.selection, tiles));
}

/**
 * "Rastgele yap" on the brush card: the current multi-tile selection
 * (the brush stamp) becomes a random brush, each non-empty tile one
 * candidate. Returns false (with a hint) when the stamp has fewer than two
 * distinct tiles or there is no stamp.
 */
export function makeRandomFromStamp(): boolean {
  const s = useEditorStore.getState();
  const tiles = s.stamp ? candidatesFromClip(s.stamp) : [];
  if (tiles.length < 2) {
    toast.info(t("randomSets.needTwo"));
    return false;
  }
  useRandomBrush.setState({ ...DEFAULT_OPTIONS });
  applyTiles({ randomSet: tiles, selection: { tilesetId: tiles[0]!.tilesetId, tileId: tiles[0]!.tileId } });
  return true;
}

export function setRandomWeight(tile: TileSelection, delta: number): void {
  const s = useEditorStore.getState();
  writing = true;
  try {
    s.setRandomSet(changeWeight(s.randomSet, tile, delta));
  } finally {
    writing = false;
  }
}

/** Removes one tile from the set (collapsing to a plain selection below two). */
export function removeRandomTile(tile: TileSelection): void {
  const s = useEditorStore.getState();
  if (!inRandomSet(s.randomSet, tile)) return;
  const keepStamps = useRandomBrush.getState().stamps.length > 0;
  if (keepStamps) {
    // Stamps still make it a random brush: just drop the tile.
    writing = true;
    try {
      s.setRandomSet(s.randomSet.filter((t) => !same(t, tile)));
    } finally {
      writing = false;
    }
    return;
  }
  applyTiles(toggleInSet(s.randomSet, s.selection, tile), true);
}

export function clearRandomSet(): void {
  useRandomBrush.setState({ ...DEFAULT_OPTIONS });
  useEditorStore.getState().setRandomSet([]);
}

/** "Rastgele sete ekle" (stamp context menu): adds a stamp candidate to the current random brush. */
export function addStampToRandomSet(stampId: string): void {
  const o = useRandomBrush.getState();
  if (o.stamps.some((c) => c.stampId === stampId)) return;
  useRandomBrush.setState({ stamps: [...o.stamps, { kind: "stamp", stampId }] });
  const s = useEditorStore.getState();
  // The brush stamp (if any) is replaced by the random brush.
  if (s.stamp) s.setStamp(null);
  if (s.tool !== "brush" && s.tool !== "fill" && s.tool !== "rect") s.setTool("brush");
  toast.success(t("randomSets.stampAdded", { count: randomCandidateCount() }));
}

export function removeRandomStamp(stampId: string): void {
  const o = useRandomBrush.getState();
  useRandomBrush.setState({ stamps: o.stamps.filter((c) => c.stampId !== stampId) });
}

export function setRandomStampWeight(stampId: string, delta: number): void {
  const o = useRandomBrush.getState();
  useRandomBrush.setState({
    stamps: o.stamps.map((c) => {
      if (c.stampId !== stampId) return c;
      return withWeight(c, Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, (c.weight ?? 1) + delta)));
    }),
  });
}

/** Scatter in percent (0–95; 100 would place nothing). */
export function setRandomScatter(percent: number): void {
  const p = Math.min(95, Math.max(0, Math.round(percent)));
  useRandomBrush.setState({ scatter: p / 100 });
}

export function setRandomFlip(on: boolean): void {
  useRandomBrush.setState({ randomFlip: on });
}

// ------------------------------------------------------------------ saved sets (core RandomSet, project data)

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

const activeStore = () => useEditorStore.getState().project?.store ?? null;

/** Saved random sets of the project. */
export function savedRandomSets(): readonly RandomSet[] {
  return activeStore()?.document.randomSets ?? [];
}

function dispatchSafe(run: () => void): boolean {
  const store = activeStore();
  if (!store || store.inTransaction) return false;
  try {
    run();
  } catch (error) {
    console.error(error);
    toast.error(t("randomSets.failed", { detail: describeError(error) }));
    return false;
  }
  if (!useEditorStore.getState().dirty) useEditorStore.getState().setDirty(true);
  return true;
}

/**
 * Saves the current random brush as a named set (undoable). With the
 * brush loaded from a saved set and no `name`, that set is updated.
 * Returns the set's id, or null.
 */
export function saveRandomSet(name?: string): string | null {
  const store = activeStore();
  if (!store) return null;
  const o = useRandomBrush.getState();
  const existing = o.activeSetId ? store.document.getRandomSet(o.activeSetId) : undefined;
  const id = existing && name === undefined ? existing.id : uniqueRandomSetId(store.document.randomSets);
  const setName = (name ?? existing?.name ?? t("randomSets.defaultName")).trim() || t("randomSets.defaultName");
  const set = randomSetOf(useEditorStore.getState().randomSet, { ...o, activeSetId: id }, setName);
  if (!set) {
    toast.info(t("randomSets.needTwo"));
    return null;
  }
  if (!dispatchSafe(() => store.dispatch({ type: "setRandomSet", set }))) return null;
  useRandomBrush.setState({ activeSetId: id });
  return id;
}

/** Makes saved set `id` the brush. */
export function loadRandomSet(id: string): boolean {
  const set = activeStore()?.document.getRandomSet(id);
  if (!set) return false;
  const { tiles, options } = brushFromSet(set);
  const s = useEditorStore.getState();
  writing = true;
  try {
    useRandomBrush.setState(options);
    s.setRandomSet(tiles);
    const first = tiles[0];
    if (first) s.setSelection({ tilesetId: first.tilesetId, tileId: first.tileId });
    s.setStamp(null);
  } finally {
    writing = false;
  }
  if (s.tool !== "brush" && s.tool !== "fill" && s.tool !== "rect") s.setTool("brush");
  return true;
}

export function renameRandomSet(id: string, name: string): boolean {
  const store = activeStore();
  const set = store?.document.getRandomSet(id);
  const trimmed = name.trim();
  if (!store || !set || trimmed === "" || trimmed === set.name) return false;
  return dispatchSafe(() => store.dispatch({ type: "setRandomSet", set: { ...set, name: trimmed } }));
}

export function deleteRandomSet(id: string): boolean {
  const store = activeStore();
  if (!store?.document.getRandomSet(id)) return false;
  const ok = dispatchSafe(() => store.dispatch({ type: "removeRandomSet", id }));
  if (ok && useRandomBrush.getState().activeSetId === id) useRandomBrush.setState({ activeSetId: null });
  return ok;
}
