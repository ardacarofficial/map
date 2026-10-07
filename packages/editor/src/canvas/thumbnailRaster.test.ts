import { CHUNK_AREA, FLIP_H, makeCell } from "@smap/core";
import { describe, expect, it } from "vitest";

import { compositeChunk, tileThumb, type Pixels } from "./thumbnailRaster";

function solid(w: number, h: number, rgba: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, width: w, height: h };
}

const px = (out: Uint8ClampedArray, side: number, x: number, y: number) => Array.from(out.slice((y * side + x) * 4, (y * side + x) * 4 + 4));

describe("tileThumb", () => {
  it("box-filters with alpha weighting", () => {
    // 4×4 tile: left half opaque red, right half transparent.
    const src = solid(4, 4, [255, 0, 0, 255]);
    for (let y = 0; y < 4; y++) for (let x = 2; x < 4; x++) src.data.set([0, 0, 0, 0], (y * 4 + x) * 4);
    expect(Array.from(tileThumb(src, { x: 0, y: 0, width: 4, height: 4 }, 1))).toEqual([255, 0, 0, 128]);
    const k2 = tileThumb(src, { x: 0, y: 0, width: 4, height: 4 }, 2);
    expect(px(k2, 2, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(k2, 2, 1, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe("compositeChunk", () => {
  const blocks = new Map<number, Uint8ClampedArray>([
    [1, new Uint8ClampedArray([255, 0, 0, 255])],
    [2, new Uint8ClampedArray([0, 0, 255, 255])],
  ]);

  it("draws cells at k px per cell, top layer over bottom, with layer opacity", () => {
    const bottom = new Uint32Array(CHUNK_AREA);
    const top = new Uint32Array(CHUNK_AREA);
    bottom[0] = makeCell(1);
    bottom[1] = makeCell(1);
    top[1] = makeCell(2);
    const out = compositeChunk([{ data: bottom, opacity: 1 }, { data: top, opacity: 0.5 }, { data: undefined, opacity: 1 }], 1, (i) => blocks.get(i));
    expect(px(out, 32, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out, 32, 1, 0)).toEqual([128, 0, 128, 255]);
    expect(px(out, 32, 2, 0)).toEqual([0, 0, 0, 0]);
  });

  it("honours horizontal flips of k×k blocks", () => {
    const b = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]); // 2×2: red | green
    const data = new Uint32Array(CHUNK_AREA);
    data[0] = makeCell(1, FLIP_H);
    const out = compositeChunk([{ data, opacity: 1 }], 2, () => b);
    expect(px(out, 64, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(px(out, 64, 1, 0)).toEqual([255, 0, 0, 255]);
  });

  it("hidden (opacity 0) layers and undrawable tiles leave pixels empty", () => {
    const data = new Uint32Array(CHUNK_AREA);
    data[5] = makeCell(1);
    data[6] = makeCell(9);
    expect(px(compositeChunk([{ data, opacity: 0 }], 1, (i) => blocks.get(i)), 32, 5, 0)).toEqual([0, 0, 0, 0]);
    expect(px(compositeChunk([{ data, opacity: 1 }], 1, (i) => blocks.get(i)), 32, 6, 0)).toEqual([0, 0, 0, 0]);
  });
});
