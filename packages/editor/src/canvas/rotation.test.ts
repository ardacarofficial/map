import { CHUNK_AREA, FLIP_D, FLIP_H, FLIP_V, makeCell } from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildCellQuads, buildChunkQuads } from "./chunkGeometry";
import { canRotateTiles, flipFlags, quadUvs, rotateFlags, sourcePoint } from "./rotation";
import { compositeChunk } from "./thumbnailRaster";

const ALL = [0, FLIP_H, FLIP_V, FLIP_D, FLIP_H | FLIP_V, FLIP_H | FLIP_D, FLIP_V | FLIP_D, FLIP_H | FLIP_V | FLIP_D].map((f) => f >>> 0);
const flagsArb = fc.constantFrom(...ALL);
const SAMPLES: [number, number][] = [
  [0.125, 0.375],
  [0.875, 0.25],
  [0.625, 0.75],
];

describe("flip bits", () => {
  it("all 8 orientations draw differently", () => {
    const seen = new Set(ALL.map((f) => SAMPLES.map(([s, t]) => sourcePoint(f, s, t).join(",")).join(";")));
    expect(seen.size).toBe(8);
  });

  it("a clockwise turn shows what the old cell showed at the point turned back", () => {
    // Turning the drawn picture 90° cw: new(s, t) = old(t, 1 - s).
    for (const f of ALL) {
      const cw = rotateFlags(f, "cw");
      const ccw = rotateFlags(f, "ccw");
      for (const [s, t] of SAMPLES) {
        expect(sourcePoint(cw, s, t)).toEqual(sourcePoint(f, t, 1 - s));
        expect(sourcePoint(ccw, s, t)).toEqual(sourcePoint(f, 1 - t, s));
      }
    }
  });

  it("mirrors show the old cell mirrored", () => {
    for (const f of ALL) {
      for (const [s, t] of SAMPLES) {
        expect(sourcePoint(flipFlags(f, "x"), s, t)).toEqual(sourcePoint(f, 1 - s, t));
        expect(sourcePoint(flipFlags(f, "y"), s, t)).toEqual(sourcePoint(f, s, 1 - t));
      }
    }
  });

  it("four turns, cw then ccw, and two mirrors are the identity", () => {
    fc.assert(
      fc.property(flagsArb, fc.constantFrom<"cw" | "ccw">("cw", "ccw"), (f, dir) => {
        let g = f;
        for (let i = 0; i < 4; i++) g = rotateFlags(g, dir);
        expect(g).toBe(f);
        expect(rotateFlags(rotateFlags(f, "cw"), "ccw")).toBe(f);
        expect(flipFlags(flipFlags(f, "x"), "x")).toBe(f);
        // Two turns = both mirrors.
        expect(rotateFlags(rotateFlags(f, "cw"), "cw")).toBe(flipFlags(flipFlags(f, "x"), "y"));
      }),
    );
  });

  it("only square tiles turn", () => {
    expect(canRotateTiles(32, 32)).toBe(true);
    expect(canRotateTiles(32, 16)).toBe(false);
  });
});

describe("FLIP_D drawing", () => {
  const src = { group: 0, u0: 0, v0: 0, u1: 1, v1: 1 };

  it("transposes the UVs: TR samples BL of the tile, BL samples TR", () => {
    // TL, TR, BR, BL as [u, v].
    expect(quadUvs(src, FLIP_D)).toEqual([0, 0, 0, 1, 1, 1, 1, 0]);
    expect(quadUvs(src, 0)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    // cw turn of an unflipped tile: the top-left corner shows the tile's bottom-left.
    expect(quadUvs(src, rotateFlags(0, "cw")).slice(0, 2)).toEqual([0, 1]);
  });

  it("chunk meshes and preview quads use the same corners", () => {
    const data = new Uint32Array(CHUNK_AREA);
    for (let i = 0; i < ALL.length; i++) data[i] = makeCell(1, ALL[i]);
    const [b] = buildChunkQuads(data, 16, 16, () => src);
    const [p] = buildCellQuads(ALL.map((flags, i) => ({ x: i, y: 0, flags, src })), 16, 16);
    for (let i = 0; i < ALL.length; i++) {
      expect(Array.from(b!.uvs.slice(i * 8, i * 8 + 8))).toEqual(quadUvs(src, ALL[i]!));
      expect(Array.from(p!.uvs.slice(i * 8, i * 8 + 8))).toEqual(quadUvs(src, ALL[i]!));
    }
  });

  it("the thumbnail raster transposes the tile's pixels", () => {
    // 2×2 tile: red, green / blue, white (row-major).
    const tile = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const data = new Uint32Array(CHUNK_AREA);
    data[0] = makeCell(1, FLIP_D);
    data[1] = makeCell(1, rotateFlags(0, "cw"));
    const out = compositeChunk([{ data, opacity: 1 }], 2, () => tile);
    const side = 64;
    const at = (x: number, y: number) => Array.from(out.slice((y * side + x) * 4, (y * side + x) * 4 + 3));
    // Transposed: green moves to the bottom-left, blue to the top-right.
    expect([at(0, 0), at(1, 0), at(0, 1), at(1, 1)]).toEqual([[255, 0, 0], [0, 0, 255], [0, 255, 0], [255, 255, 255]]);
    // Turned cw: top row = blue, red; bottom row = white, green.
    expect([at(2, 0), at(3, 0), at(2, 1), at(3, 1)]).toEqual([[0, 0, 255], [255, 0, 0], [255, 255, 255], [0, 255, 0]]);
  });
});
