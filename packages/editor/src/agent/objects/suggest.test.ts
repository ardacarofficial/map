import { describe, expect, it } from "vitest";
import type { RgbaImage, Stamp, Tileset } from "@smap/core";
import { suggestStampCandidates } from "./suggest";
import { pack, packPixels, stamps } from "./testing/objectScene";

/** Sheet from a picture of tiles: '.' empty, '#' fully opaque, 'o' art touching every edge (one transparent pixel
 * in the middle), 'c' art inset by one pixel (touches nothing). */
function sheet(rows: string[], t = 8): { tileset: Tileset; pixels: RgbaImage } {
  const columns = rows[0]!.length, width = columns * t, height = rows.length * t, data = new Uint8Array(width * height * 4);
  rows.forEach((row, ty) => [...row].forEach((ch, tx) => {
    for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
      const on = ch === "#" || (ch === "o" && !(x === t / 2 && y === t / 2)) || (ch === "c" && x > 0 && y > 0 && x < t - 1 && y < t - 1);
      if (on) data.set([120, 90, 60, 255], ((ty * t + y) * width + tx * t + x) * 4);
    }
  }));
  return { tileset: { id: "s", name: "S", imagePath: "tilesets/s.png", tileWidth: t, tileHeight: t, columns, rows: rows.length, margin: 0, spacing: 0 }, pixels: { width, height, data } };
}
const whole = (t: Tileset) => ({ x: 0, y: 0, width: t.columns, height: t.rows });

describe("stamp suggestions", () => {
  it("proposes the pack's multi-tile objects, skips opaque terrain and marks existing stamps", () => {
    const pixels = packPixels();
    const out = suggestStampCandidates({ tileset: pack, pixels, region: whole(pack), minTiles: 2, stamps });
    expect(out.candidates).toEqual([
      { n: 1, region: { x: 4, y: 1, width: 1, height: 2 }, tileIds: [12, 20], existingStampId: "torch" },
      { n: 2, region: { x: 5, y: 1, width: 2, height: 2 }, tileIds: [13, 14, 21, 22], existingStampId: "bigCrate" },
      { n: 3, region: { x: 7, y: 1, width: 1, height: 2 }, tileIds: [15, 23], existingStampId: "net" },
    ]);
    expect(out.skipped).toEqual({ tooLarge: 0, opaque: 1 });
    // Without stamps nothing is marked; minTiles 1 adds the single-tile objects; a region limits the search.
    const fresh = suggestStampCandidates({ tileset: pack, pixels, region: whole(pack), minTiles: 1 });
    expect(fresh.candidates.map(c => c.tileIds)).toEqual([[8], [9], [10], [11], [12, 20], [13, 14, 21, 22], [15, 23]]);
    expect(fresh.candidates.some(c => c.existingStampId)).toBe(false);
    const part = suggestStampCandidates({ tileset: pack, pixels, region: { x: 5, y: 0, width: 3, height: 4 }, minTiles: 2 });
    expect(part.candidates.map(c => [c.n, c.region])).toEqual([[1, { x: 5, y: 1, width: 2, height: 2 }], [2, { x: 7, y: 1, width: 1, height: 2 }]]);
  });

  it("joins tiles only where the art touches, reports foreign tiles inside a box and leaves out huge parts", () => {
    const { tileset, pixels } = sheet([
      "oo.c.oooooooooooooo",
      "co.c....o..........",
      "...cc..............",
      "##.................",
      "##.o...............",
    ]);
    const out = suggestStampCandidates({ tileset, pixels, region: whole(tileset), minTiles: 2 });
    // The L-shaped object's box contains one inset tile 'c' that belongs to nothing.
    expect(out.candidates).toEqual([{ n: 1, region: { x: 0, y: 0, width: 2, height: 2 }, tileIds: [0, 1, 20], otherTiles: 1 }]);
    // 14×2 strip: too large. 2×2 opaque block: terrain. Separate inset tiles never join.
    expect(out.skipped).toEqual({ tooLarge: 1, opaque: 1 });
  });

  it("matches a stamp that left the transparent tiles of its box empty, but not a flipped one", () => {
    const { tileset, pixels } = sheet(["oo", ".o"]);
    const stamp = (cells: number[], flags = 0): Stamp => ({ id: "l", name: "L", width: 2, height: 2, palette: [0, 1, 3].map(tileId => ({ tilesetId: "s", tileId })), layers: [{ layerId: "a", name: "A", cells: Uint32Array.from(cells, c => c ? (c | flags) >>> 0 : 0) }] });
    expect(suggestStampCandidates({ tileset, pixels, region: whole(tileset), minTiles: 2, stamps: [stamp([1, 2, 0, 3])] }).candidates[0]!.existingStampId).toBe("l");
    expect(suggestStampCandidates({ tileset, pixels, region: whole(tileset), minTiles: 2, stamps: [stamp([1, 2, 0, 3], 0x8000_0000)] }).candidates[0]!.existingStampId).toBeUndefined();
  });
});
