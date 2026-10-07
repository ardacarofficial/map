import { cellPaletteIndex, pickRandomTile } from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isRandomBrush, randomCellPicker, randomTileAt } from "./randomPaint";

const set = [
  { tilesetId: "ts", tileId: 1 },
  { tilesetId: "ts", tileId: 2 },
  { tilesetId: "ts", tileId: 3, weight: 2 },
];
const indexOf = (_ts: string, tileId: number) => tileId + 10;

describe("random brush", () => {
  it("needs two tiles", () => {
    expect(isRandomBrush(set.slice(0, 1))).toBe(false);
    expect(isRandomBrush(set.slice(0, 2))).toBe(true);
  });

  it("picks per cell exactly like core pickRandomTile (deterministic)", () => {
    const pick = randomCellPicker(set, 1234, indexOf)!;
    fc.assert(
      fc.property(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }), (x, y) => {
        const expected = pickRandomTile(set, 1234, x, y).tileId + 10;
        return cellPaletteIndex(pick(x, y)) === expected && pick(x, y) === randomCellPicker(set, 1234, indexOf)!(x, y);
      }),
    );
  });

  it("preview picks match painted picks", () => {
    const pick = randomCellPicker(set, 7, indexOf)!;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect(cellPaletteIndex(pick(x, y))).toBe(randomTileAt(set, 7, x, y)!.tileId + 10);
    }
  });

  it("uses every tile over an area, and only tiles of the set", () => {
    const pick = randomCellPicker(set, 99, indexOf)!;
    const seen = new Set<number>();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) seen.add(cellPaletteIndex(pick(x, y)));
    expect([...seen].sort()).toEqual([11, 12, 13]);
  });

  it("another seed gives another picture", () => {
    const a = randomCellPicker(set, 1, indexOf)!;
    const b = randomCellPicker(set, 2, indexOf)!;
    let diff = 0;
    for (let x = 0; x < 64; x++) if (a(x, 0) !== b(x, 0)) diff++;
    expect(diff).toBeGreaterThan(10);
  });

  it("skips unusable tiles (and preview skips the same ones)", () => {
    const only2 = (_ts: string, tileId: number) => (tileId === 2 ? 5 : 0);
    const pick = randomCellPicker(set, 3, only2)!;
    for (let x = 0; x < 20; x++) expect(cellPaletteIndex(pick(x, x))).toBe(5);
    expect(randomTileAt(set, 3, 4, 4, (t) => t.tileId === 2)?.tileId).toBe(2);
    expect(randomCellPicker(set, 3, () => 0)).toBeNull();
    expect(randomTileAt(set, 3, 0, 0, () => false)).toBeNull();
  });
});
