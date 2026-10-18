import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FLIP_D, FLIP_H, FLIP_V, cellFlags, makeCell, rotateCellFlags } from "../src/cell";
import { BLOB47_MASKS } from "../src/terrain";
import { bakedNineSliceTerrainSet, bakedNineSliceSolidTiles, composeOrientation, nineSliceBlits, nineSliceLayout, nineSliceProblem, planNineSliceRect, sampleNineSlice } from "../src/nineSlice";

import { source } from "./smartStampHelpers";

describe("nine-slice contract", () => {
  it("diagnoses eligibility separately from road representatives", () => {
    expect(nineSliceProblem(source())).toBeNull();
    expect(nineSliceProblem(source(2, 3))).toMatch(/3/);
    const s = source(); s.layers[0]!.cells[4] = 0;
    expect(nineSliceProblem(s)).toBeNull();
    expect(nineSliceProblem(s, { roadLayerId: "s" })).toMatch(/representative/);
  });

  it("samples arbitrary source strips and target sizes with fixed corners and phase", () => {
    fc.assert(fc.property(fc.integer({ min: 3, max: 12 }), fc.integer({ min: 3, max: 12 }), fc.integer({ min: 2, max: 128 }), fc.integer({ min: 2, max: 128 }), (n, m, width, height) => {
      const s = source(n, m), rect = { x: -7, y: -11, width, height };
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = x === 0 ? 0 : x === width - 1 ? n - 1 : 1 + (x - 1) % (n - 2);
        const sy = y === 0 ? 0 : y === height - 1 ? m - 1 : 1 + (y - 1) % (m - 2);
        if (sampleNineSlice(rect, { x: x - 7, y: y - 11 }, s)?.slot !== sy * n + sx) throw new Error("source phase mismatch");
      }
    }), { numRuns: 35 });
  });

  it("addresses every compact cap and preserves its contributing source cells", () => {
    const s = source(5, 4), l = nineSliceLayout(s);
    expect(l).toMatchObject({ source: 0, collapsedWidth: 20, collapsedHeight: 24, isolated: 29, bank: 30, slots: 77 });
    for (const [width, height] of [[1, 1], [1, 9], [9, 1], [2, 2], [2, 9], [9, 2]]) {
      const rect = { x: 0, y: 0, width: width!, height: height! };
      const plan = planNineSliceRect(rect, s);
      expect(plan).toHaveLength(width! * height!);
      for (const p of plan) {
        expect(p.sourceIndices.length).toBe(width === 1 && height === 1 ? 4 : width === 1 || height === 1 ? 2 : 1);
        expect(p.slot).toBeLessThan(l.bank);
      }
    }
  });

  it("bakes all 47 explicit masks, copies empty slots transparently, and bounds odd flipped quarter blits", () => {
    fc.assert(fc.property(fc.integer({ min: 3, max: 9 }), fc.integer({ min: 3, max: 9 }), fc.integer({ min: 1, max: 33 }), fc.integer({ min: 0, max: 7 }), (n, m, size, f) => {
      const s = source(n, m), flags = ((f & 4 ? FLIP_H : 0) | (f & 2 ? FLIP_V : 0) | (f & 1 ? FLIP_D : 0)) >>> 0;
      s.layers[0]!.cells.fill(makeCell(1, flags));
      const blits = nineSliceBlits(s, "s", size, size);
      const l = nineSliceLayout(s);
      const areas = new Float64Array(l.slots);
      for (const b of blits) {
        if (b.slot >= l.slots || b.flags !== flags) throw new Error("slot or source flags mismatch");
        areas[b.slot]! += b.destinationRect.width * b.destinationRect.height;
        for (const r of [b.sourceRect, b.destinationRect]) {
          if (r.x < 0 || r.y < 0 || r.x + r.width > size || r.y + r.height > size) throw new Error("blit out of bounds");
        }
        if (b.sourceRect.width * b.sourceRect.height !== b.destinationRect.width * b.destinationRect.height) throw new Error("blit requires resampling");
      }
      const set = bakedNineSliceTerrainSet(s, "s", { id: "road", name: "Road", terrainId: 1 });
      expect(set.tiles.filter(t => t.tileId >= l.bank).map(t => t.mask)).toEqual(BLOB47_MASKS);
      expect([...areas]).toEqual(new Array(l.slots).fill(size * size));
    }), { numRuns: 45 });
    const s = source(); s.layers[0]!.cells[0] = 0;
    expect(nineSliceBlits(s, "s", 5, 5).filter(b => b.slot === 0)).toEqual([]);
  });

  it("transforms the whole geometry and phase; four turns and two mirrors are identities", () => {
    const s = source(5, 4), cw = cellFlags(rotateCellFlags(1, "cw"));
    let orientation = 0;
    for (let i = 0; i < 4; i++) orientation = composeOrientation(orientation, cw);
    expect(orientation).toBe(0);
    expect(composeOrientation(FLIP_H, FLIP_H)).toBe(0);
    expect(composeOrientation(FLIP_V, FLIP_V)).toBe(0);
    const a = planNineSliceRect({ x: 0, y: 0, width: 8, height: 7 }, s);
    const b = planNineSliceRect({ x: 0, y: 0, width: 7, height: 8 }, s, cw);
    for (const p of a) expect(b.find(q => q.x === 6 - p.y && q.y === p.x)).toMatchObject({ slot: p.slot, flags: cw });
  });
});

