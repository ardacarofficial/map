import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { RgbaImage } from "@smap/core";
import { blockScale, detectAlignment, samplePatch } from "./alignment";
import { matchCell } from "./matchCell";
import { quantizeAligned } from "./quantize";
import { buildTileIndex } from "./tileIndex";
import { makeHardTileset, tileSources } from "./testing/hardReference";

const ts = makeHardTileset("t", 16, 2);
const tile = (role: string) => ts.tiles.findIndex(t => t.role === role);
/** Ground with an optional overlay, straight "over" like the renderer, optionally lit. */
function composite(ground: number, overlay = -1, gain = 1): RgbaImage {
  const g = ts.tiles[ground]!.rgba, o = overlay >= 0 ? ts.tiles[overlay]!.rgba : null, data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) {
    const a = o ? o[i * 4 + 3]! / 255 : 0;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.min(255, Math.round(((o ? o[i * 4 + c]! * a : 0) + g[i * 4 + c]! * (1 - a)) * gain));
    data[i * 4 + 3] = 255;
  }
  return { width: 16, height: 16, data };
}
/** Tiles upscaled ×s into a picture whose map cell (0,0) sits at (ox, oy). */
function picture(cells: RgbaImage[][], s: number, ox: number, oy: number, w: number, h: number): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const mx = Math.floor((x - ox) / s), my = Math.floor((y - oy) / s), cell = cells[Math.floor(my / 16)]?.[Math.floor(mx / 16)];
    if (mx < 0 || my < 0 || !cell) { data.set([27, 33, 42, 255], (y * w + x) * 4); continue; }
    const p = ((my % 16) * 16 + mx % 16) * 4;
    data.set(cell.data.subarray(p, p + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

describe("K1 alignment helpers", () => {
  it("samplePatch returns the exact tile of a ×3 upscale, transparent off the picture", () => {
    const grass = composite(tile("grass")), water = composite(tile("water"));
    const ref = picture([[grass, water]], 3, 5, 2, 5 + 96, 2 + 48);
    const a = { cellPx: 48, scale: 3, offsetX: 5, offsetY: 2, cols: 2, rows: 1, confidence: 1, method: "manual" as const };
    expect([...samplePatch(ref, a, 1, 0).data]).toEqual([...water.data]);
    expect(samplePatch(ref, a, 0, 0).width).toBe(16);
    const off = samplePatch(ref, { ...a, offsetX: 5 + 48 }, 1, 0);
    expect(off.data[3]).toBe(0);
  });
  it("finds nearest-upscale block size and phase", () => {
    const cells = [[0, 1, 2, 3], [7, 8, 5, 6], [10, 11, 4, 0]].map(row => row.map(i => composite(i)));
    const ref = picture(cells, 4, 7, 3, 7 + 4 * 64, 3 + 3 * 64);
    expect(blockScale(ref, { x: 0, y: 0, width: ref.width, height: ref.height }, true)).toMatchObject({ s: 4, phase: 3 });
  });
  it("completes a full hint as a manual alignment", async () => {
    const cells = [[0, 7, 8], [10, 11, 5]].map(row => row.map(i => composite(i)));
    const ref = picture(cells, 2, 6, 4, 6 + 96, 4 + 64);
    const out = await detectAlignment(ref, { tileWidth: 16, tileHeight: 16, index: buildTileIndex(tileSources(ts.tiles)), hint: { scale: 2, offsetX: 6, offsetY: 4 } });
    expect(out.alignment).toMatchObject({ cellPx: 32, scale: 2, offsetX: 6, offsetY: 4, cols: 3, rows: 2, method: "manual" });
    expect(out.alignment.confidence).toBeGreaterThan(0.8);
  });
});

describe("K3 matchCell", () => {
  const index = buildTileIndex(tileSources(ts.tiles));
  it("flags opaque ground and transparent overlay tiles", () => {
    expect(index.tiles[tile("water")]!.opaque).toBe(true);
    expect(index.overlay).toContain(tile("shoreN"));
  });
  it("matches a plain tile exactly, with alternatives", () => {
    const m = matchCell(composite(tile("sand")), index, { topK: 3 });
    expect(m.ground?.ref).toEqual({ tilesetId: "t", tileId: tile("sand") });
    expect(m.overlay).toBeUndefined();
    expect(m.err).toBeLessThan(0.5);
    expect(m.alternatives).toHaveLength(3);
  });
  it("finds ground under a transparent overlay only when layered", () => {
    const patch = composite(tile("water"), tile("shoreN"));
    const layered = matchCell(patch, index, { layered: true });
    expect(layered.ground?.ref.tileId).toBe(tile("water"));
    expect(layered.overlay?.ref.tileId).toBe(tile("shoreN"));
    expect(layered.err).toBeLessThan(0.5);
    expect(matchCell(patch, index).overlay).toBeUndefined();
  });
  it("normalizes a darkened cell", () => {
    const patch = composite(tile("darkGrass"), -1, 0.7);
    expect(matchCell(patch, index, { normalizeLight: true }).ground?.ref.tileId).toBe(tile("darkGrass"));
  });
});

describe("aligned quantization", () => {
  const index = buildTileIndex(tileSources(ts.tiles));
  it("recovers random ground + overlay grids exactly from integer upscales at any offset", async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 3, max: 6 }), fc.integer({ min: 3, max: 5 }), fc.integer({ min: 1, max: 3 }), fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 1e6 }),
      async (w, h, s, ox, oy, seed) => {
        let r = seed;
        const rand = (n: number) => { r = (r * 1103515245 + 12345) % 2147483648; return r % n; };
        const truth = Array.from({ length: w * h }, () => ({ g: index.ground[rand(index.ground.length)]!, o: rand(3) ? -1 : index.overlay[rand(index.overlay.length)]! }));
        const cells = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => composite(truth[y * w + x]!.g, truth[y * w + x]!.o)));
        const ref = picture(cells, s, ox, oy, ox + w * 16 * s, oy + h * 16 * s);
        const { alignment, content } = await detectAlignment(ref, { tileWidth: 16, tileHeight: 16, index });
        expect([alignment.cellPx, alignment.offsetX, alignment.offsetY, alignment.cols, alignment.rows]).toEqual([16 * s, ox, oy, w, h]);
        const out = await quantizeAligned({ reference: ref, alignment, content, region: { x: 0, y: 0, width: w, height: h }, index, tileWidth: 16, tileHeight: 16, normalizeLight: true, layered: true });
        expect(out.map(c => c.match?.groundIndex)).toEqual(truth.map(t => t.g));
        expect(out.map(c => c.match?.overlayIndex)).toEqual(truth.map(t => t.o));
      }), { numRuns: 20, seed: 42 });
  }, 120000);
});
