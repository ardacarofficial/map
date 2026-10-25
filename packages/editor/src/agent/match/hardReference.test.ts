import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeWorkingSourcePng } from "../../io/sourcePng";
import { detectAlignment } from "./alignment";
import { buildTileIndex } from "./tileIndex";
import { quantizeAligned } from "./quantize";
import { makeHardMap, makeHardTileset, renderHardReference, resizeReference, renderMapPixels, scorePrediction, sliceSheet, tileSources, type HardOptions, type HardTile } from "./testing/hardReference";

const HARD = { lighting: 0.4, noise: 6, gutter: 18, glows: [
  { x: 0.3, y: 0.35, radius: 0.12, color: [255, 190, 90] as [number, number, number], strength: 0.35 },
  { x: 0.75, y: 0.7, radius: 0.1, color: [120, 220, 255] as [number, number, number], strength: 0.3 },
] };

async function run(tiles: HardTile[], candidates: HardTile[], cols: number, rows: number, o: HardOptions, label: string, resize = 1) {
  const map = makeHardMap(tiles, cols, rows, o.seed);
  const rendered = renderHardReference(renderMapPixels(tiles, map), tiles[0]!.w, o), ref = resize === 1 ? rendered : resizeReference(rendered, resize);
  const index = buildTileIndex(tileSources(candidates));
  const t0 = performance.now();
  const { alignment, content } = await detectAlignment(ref.image, { tileWidth: tiles[0]!.w, tileHeight: tiles[0]!.w, index });
  const t1 = performance.now();
  const region = { x: 0, y: 0, width: alignment.cols, height: alignment.rows };
  const cells = await quantizeAligned({ reference: ref.image, alignment, content, region, index, tileWidth: tiles[0]!.w, tileHeight: tiles[0]!.w, normalizeLight: true, layered: true });
  const t2 = performance.now();
  const score = scorePrediction(candidates, map, ref, alignment, region.width, region.height, (x, y) => {
    const m = cells[y * region.width + x]!.match;
    return m && m.ground ? { ground: m.ground.ref, overlay: m.overlay?.ref ?? null } : null;
  });
  console.log(`${label}: alignment ${JSON.stringify(alignment)} truth ${JSON.stringify(ref.alignment)} | ground ${(score.ground * 100).toFixed(1)}% overlay ${(score.overlay * 100).toFixed(1)}% (${score.overlayCells} cells, ${score.overlayFalse} false) of ${score.cells} | align ${(t1 - t0).toFixed(0)} ms, match ${(t2 - t1).toFixed(0)} ms`);
  if (score.misses.length) console.log(score.misses.slice(0, 20).join("\n"));
  return { alignment, truth: ref.alignment, score };
}

describe("matcher on hard references", () => {
  it("×4, 16 px tiles, non-cell shift, gutter, gradient, glows and noise", async () => {
    const ts = makeHardTileset("hard16", 16, 3);
    const r = await run(ts.tiles, ts.tiles, 34, 24, { ...HARD, scale: 4, offsetX: 13 - 64, offsetY: 7 - 64, width: 1980, height: 1420, seed: 7 }, "x4/16");
    expect(r.alignment.cellPx).toBe(64);
    expect(r.alignment.offsetX).toBe(r.truth.offsetX);
    expect(r.alignment.offsetY).toBe(r.truth.offsetY);
    expect(r.score.ground).toBeGreaterThanOrEqual(0.95);
    expect(r.score.overlay).toBeGreaterThanOrEqual(0.9);
  }, 120000);
  it("×2 pixel art resized to 75 % (fractional 1.5 px per tile pixel)", async () => {
    const ts = makeHardTileset("hard16", 16, 4);
    const r = await run(ts.tiles, ts.tiles, 34, 24, { ...HARD, noise: 4, scale: 2, offsetX: 11 - 32, offsetY: 5 - 32, width: 1060, height: 740, seed: 5 }, "x2*0.75/16", 0.75);
    expect(r.alignment.cellPx).toBeCloseTo(24, 2);
    expect(Math.abs(r.alignment.offsetX - r.truth.offsetX)).toBeLessThanOrEqual(1);
    expect(r.score.ground).toBeGreaterThanOrEqual(0.95);
    expect(r.score.overlay).toBeGreaterThanOrEqual(0.9);
  }, 120000);
  it("×3, 32 px tiles with the overworld sample as distractors", async () => {
    const ts = makeHardTileset("hard32", 32, 5);
    const sample = sliceSheet("overworld", decodeWorkingSourcePng(readFileSync(new URL("../../../../../samples/tilesets/overworld-32.png", import.meta.url))), 32);
    const r = await run(ts.tiles, [...ts.tiles, ...sample], 24, 17, { ...HARD, scale: 3, offsetX: 13 - 96, offsetY: 7 - 96, width: 2000, height: 1500, seed: 11 }, "x3/32");
    expect(r.alignment.cellPx).toBe(96);
    expect(r.alignment.offsetX).toBe(r.truth.offsetX);
    expect(r.alignment.offsetY).toBe(r.truth.offsetY);
    expect(r.score.ground).toBeGreaterThanOrEqual(0.95);
    expect(r.score.overlay).toBeGreaterThanOrEqual(0.9);
  }, 120000);
});