describe("quarter-blit pixel contract", () => {
  it("preserves labelled pixels and transparency for every source orientation, including odd mirrored halves", () => {
    for (const size of [3, 4, 5, 9]) for (const flags of [0, FLIP_H, FLIP_V, FLIP_D, (FLIP_H | FLIP_D) >>> 0, (FLIP_V | FLIP_D) >>> 0, (FLIP_H | FLIP_V) >>> 0, (FLIP_H | FLIP_V | FLIP_D) >>> 0]) {
      const s = source();
      for (let i = 0; i < 9; i++) s.layers[0]!.cells[i] = makeCell(i + 1, flags);
      // Each integer encodes source tile, pixel and alpha (including exactly transparent pixels).
      const pixel = (tile: number, x: number, y: number) => ((tile + 1) * 10000 + y * size + x) * 256 + (x === y ? 0 : 173);
      const layout = nineSliceLayout(s), output = Array.from({ length: layout.slots }, () => new Float64Array(size * size));
      for (const b of nineSliceBlits(s, "s", size, size)) {
        const r = b.sourceRect;
        for (let sy = 0; sy < r.height; sy++) for (let sx = 0; sx < r.width; sx++) {
          let x = sx, y = sy, w = r.width, h = r.height;
          if (b.flags & FLIP_D) { [x, y] = [y, x]; [w, h] = [h, w]; }
          if (b.flags & FLIP_H) x = w - 1 - x;
          if (b.flags & FLIP_V) y = h - 1 - y;
          output[b.slot]![(b.destinationRect.y + y) * size + b.destinationRect.x + x] = pixel(b.tile.tileId, r.x + sx, r.y + sy);
        }
      }
      const expected = (tile: number, x: number, y: number) => {
        if (flags & FLIP_H) x = size - 1 - x;
        if (flags & FLIP_V) y = size - 1 - y;
        if (flags & FLIP_D) [x, y] = [y, x];
        return pixel(tile, x, y);
      };
      for (let tile = 0; tile < 9; tile++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (output[tile]![y * size + x] !== expected(tile, x, y)) throw new Error("source copy changed a pixel");
      const half = Math.floor(size / 2);
      // Isolated caps use their corresponding outer corner, never top-left precedence.
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const tile = y < half ? x < half ? 0 : 2 : x < half ? 6 : 8;
        if (output[layout.isolated]![y * size + x] !== expected(tile, x, y)) throw new Error("isolated cap pixel mismatch");
      }
      // Every reduced mask has an independently specified quadrant source, with square centre joins.
      BLOB47_MASKS.forEach((mask, i) => {
        const sources = [mask & 1 ? mask & 64 ? 4 : 3 : mask & 64 ? 1 : 0, mask & 1 ? mask & 4 ? 4 : 5 : mask & 4 ? 1 : 2, mask & 16 ? mask & 4 ? 4 : 5 : mask & 4 ? 7 : 8, mask & 16 ? mask & 64 ? 4 : 3 : mask & 64 ? 7 : 6];
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const q = y < half ? x < half ? 0 : 1 : x < half ? 3 : 2;
          if (output[layout.bank + i]![y * size + x] !== expected(sources[q]!, x, y)) throw new Error(`bank mask ${mask} quadrant ${q} pixel mismatch`);
        }
      });
    }
  });

  it("uses authored inner quadrants only where both cardinal neighbours exist and the diagonal is absent", () => {
    const s = source(), l = nineSliceLayout(s);
    const blits = nineSliceBlits(s, "s", 5, 5, { tile: { tilesetId: "inner", tileId: 0 }, flags: FLIP_H });
    expect(blits.filter(b => b.slot === l.bank + BLOB47_MASKS.indexOf(255)).every(b => b.tile.tilesetId === "source")).toBe(true);
    expect(blits.filter(b => b.slot === l.bank + BLOB47_MASKS.indexOf(85)).every(b => b.tile.tilesetId === "inner")).toBe(true);
  });
});


it("assigns conservative composite solidity without changing copied tile solidity", () => {
  const s = source(), l = nineSliceLayout(s);
  expect(bakedNineSliceSolidTiles(s, "s", tile => tile.tileId === 0)).toEqual([0, l.collapsedWidth, l.collapsedHeight, l.isolated, ...[0, 4, 16, 20, 28].map(mask => l.bank + BLOB47_MASKS.indexOf(mask))].sort((a, b) => a - b));
});

it("samples arbitrary compact caps with the same periodic phase as wide rectangles", () => {
  fc.assert(fc.property(fc.integer({ min: 3, max: 20 }), fc.integer({ min: 3, max: 20 }), fc.integer({ min: 1, max: 128 }), (n, m, length) => {
    const s = source(n, m), layout = nineSliceLayout(s);
    for (let y = 0; y < length; y++) {
      const p = sampleNineSlice({ x: -3, y: -8, width: 1, height: length }, { x: -3, y: y - 8 }, s)!;
      const sy = y === 0 ? 0 : y === length - 1 ? m - 1 : 1 + (y - 1) % (m - 2);
      expect(p.slot).toBe(length === 1 ? layout.isolated : layout.collapsedWidth + sy);
    }
    for (let x = 0; x < length; x++) {
      const p = sampleNineSlice({ x: -3, y: -8, width: length, height: 1 }, { x: x - 3, y: -8 }, s)!;
      const sx = x === 0 ? 0 : x === length - 1 ? n - 1 : 1 + (x - 1) % (n - 2);
      expect(p.slot).toBe(length === 1 ? layout.isolated : layout.collapsedHeight + sx);
    }
  }), { numRuns: 40 });
});
