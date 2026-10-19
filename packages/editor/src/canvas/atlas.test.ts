import { describe, expect, it } from "vitest";

import { layoutAtlas, tileBlits, tileUV } from "./atlas";

describe("layoutAtlas", () => {
  it("lays tiles out with padding and no overlap", () => {
    const l = layoutAtlas(64, 32, 32, 2, 4096);
    expect(l.pages).toHaveLength(1);
    expect(l.columns).toBe(64);
    expect(l.pages[0]).toEqual({ width: 64 * 36, height: 36 });
    expect(l.slots[0]).toEqual({ page: 0, x: 2, y: 2 });
    expect(l.slots[1]).toEqual({ page: 0, x: 38, y: 2 });
    const seen = new Set(l.slots.map((s) => `${s.page}:${s.x}:${s.y}`));
    expect(seen.size).toBe(64);
  });

  it("splits into multiple pages when a page would exceed the cap", () => {
    // slot 36 px → 113 per row, 113 rows per page at 4096 → 12769 per page
    const l = layoutAtlas(20000, 32, 32, 2, 4096);
    expect(l.pages).toHaveLength(2);
    for (const p of l.pages) {
      expect(p.width).toBeLessThanOrEqual(4096);
      expect(p.height).toBeLessThanOrEqual(4096);
    }
    for (const s of l.slots) {
      const p = l.pages[s.page]!;
      expect(s.x - 2).toBeGreaterThanOrEqual(0);
      expect(s.y - 2).toBeGreaterThanOrEqual(0);
      expect(s.x + 32 + 2).toBeLessThanOrEqual(p.width);
      expect(s.y + 32 + 2).toBeLessThanOrEqual(p.height);
    }
    expect(l.slots[12769]!.page).toBe(1);
  }, 60_000);

  it("rejects tiles larger than a page", () => {
    expect(() => layoutAtlas(1, 4096, 16, 2, 4096)).toThrow(RangeError);
  });

  it("handles zero tiles", () => {
    expect(layoutAtlas(0, 16, 16).pages).toEqual([]);
  });
});

describe("tileBlits", () => {
  it("copies the tile and extrudes every edge and corner by pad", () => {
    const blits = tileBlits(64, 32, 32, 32, 10, 20, 2);
    expect(blits).toHaveLength(9);
    expect(blits[0]).toEqual({ sx: 64, sy: 32, sw: 32, sh: 32, dx: 10, dy: 20, dw: 32, dh: 32 });
    // destination coverage: exactly the padded slot, no overlaps
    const covered = new Map<string, number>();
    for (const b of blits) {
      for (let y = b.dy; y < b.dy + b.dh; y++)
        for (let x = b.dx; x < b.dx + b.dw; x++) covered.set(`${x},${y}`, (covered.get(`${x},${y}`) ?? 0) + 1);
    }
    expect(covered.size).toBe(36 * 36);
    expect([...covered.values()].every((n) => n === 1)).toBe(true);
    // edge strips sample a single row/column of the source border
    for (const b of blits.slice(1)) expect(b.sw === 1 || b.sh === 1).toBe(true);
    // a pixel in the right padding samples the source's right column
    const right = blits.find((b) => b.dx === 42 && b.dy === 20)!;
    expect(right.sx).toBe(95);
  });

  it("emits only the copy without padding", () => {
    expect(tileBlits(0, 0, 8, 8, 0, 0, 0)).toHaveLength(1);
  });
});

describe("tileUV", () => {
  it("uses the exact content edges", () => {
    const l = layoutAtlas(4, 32, 32, 2, 4096);
    const uv = tileUV(l, 1)!;
    expect(uv.page).toBe(0);
    expect(uv.u0 * l.pages[0]!.width).toBeCloseTo(38);
    expect(uv.u1 * l.pages[0]!.width).toBeCloseTo(70);
    expect(uv.v0 * l.pages[0]!.height).toBeCloseTo(2);
    expect(uv.v1 * l.pages[0]!.height).toBeCloseTo(34);
    expect(tileUV(l, 4)).toBeUndefined();
  });
});

describe('dirtyTileBlits', () => {
  it('copies only an interior dirty pixel without rewriting extrusion', async () => {
    const { dirtyTileBlits } = await import('./atlas');
    expect(dirtyTileBlits(32, 64, 16, 16, 2, 2, 2, { x: 3, y: 4, width: 1, height: 1 })).toEqual([{ sx: 35, sy: 68, sw: 1, sh: 1, dx: 5, dy: 6, dw: 1, dh: 1 }]);
  });
  it('updates affected edge/corner extrusion and retains full-tile blits for allocations', async () => {
    const { dirtyTileBlits } = await import('./atlas');
    expect(dirtyTileBlits(0, 0, 16, 16, 2, 2, 2, { x: 0, y: 0, width: 1, height: 1 })).toHaveLength(4);
    expect(dirtyTileBlits(0, 0, 16, 16, 2, 2, 2, { x: 0, y: 4, width: 1, height: 1 })).toHaveLength(2);
    expect(dirtyTileBlits(0, 0, 16, 16, 2, 2, 2, { x: 0, y: 0, width: 16, height: 16 })).toEqual(tileBlits(0, 0, 16, 16, 2, 2, 2));
  });
});
