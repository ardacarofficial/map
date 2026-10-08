import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  alphaFromRgba,
  emptyTileIds,
  inferTileGrid,
  tileSizeFromFileName,
  tilesetGridRemap,
  tilesetImageExtent,
  tilesetWithGrid,
  type TileGrid,
} from "../src";
import { TILESET } from "./helpers";

/** Alpha bytes: 255 where `opaque(x, y)`. */
function alpha(width: number, height: number, opaque: (x: number, y: number) => boolean): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = opaque(x, y) ? 255 : 0;
  return out;
}

/**
 * A sheet of `cols × rows` tiles of `tile` px with `margin` / `spacing`.
 * Each tile holds a "sprite" (opaque except a 2 px transparent frame and a
 * transparent cross through its middle, unless `withCross` is false) so that tile edges fall on breaks
 * in the artwork; tiles listed in `empty` are fully transparent.
 */
function sheet(tile: number, cols: number, rows: number, margin = 0, spacing = 0, empty: readonly number[] = [], withCross = true) {
  const width = 2 * margin + cols * tile + (cols - 1) * spacing;
  const height = 2 * margin + rows * tile + (rows - 1) * spacing;
  const pitch = tile + spacing;
  const data = alpha(width, height, (x, y) => {
    const px = x - margin;
    const py = y - margin;
    if (px < 0 || py < 0 || px >= width - 2 * margin || py >= height - 2 * margin) return false;
    const lx = px % pitch;
    const ly = py % pitch;
    if (lx >= tile || ly >= tile) return false;
    const id = Math.floor(py / pitch) * cols + Math.floor(px / pitch);
    if (empty.includes(id)) return false;
    const frame = lx < 2 || ly < 2 || lx >= tile - 2 || ly >= tile - 2;
    const cross = withCross && (lx === tile / 2 || ly === tile / 2);
    return !frame && !cross;
  });
  return { width, height, alpha: data };
}

/** Fully opaque tiles separated only by transparent gutters / margin. */
function solidSheet(tile: number, cols: number, rows: number, margin = 0, spacing = 0) {
  const width = 2 * margin + cols * tile + (cols - 1) * spacing;
  const height = 2 * margin + rows * tile + (rows - 1) * spacing;
  const pitch = tile + spacing;
  const data = alpha(width, height, (x, y) => {
    const px = x - margin;
    const py = y - margin;
    if (px < 0 || py < 0 || px >= width - 2 * margin || py >= height - 2 * margin) return false;
    return px % pitch < tile && py % pitch < tile;
  });
  return { width, height, alpha: data };
}

const gridOf = (s: { tileWidth: number; tileHeight: number; margin: number; spacing: number }) => [s.tileWidth, s.tileHeight, s.margin, s.spacing];

describe("tileSizeFromFileName", () => {
  it("reads WxH pairs and trailing numbers, ignores implausible ones", () => {
    expect(tileSizeFromFileName("tiles_32x32.png")).toEqual({ width: 32, height: 32 });
    expect(tileSizeFromFileName("chars 16×24.png")).toEqual({ width: 16, height: 24 });
    expect(tileSizeFromFileName("dungeon-16.png")).toEqual({ width: 16, height: 16 });
    expect(tileSizeFromFileName("C:\\art\\v2\\forest_8px.png")).toEqual({ width: 8, height: 8 });
    expect(tileSizeFromFileName("tileset 2.png")).toBeNull();
    expect(tileSizeFromFileName("atlas_1024.png")).toBeNull();
    expect(tileSizeFromFileName("grass.png")).toBeNull();
  });
});

