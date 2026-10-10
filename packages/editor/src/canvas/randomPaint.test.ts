import { FLIP_D, FLIP_H, FLIP_V, cellPaletteIndex, pickRandomCandidate, pickRandomTile, type RandomSet } from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isRandomBrush, planRandomPaint, randomCellPicker, randomPlanKey, randomTileAt, usableRandomSet } from "./randomPaint";

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

describe("random brush with a core RandomSet (round 4)", () => {
  const grass = { kind: "tile", tilesetId: "ts", tileId: 1 } as const;
  const flower = { kind: "tile", tilesetId: "ts", tileId: 2, flags: FLIP_D } as const;
  const tree = { kind: "stamp", stampId: "tree" } as const;
  const area = (x0: number, y0: number, w: number, h: number) => {
    const out: { x: number; y: number }[] = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push({ x, y });
    return out;
  };

  it("tile candidates: one write per cell, exactly core pickRandomCandidate (flags incl. random flip)", () => {
    const set: RandomSet = { id: "s", name: "", candidates: [grass, flower], randomFlip: true };
    const plan = planRandomPaint(set, 42, area(0, 0, 12, 12));
    expect(plan.stamps).toEqual([]);
    expect(plan.tiles).toHaveLength(144);
    for (const t of plan.tiles) {
      const pick = pickRandomCandidate(set, 42, t.x, t.y)!;
      expect(pick.candidate.kind).toBe("tile");
      expect(t.tileId).toBe((pick.candidate as typeof grass).tileId);
      expect(t.flags).toBe(pick.flags);
    }
    // Random flip actually flips some, and the candidate's own FLIP_D stays.
    expect(plan.tiles.some((t) => (t.flags & (FLIP_H | FLIP_V)) !== 0)).toBe(true);
    for (const t of plan.tiles) if (t.tileId === 2) expect(t.flags & FLIP_D).toBe(FLIP_D);
  });

  it("stamp candidates: placed once per chunk, top-left at the anchor, flipped like the pick", () => {
    const set: RandomSet = { id: "s", name: "", candidates: [tree], chunk: { w: 3, h: 2 }, randomFlip: true };
    const placed = new Set<string>();
    // A stroke touching cells of two chunks, in two batches.
    const first = planRandomPaint(set, 7, [{ x: 4, y: 1 }, { x: 5, y: 0 }], placed);
    expect(first.tiles).toEqual([]);
    expect(first.stamps).toHaveLength(1);
    const pick = pickRandomCandidate(set, 7, 3, 0)!;
    expect(first.stamps[0]).toEqual({ stampId: "tree", x: 3, y: 0, flip: { x: (pick.flags & FLIP_H) !== 0, y: (pick.flags & FLIP_V) !== 0 } });
    const second = planRandomPaint(set, 7, [{ x: 3, y: 1 }, { x: 6, y: 1 }], placed);
    expect(second.stamps.map((s) => [s.x, s.y])).toEqual([[6, 0]]);
  });

  it("without a chunk, a stamp candidate anchors at the cell itself", () => {
    const set: RandomSet = { id: "s", name: "", candidates: [grass, tree] };
    const plan = planRandomPaint(set, 3, area(0, 0, 10, 10));
    expect(plan.stamps.length).toBeGreaterThan(0);
    expect(plan.tiles.length + plan.stamps.length).toBe(100);
    for (const s of plan.stamps) expect(pickRandomCandidate(set, 3, s.x, s.y)!.candidate).toBe(tree);
  });

  it("scatter leaves cells out (nothing written) and keeps the others' picks", () => {
    const dense: RandomSet = { id: "s", name: "", candidates: [grass, flower] };
    const sparse: RandomSet = { ...dense, scatter: 0.75 };
    const cells = area(0, 0, 40, 40);
    const all = planRandomPaint(dense, 9, cells).tiles;
    const some = planRandomPaint(sparse, 9, cells).tiles;
    expect(some.length).toBeGreaterThan(cells.length * 0.15);
    expect(some.length).toBeLessThan(cells.length * 0.35);
    const byCell = new Map(all.map((t) => [`${t.x},${t.y}`, t.tileId]));
    for (const t of some) expect(t.tileId).toBe(byCell.get(`${t.x},${t.y}`));
  });

  it("is deterministic: same seed → same plan, whatever the stroke order", () => {
    const set: RandomSet = { id: "s", name: "", candidates: [grass, flower, tree], scatter: 0.3, chunk: { w: 2, h: 2 }, randomFlip: true };
    const cells = area(0, 0, 16, 16);
    const key = (p: ReturnType<typeof planRandomPaint>) =>
      [...p.tiles.map((t) => `t${t.x},${t.y}:${t.tileId}:${t.flags}`), ...p.stamps.map((s) => `s${s.x},${s.y}:${+s.flip.x}${+s.flip.y}`)].sort();
    const a = planRandomPaint(set, 5, cells);
    expect(key(planRandomPaint(set, 5, cells))).toEqual(key(a));
    expect(key(planRandomPaint(set, 5, [...cells].reverse()))).toEqual(key(a));
    expect(key(planRandomPaint(set, 6, cells))).not.toEqual(key(a));
    expect(randomPlanKey(set, 5)).toBe(randomPlanKey({ ...set }, 5));
  });

  it("usableRandomSet drops unusable candidates (paint and preview agree)", () => {
    const set: RandomSet = { id: "s", name: "", candidates: [grass, flower, tree] };
    expect(usableRandomSet(set, () => true)).toBe(set);
    expect(usableRandomSet(set, (c) => c.kind === "tile")!.candidates).toEqual([grass, flower]);
    expect(usableRandomSet(set, () => false)).toBeNull();
  });
});
