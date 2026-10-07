import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pickRandomTile } from "../src";

const SET = [
  { tilesetId: "grass", tileId: 0 },
  { tilesetId: "grass", tileId: 1 },
  { tilesetId: "grass", tileId: 2 },
  { tilesetId: "flowers", tileId: 7 },
];

describe("random brush", () => {
  it("is deterministic per (set, seed, cell), independent of call order", () => {
    fc.assert(
      fc.property(fc.nat(), fc.array(fc.tuple(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 })), { maxLength: 30 }), (seed, cells) => {
        const first = cells.map(([x, y]) => pickRandomTile(SET, seed, x, y));
        const again = [...cells].reverse().map(([x, y]) => pickRandomTile(SET, seed, x, y)).reverse();
        expect(again).toEqual(first);
      }),
    );
  });

  it("spreads roughly evenly and respects weights", () => {
    const counts = new Map<number, number>();
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
      const t = pickRandomTile(SET, 42, x, y);
      counts.set(t.tileId, (counts.get(t.tileId) ?? 0) + 1);
    }
    for (const t of SET) expect(counts.get(t.tileId)! / 10000).toBeGreaterThan(0.22);

    const weighted = [{ tilesetId: "a", tileId: 0, weight: 3 }, { tilesetId: "a", tileId: 1, weight: 1 }, { tilesetId: "a", tileId: 2, weight: 0 }];
    let heavy = 0;
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
      const t = pickRandomTile(weighted, 7, x, y);
      expect(t.tileId).not.toBe(2);
      if (t.tileId === 0) heavy++;
    }
    expect(heavy / 10000).toBeGreaterThan(0.72);
    expect(heavy / 10000).toBeLessThan(0.78);
  });

  it("different seeds give different pictures; bad sets throw", () => {
    const pic = (seed: number) => Array.from({ length: 64 }, (_, i) => pickRandomTile(SET, seed, i % 8, i >> 3).tileId).join();
    expect(pic(1)).not.toBe(pic(2));
    expect(pickRandomTile([SET[0]!], 9, 3, 3)).toBe(SET[0]);
    expect(() => pickRandomTile([], 0, 0, 0)).toThrow(/empty/);
    expect(() => pickRandomTile([{ tilesetId: "a", tileId: 0, weight: -1 }], 0, 0, 0)).toThrow(/weight/);
    expect(() => pickRandomTile([{ tilesetId: "a", tileId: 0, weight: 0 }, { tilesetId: "a", tileId: 1, weight: 0 }], 0, 0, 0)).toThrow(/0/);
  });
});