describe("inferTileGrid", () => {
  it("16 px tiles with 1 px spacing (gutters in the alpha)", () => {
    const img = solidSheet(16, 5, 4, 0, 1);
    const { best } = inferTileGrid(img);
    expect(gridOf(best!)).toEqual([16, 16, 0, 1]);
    expect(best).toMatchObject({ columns: 5, rows: 4, leftoverX: 0, leftoverY: 0, reason: expect.any(String) });
    expect(best!.reasons).toContain("gutters");
  });

  it("32 px tiles without spacing (seams in the artwork beat 16 and 64)", () => {
    const img = sheet(32, 4, 4, 0, 0, [5, 6]);
    const { best, suggestions } = inferTileGrid(img);
    expect(gridOf(best!)).toEqual([32, 32, 0, 0]);
    expect(best).toMatchObject({ columns: 4, rows: 4, leftoverX: 0, leftoverY: 0 });
    expect(suggestions.length).toBeGreaterThan(1);
    expect(suggestions.length).toBeLessThanOrEqual(6);
    // Sorted best first.
    for (let i = 1; i < suggestions.length; i++) expect(suggestions[i]!.score).toBeLessThanOrEqual(suggestions[i - 1]!.score);
  });

  it("16 px sprites are not mistaken for 32 px tiles", () => {
    const img = sheet(16, 8, 6, 0, 0, [3, 9, 17, 30, 31]);
    expect(gridOf(inferTileGrid(img).best!)).toEqual([16, 16, 0, 0]);
    // Every cell filled, no inner cross: the transparent band between two sprites gives it away.
    expect(gridOf(inferTileGrid(sheet(16, 8, 6, 0, 0, [], false)).best!)).toEqual([16, 16, 0, 0]);
  });

  it("a 2 px margin", () => {
    const img = solidSheet(32, 3, 3, 2, 0);
    const { best } = inferTileGrid(img);
    expect(gridOf(best!)).toEqual([32, 32, 2, 0]);
    expect(best).toMatchObject({ columns: 3, rows: 3, leftoverX: 0, leftoverY: 0 });
  });

  it("margin and spacing together, any tile size (regular gutter pattern)", () => {
    const img = solidSheet(20, 4, 3, 3, 2);
    expect(gridOf(inferTileGrid(img).best!)).toEqual([20, 20, 3, 2]);
  });

  it("file name vs content: the name wins only when the content does not contradict it", () => {
    // Content: 32 px tiles with 1 px spacing; the name says 16.
    const img = sheet(32, 3, 3, 0, 1, [], false);
    const mismatched = inferTileGrid({ ...img, fileName: "tiles-16.png" });
    expect(gridOf(mismatched.best!)).toEqual([32, 32, 0, 1]);
    // No alpha: the name decides between sizes that both divide the image.
    const named = inferTileGrid({ width: 256, height: 128, fileName: "tiles-16.png" });
    expect(gridOf(named.best!)).toEqual([16, 16, 0, 0]);
    expect(named.best!.reasons).toContain("fileName");
    const pair = inferTileGrid({ width: 160, height: 96, fileName: "hero_16x24.png" });
    expect(gridOf(pair.best!)).toEqual([16, 24, 0, 0]);
  });

  it("no alpha, no name: the project default 32 when it divides, the hint when given", () => {
    expect(gridOf(inferTileGrid({ width: 256, height: 256 }).best!)).toEqual([32, 32, 0, 0]);
    expect(gridOf(inferTileGrid({ width: 256, height: 256, hintSize: 16 }).best!)).toEqual([16, 16, 0, 0]);
    expect(gridOf(inferTileGrid({ width: 240, height: 160 }).best!)).toEqual([16, 16, 0, 0]);
  });

  it("non-divisible images are not rejected: leftover pixels are reported", () => {
    const { best, suggestions } = inferTileGrid({ width: 100, height: 70 });
    expect(best).not.toBeNull();
    expect(gridOf(best!)).toEqual([32, 32, 0, 0]);
    expect(best).toMatchObject({ columns: 3, rows: 2, leftoverX: 4, leftoverY: 6 });
    for (const s of suggestions) {
      expect(s.leftoverX).toBeGreaterThanOrEqual(0);
      expect(s.leftoverY).toBeGreaterThanOrEqual(0);
      expect(s.columns).toBeGreaterThanOrEqual(1);
    }
  });

  it("tiny or invalid images", () => {
    expect(inferTileGrid({ width: 0, height: 10 })).toEqual({ suggestions: [], best: null });
    const tiny = inferTileGrid({ width: 10, height: 10 });
    expect(gridOf(tiny.best!)).toEqual([8, 8, 0, 0]);
    expect(tiny.best).toMatchObject({ leftoverX: 2, leftoverY: 2 });
    // A fully transparent image still gets size suggestions.
    expect(inferTileGrid({ width: 64, height: 64, alpha: new Uint8Array(64 * 64) }).best).not.toBeNull();
  });

  it("every suggestion is consistent (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.integer({ min: 1, max: 300 }), fc.option(fc.integer({ min: 1, max: 64 }), { nil: undefined }), (w, h, hintSize) => {
        const { suggestions, best } = inferTileGrid({ width: w, height: h, ...(hintSize !== undefined ? { hintSize } : {}) });
        expect(best).toBe(suggestions[0] ?? null);
        for (const s of suggestions) {
          expect(s.columns).toBeGreaterThanOrEqual(1);
          expect(s.rows).toBeGreaterThanOrEqual(1);
          expect(2 * s.margin + s.columns * s.tileWidth + (s.columns - 1) * s.spacing + s.leftoverX).toBe(w);
          expect(2 * s.margin + s.rows * s.tileHeight + (s.rows - 1) * s.spacing + s.leftoverY).toBe(h);
          expect(s.leftoverX).toBeGreaterThanOrEqual(0);
          expect(s.leftoverY).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("emptyTileIds / alphaFromRgba", () => {
  it("finds fully transparent tiles, respecting margin and spacing", () => {
    const img = sheet(16, 4, 3, 1, 2, [0, 5, 11]);
    const grid: TileGrid = { tileWidth: 16, tileHeight: 16, margin: 1, spacing: 2, columns: 4, rows: 3 };
    expect([...emptyTileIds(grid, img)].sort((a, b) => a - b)).toEqual([0, 5, 11]);
  });

  it("tiles reaching past the image count the missing pixels as transparent", () => {
    const img = { width: 20, height: 16, alpha: alpha(20, 16, (x) => x < 4) };
    const grid: TileGrid = { tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0, columns: 2, rows: 1 };
    expect([...emptyTileIds(grid, img)]).toEqual([1]);
  });

  it("alphaFromRgba takes every 4th byte", () => {
    expect([...alphaFromRgba([1, 2, 3, 4, 5, 6, 7, 0, 9, 9, 9, 255], 3, 1)]).toEqual([4, 0, 255]);
  });
});

describe("tilesetGridRemap", () => {
  const g32: TileGrid = { tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0, columns: 4, rows: 4 };
  const g16: TileGrid = { tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0, columns: 8, rows: 8 };

  it("maps by top-left pixel; misaligned or outside → null", () => {
    const down = tilesetGridRemap(g32, g16);
    expect([0, 1, 4, 5, 15].map(down)).toEqual([0, 2, 16, 18, 54]);
    const up = tilesetGridRemap(g16, g32);
    expect([0, 1, 2, 16, 17, 18, 63].map(up)).toEqual([0, null, 1, 4, null, 5, null]);
    // Same grid, wider image: pixels stay, ids follow the new column count.
    const wider = tilesetGridRemap(g32, { ...g32, columns: 6 });
    expect([0, 3, 4, 15].map(wider)).toEqual([0, 3, 6, 21]);
    // Shorter image: rows past the end are out of range.
    expect([11, 12].map(tilesetGridRemap(g32, { ...g32, rows: 3 }))).toEqual([11, null]);
    // Margin / spacing shift the origins.
    const spaced: TileGrid = { tileWidth: 16, tileHeight: 16, margin: 0, spacing: 16, columns: 4, rows: 4 };
    expect([0, 1, 2].map(tilesetGridRemap(g16, spaced))).toEqual([0, null, 1]);
    expect([0, 5].map(tilesetGridRemap(g32, { ...g32, margin: 32, columns: 2, rows: 2 }))).toEqual([null, 0]);
    expect([-1, 1.5].map(down)).toEqual([null, null]);
  });

  it("tilesetWithGrid / tilesetImageExtent", () => {
    expect(tilesetImageExtent(TILESET)).toEqual({ width: 256, height: 256 });
    expect(tilesetImageExtent({ ...g16, margin: 2, spacing: 1 })).toEqual({ width: 4 + 128 + 7, height: 4 + 128 + 7 });
    const t = tilesetWithGrid(TILESET, { tileWidth: 16, tileHeight: 24, margin: 0, spacing: 0 }, 256, 256);
    expect(t).toMatchObject({ tileWidth: 16, tileHeight: 24, columns: 16, rows: 10, id: "grass" });
  });
});
