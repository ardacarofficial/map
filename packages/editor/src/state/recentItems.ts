/**
 * The "Son kullanılanlar" strip's list, as pure functions (unit tested):
 * single tiles and multi-tile stamps, newest first, deduplicated, capped.
 */
import { cellFlags, cellPaletteIndex, type TileClip } from "@smap/core";

/** Most items the strip keeps (tiles and stamps together). */
export const MAX_RECENT = 24;

export interface RecentTile {
  readonly tilesetId: string;
  readonly tileId: number;
}

export interface RecentStamp {
  readonly stamp: TileClip;
  /** Content key: the same stamp used twice is one entry. */
  readonly key: string;
}

export type RecentItem = RecentTile | RecentStamp;

export function isRecentStamp(item: RecentItem): item is RecentStamp {
  return "stamp" in item;
}

/** Identity of an entry (React key, dedupe). */
export function recentKey(item: RecentItem): string {
  return isRecentStamp(item) ? `s:${item.key}` : `t:${item.tilesetId}:${item.tileId}`;
}

/** Content key of a clip: size, palette, layer ids and a hash of the cells (cheap even for big clips). */
export function clipKey(clip: TileClip): string {
  let h = 0x811c9dc5;
  for (const layer of clip.layers) {
    for (let i = 0; i < layer.cells.length; i++) {
      h ^= layer.cells[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const palette = clip.palette.map((p) => `${p.tilesetId}#${p.tileId}`).join(",");
  const layers = clip.layers.map((l) => `${l.layerId}${l.grid ? "*" : ""}`).join(",");
  return `${clip.width}x${clip.height}|${palette}|${layers}|${h.toString(36)}`;
}

/**
 * What using `clip` adds to the strip: a single plain tile is a tile entry
 * (the same as painting it), anything else a stamp entry. Null when the clip
 * holds no tile at all (only grid layers / empty).
 */
export function recentOfClip(clip: TileClip): RecentItem | null {
  let tiles = 0;
  let only: number | null = null;
  for (const layer of clip.layers) {
    if (layer.grid) continue;
    for (let i = 0; i < layer.cells.length; i++) {
      const cell = layer.cells[i]!;
      if (cell === 0) continue;
      tiles++;
      only = cell;
    }
  }
  if (tiles === 0) return null;
  const hasGrid = clip.layers.some((l) => l.grid);
  if (tiles === 1 && only !== null && cellFlags(only) === 0 && !hasGrid) {
    const entry = clip.palette[cellPaletteIndex(only) - 1];
    if (entry) return { tilesetId: entry.tilesetId, tileId: entry.tileId };
  }
  return { stamp: clip, key: clipKey(clip) };
}

/** `item` moved to the front (deduplicated), at most `max` entries. */
export function pushRecent(list: readonly RecentItem[], item: RecentItem, max = MAX_RECENT): RecentItem[] {
  const key = recentKey(item);
  return [item, ...list.filter((other) => recentKey(other) !== key)].slice(0, max);
}
