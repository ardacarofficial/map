/**
 * The tileset library as pure functions (unit tested): search filter,
 * groups (from `Tileset.group`, in library order, the ungrouped bucket
 * last), where a dragged tileset lands, the zoom each tileset shows at, and
 * the usage summary of the "remove tileset" question.
 */
import type { Tileset } from "@smap/core";

/** Group name of the ungrouped bucket ("Grupsuz"). */
export const UNGROUPED = "";

export function groupOf(tileset: Pick<Tileset, "group">): string {
  return tileset.group ?? UNGROUPED;
}

/** Case- and accent-insensitive key ("Çimen" ≈ "cimen", "İ" ≈ "i"). */
export function searchKey(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Tilesets whose name contains `query` (all of them for an empty query), in library order. */
export function filterTilesets<T extends Pick<Tileset, "name">>(tilesets: readonly T[], query: string): T[] {
  const q = searchKey(query);
  if (q === "") return [...tilesets];
  return tilesets.filter((ts) => searchKey(ts.name).includes(q));
}

/**
 * The best match for Enter in the search field: a name that starts with
 * the query wins over one that only contains it; otherwise the first.
 */
export function bestMatch<T extends Pick<Tileset, "name">>(tilesets: readonly T[], query: string): T | null {
  const matches = filterTilesets(tilesets, query);
  const q = searchKey(query);
  return matches.find((ts) => searchKey(ts.name).startsWith(q)) ?? matches[0] ?? null;
}

export interface TilesetGroup<T> {
  /** Group name; {@link UNGROUPED} for the "Grupsuz" bucket. */
  readonly name: string;
  readonly tilesets: readonly T[];
}

/**
 * Groups in library order (a group sits where its first tileset is), the
 * ungrouped bucket last. Empty groups do not exist (a group is only a name
 * on its tilesets).
 */
export function groupTilesets<T extends Pick<Tileset, "group">>(tilesets: readonly T[]): TilesetGroup<T>[] {
  const order: string[] = [];
  const byName = new Map<string, T[]>();
  for (const ts of tilesets) {
    const g = groupOf(ts);
    let list = byName.get(g);
    if (!list) {
      byName.set(g, (list = []));
      if (g !== UNGROUPED) order.push(g);
    }
    list.push(ts);
  }
  if (byName.has(UNGROUPED)) order.push(UNGROUPED);
  return order.map((name) => ({ name, tilesets: byName.get(name)! }));
}

/** Every group name in use, in library order (ungrouped left out). */
export function groupNames(tilesets: readonly Pick<Tileset, "group">[]): string[] {
  return groupTilesets(tilesets)
    .map((g) => g.name)
    .filter((g) => g !== UNGROUPED);
}

/** Where a dragged tileset is dropped: into `group`, before tileset `beforeId` (null = at the group's end). */
export interface DropTarget {
  readonly group: string;
  readonly beforeId: string | null;
}

export interface MovePlan {
  /** Index in `document.tilesets` the tileset ends up at (`moveTileset`). */
  readonly index: number;
  /** New group (`null` = ungrouped), or `undefined` when it stays. */
  readonly group: string | null | undefined;
}

/**
 * What dropping `dragId` on `target` does, or `null` when nothing changes.
 * The index follows the document order: right before `beforeId`, else right
 * after the group's last tileset (a group that has no other tileset: the
 * end, or before the ungrouped bucket so groups stay above it).
 */
export function planTilesetMove(tilesets: readonly Pick<Tileset, "id" | "group">[], dragId: string, target: DropTarget): MovePlan | null {
  const from = tilesets.findIndex((ts) => ts.id === dragId);
  if (from < 0 || target.beforeId === dragId) return null;
  const rest = tilesets.filter((ts) => ts.id !== dragId);
  let index: number;
  const before = target.beforeId === null ? -1 : rest.findIndex((ts) => ts.id === target.beforeId);
  if (before >= 0) {
    index = before;
  } else {
    let last = -1;
    rest.forEach((ts, i) => {
      if (groupOf(ts) === target.group) last = i;
    });
    if (last >= 0) index = last + 1;
    else if (target.group !== UNGROUPED) {
      const firstUngrouped = rest.findIndex((ts) => groupOf(ts) === UNGROUPED);
      index = firstUngrouped >= 0 ? firstUngrouped : rest.length;
    } else index = rest.length;
  }
  const oldGroup = groupOf(tilesets[from]!);
  const group = target.group === oldGroup ? undefined : target.group === UNGROUPED ? null : target.group;
  if (group === undefined) {
    // Same group: nothing to do when the library shows the same order afterwards.
    const after = [...rest];
    after.splice(index, 0, tilesets[from]!);
    const shown = (list: readonly Pick<Tileset, "id" | "group">[]) => groupTilesets(list).flatMap((g) => g.tilesets.map((ts) => ts.id)).join("\u0000");
    if (index === from || shown(after) === shown(tilesets)) return null;
  }
  return { index, group };
}

/** A unique group name for "Yeni grup" (`base`, `base 2`, …). */
export function uniqueGroupName(tilesets: readonly Pick<Tileset, "group">[], base: string): string {
  const used = new Set(groupNames(tilesets).map(searchKey));
  if (!used.has(searchKey(base))) return base;
  for (let n = 2; ; n++) if (!used.has(searchKey(`${base} ${n}`))) return `${base} ${n}`;
}

/** The zoom a tileset shows at: its own override, else the global zoom, else fit. */
export function effectiveZoom(override: number | null | undefined, global: number | null, fit: number): number {
  return override ?? global ?? fit;
}

/** `tilesetUsage` of one level (core). */
export interface LevelUsage {
  readonly cells: number;
  readonly layers: readonly string[];
  readonly terrains: number;
  readonly terrainCells: number;
}

export interface UsageSummary {
  /** Painted tile cells over all levels. */
  readonly cells: number;
  /** Terrain-grid cells that use its terrains. */
  readonly terrainCells: number;
  /** Its terrains. */
  readonly terrains: number;
  /** Levels with any painted cell. */
  readonly levels: number;
  readonly used: boolean;
}

/**
 * Usage of a tileset over every level. "Used" means painted somewhere
 * (tile or terrain cells): its terrains alone go with it unnoticed.
 */
export function summarizeUsage(perLevel: readonly LevelUsage[]): UsageSummary {
  let cells = 0;
  let terrainCells = 0;
  let terrains = 0;
  let levels = 0;
  for (const u of perLevel) {
    cells += u.cells;
    terrainCells += u.terrainCells;
    terrains = Math.max(terrains, u.terrains);
    if (u.cells + u.terrainCells > 0) levels++;
  }
  return { cells, terrainCells, terrains, levels, used: cells + terrainCells > 0 };
}
