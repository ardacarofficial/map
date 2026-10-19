import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FLIP_D, FLIP_H } from "../../src/cell";
import { planPixelPoints, planPixelStroke, planPixelLine, planPixelRectangle, type PixelGrid, type RasterView } from "../../src/pixel/planner";
import { sourceToPlacedPixel } from "../../src/pixel/mirror";

// Test runner clock only; production core has no host globals.
const host = globalThis as unknown as { performance: { now(): number }; console: { info(message: string): void } };
const transparent = { r: 0, g: 0, b: 0, a: 0 };
const color = { r: 200, g: 20, b: 5, a: 80 };
const raster: RasterView = { width: 16, height: 16, get: () => transparent };
const grid: PixelGrid = { tileWidth: 16, tileHeight: 16, getTile: () => ({ raster }) };
const writeKeys = (plan: ReturnType<typeof planPixelPoints>) => plan.flatMap(tile => tile.writes.map(p => `${tile.cellX},${tile.cellY}:${p.x},${p.y}`));

describe("pure pixel planning", () => {
  it("routes negative world pixels to local pixels and emits minimal dirty bounds", () => {
    const plan = planPixelPoints([{ x: -1, y: -17 }, { x: -2, y: -18 }, { x: -1, y: -17 }], grid, color);
    expect(plan).toEqual([{ cellX: -1, cellY: -2, writes: [{ x: 14, y: 14, color }, { x: 15, y: 15, color }], dirtyRect: { x: 14, y: 14, width: 2, height: 2 } }]);
  });

  it("is deterministic, order independent, deduplicated and never blends straight alpha", () => {
    fc.assert(fc.property(fc.array(fc.record({ x: fc.integer({ min: -40, max: 40 }), y: fc.integer({ min: -40, max: 40 }) }), { maxLength: 100 }), points => {
      const plan = planPixelPoints(points, grid, color);
      expect(planPixelPoints([...points].reverse(), grid, color)).toEqual(plan);
      expect(new Set(writeKeys(plan)).size).toBe(writeKeys(plan).length);
      for (const tile of plan) for (const write of tile.writes) {
        expect(write.x).toBeGreaterThanOrEqual(0);
        expect(write.y).toBeGreaterThanOrEqual(0);
        expect(write.x).toBeLessThan(16);
        expect(write.y).toBeLessThan(16);
        expect(write.color).toEqual(color);
      }
    }));
  });

  it("bridges coalesced samples and reflects the full footprint (even sizes included)", () => {
    const mirror = { vertical: true, origin: { x: 8, y: 0 } };
    const plan = planPixelStroke([{ x: 2, y: 5 }, { x: 4, y: 5 }], grid, { color, size: 2, mirror });
    const keys = new Set(writeKeys(plan));
    // 2px tip is [-1,0], so its mirror at x=8 covers [12,15], not [11,14].
    expect(keys.has("0,0:15,4")).toBe(true);
    expect(keys.has("0,0:1,4")).toBe(true);
    expect(keys.size).toBe(16);
    expect(planPixelLine({ x: 2, y: 5 }, { x: 4, y: 5 }, grid, { color, size: 2, mirror })).toEqual(plan);
    expect(planPixelRectangle({ x: 1, y: 1 }, { x: 3, y: 3 }, grid, color, false)[0]!.writes.length).toBe(8);
    expect(planPixelRectangle({ x: 1, y: 1 }, { x: 3, y: 3 }, grid, color, true)[0]!.writes.length).toBe(9);
  });

  it("maps visible pixels to source exactly once, preserving placement identity", () => {
    const flags = (FLIP_D | FLIP_H) >>> 0;
    const flipped: PixelGrid = { ...grid, getTile: (x, y) => x === 0 && y === 0 ? { raster, flags } : null };
    const points = [{ x: 1, y: 4 }, { x: 4, y: 8 }];
    const plan = planPixelPoints(points, flipped, color);
    expect(plan[0]!.writes.map(p => sourceToPlacedPixel(p, 16, 16, flags)).sort((a, b) => a.y - b.y)).toEqual(points);
    expect(planPixelPoints([{ x: -1, y: 0 }], flipped, color)).toEqual([]);
  });

  it("skips unchanged pixels and erases to transparent black", () => {
    expect(planPixelStroke([{ x: 1, y: 1 }], grid, { color, erase: true })).toEqual([]);
    const painted: PixelGrid = { ...grid, getTile: () => ({ raster: { ...raster, get: () => color } }) };
    expect(planPixelStroke([{ x: 1, y: 1 }], painted, { color, erase: true })[0]!.writes).toEqual([{ x: 1, y: 1, color: transparent }]);
    expect(planPixelPoints([{ x: 1, y: 1 }], painted, color)).toEqual([]);
  });

  it("owns colour snapshots and reapplying a complete gesture is a no-op", () => {
    const input = { ...color };
    const pixels = new Map<string, typeof color>();
    const local: PixelGrid = { ...grid, getTile: (x, y) => x === 0 && y === 0 ? {
      raster: { ...raster, get: (x, y) => pixels.get(`${x},${y}`) ?? transparent },
    } : null };
    const samples = [{ x: 2, y: 2 }, { x: 9, y: 5 }];
    const plan = planPixelStroke(samples, local, { color: input, size: 3 });
    input.r = 0;
    for (const tile of plan) for (const write of tile.writes) {
      expect(write.color).toEqual(color);
      pixels.set(`${write.x},${write.y}`, write.color);
    }
    expect(planPixelStroke(samples, local, { color, size: 3 })).toEqual([]);
  });

  it("rejects incompatible native dimensions instead of silently scaling pixel art", () => {
    expect(() => planPixelPoints([{ x: 0, y: 0 }], { ...grid, getTile: () => ({ raster: { ...raster, width: 8 } }) }, color)).toThrow(RangeError);
    expect(() => planPixelPoints([], { ...grid, tileWidth: 0 }, color)).toThrow(RangeError);
  });

  it("plans a warm 32px pencil with 200 coalesced samples within a generous CI budget", () => {
    const samples = Array.from({ length: 200 }, (_, x) => ({ x, y: 16 }));
    for (let i = 0; i < 10; i++) planPixelStroke(samples, grid, { color, size: 32 });
    const times: number[] = [];
    for (let i = 0; i < 25; i++) {
      const start = host.performance.now();
      const plan = planPixelStroke(samples, grid, { color, size: 32 });
      times.push(host.performance.now() - start);
      expect(plan.reduce((n, tile) => n + tile.writes.length, 0)).toBe(231 * 32);
    }
    times.sort((a, b) => a - b);
    // The local target is <2ms; allow scheduler contention in the full CI suite.
    expect(times[12]).toBeLessThan(100);
    host.console.info(`pixel 32px/200 samples: p50=${times[12]!.toFixed(3)}ms p95=${times[23]!.toFixed(3)}ms`);
  });
});
