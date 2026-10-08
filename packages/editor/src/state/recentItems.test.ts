import { FLIP_H, type TileClip } from "@smap/core";
import { describe, expect, it } from "vitest";

import { clipKey, isRecentStamp, MAX_RECENT, pushRecent, recentKey, recentOfClip, type RecentItem } from "./recentItems";


function clip(cells: number[], width = cells.length, extra: Partial<TileClip> = {}): TileClip {
  return {
    width,
    height: cells.length / width,
    palette: [
      { tilesetId: "ts", tileId: 5 },
      { tilesetId: "ts", tileId: 9 },
    ],
    layers: [{ layerId: "l1", name: "Zemin", cells: Uint32Array.from(cells) }],
    ...extra,
  } as TileClip;
}

describe("recent items", () => {
  it("dedupes, moves to the front and caps tiles and stamps together", () => {
    let list: RecentItem[] = [];
    for (let i = 0; i < 30; i++) list = pushRecent(list, { tilesetId: "ts", tileId: i });
    expect(list).toHaveLength(MAX_RECENT);
    const stamp = recentOfClip(clip([1, 2]))!;
    list = pushRecent(list, stamp);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe(stamp);
    list = pushRecent(list, { tilesetId: "ts", tileId: 20 });
    expect(list[0]).toEqual({ tilesetId: "ts", tileId: 20 });
    expect(list.filter((i) => recentKey(i) === "t:ts:20")).toHaveLength(1);
    // The same stamp content (another object) is one entry.
    list = pushRecent(list, recentOfClip(clip([1, 2]))!);
    expect(list.filter(isRecentStamp)).toHaveLength(1);
  });

  it("a clip of one plain tile is a tile entry; anything else a stamp", () => {
    expect(recentOfClip(clip([0, 2, 0], 3))).toEqual({ tilesetId: "ts", tileId: 9 });
    expect(isRecentStamp(recentOfClip(clip([1, 2]))!)).toBe(true);
    // A flipped single tile keeps its flip: a stamp entry.
    expect(isRecentStamp(recentOfClip(clip([(1 | FLIP_H) >>> 0]))!)).toBe(true);
    expect(recentOfClip(clip([0, 0]))).toBeNull();
  });

  it("keys differ when the cells differ", () => {
    expect(clipKey(clip([1, 2]))).not.toBe(clipKey(clip([2, 1])));
    expect(clipKey(clip([1, 2]))).toBe(clipKey(clip([1, 2])));
    expect(clipKey(clip([1, 2], 2))).not.toBe(clipKey(clip([1, 2], 1)));
  });
});
