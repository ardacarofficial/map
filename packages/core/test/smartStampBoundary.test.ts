import { expect, it } from "vitest";
import fc from "fast-check";
import { detectNineSliceSelection } from "../src/smartStamp/detect";
import { boundaryArt, materialHash } from "./smartStampBoundaryArt";

it("rejects the exact seed-1 nonperiodic stone floor from review Round 2", () => {
  expect(Array.from({ length: 6 }, (_, i) => 30 + materialHash(36 + i) % 180)).toEqual([167, 144, 59, 68, 47, 129]);
  expect(detectNineSliceSelection(boundaryArt(1))).toBeNull();
});
for (const size of [16, 32]) for (const material of ["stone", "plank", "grass"] as const) it(`${size}px borderless ${material} variations stay plain at every 5..8 tile shape`, () => {
  for (let w = 5; w <= 8; w++) for (let h = 5; h <= 8; h++) expect(detectNineSliceSelection(boundaryArt(1, w, h, size, material)), `${w}×${h}`).toBeNull();
});
it("rejects random per-tile-tone materials with seamless grout, sheet offsets and D4 orientations", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 0x7fff_ffff }), fc.integer({ min: 5, max: 8 }), fc.integer({ min: 5, max: 8 }), fc.constantFrom(16, 32), fc.constantFrom("stone", "plank", "grass"), fc.integer({ min: 0, max: 7 }), (seed, w, h, size, material, orientation) => {
    expect(detectNineSliceSelection(boundaryArt(seed, w, h, size, material, 0, orientation, { col: 2, row: 1, margin: 1, spacing: 2 }))).toBeNull();
  }), { numRuns: 160 });
}, 60_000);
it("keeps review bounded road/wall/water positives at 16 and 32 px", () => {
  for (const size of [16, 32]) for (const material of ["road", "wall", "water"] as const) expect(detectNineSliceSelection(boundaryArt(0, 6, 6, size, material, 2))?.border).toBe(2);
});
it("recognizes framed per-pixel grain independently of b, positive centre spans, grid and orientation", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 10_000 }), fc.constantFrom(2, 3), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }), fc.constantFrom(16, 32), fc.constantFrom("road", "wall", "water"), fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 }), (seed, b, cx, cy, size, material, orientation, margin, spacing) => {
    const result = detectNineSliceSelection(boundaryArt(seed, 2 * b + cx, 2 * b + cy, size, material, b, orientation, { col: 2, row: 1, margin, spacing }));
    expect(result).not.toBeNull(); expect(result!.border).toBeLessThanOrEqual(b);
  }), { numRuns: 60 });
}, 60_000);

it("requires corner profiles to continue adjacent bands, even when all tile seams still join", () => {
  const art = boundaryArt(0, 6, 6, 16, "road", 2), pixels = art.pixels!, data = pixels.data.slice();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (x % 16 === 0 || y % 16 === 0 || x % 16 === 15 || y % 16 === 15) continue;
    data.set([60 + Math.floor(y / 16) * 100, 60 + Math.floor(y / 16) * 100, 60 + Math.floor(y / 16) * 100, 255], (y * pixels.width + x) * 4);
  }
  expect(detectNineSliceSelection({ ...art, pixels: { ...pixels, data } })).toBeNull();
});
