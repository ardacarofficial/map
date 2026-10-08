import type { Tileset } from "@smap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyTilesOf } from "./emptyTiles";

const grid = (w: number, h: number, size: number): Tileset => ({
  id: "ts",
  name: "TS",
  imagePath: "tilesets/ts.png",
  tileWidth: size,
  tileHeight: size,
  columns: Math.floor(w / size),
  rows: Math.floor(h / size),
  margin: 0,
  spacing: 0,
});

/** Canvas stand-ins (OffscreenCanvas and `document.createElement("canvas")`) with transparent pixels; logs every pixel read. */
function stubCanvas() {
  const reads: [number, number][] = [];
  class FakeCanvas {
    constructor(
      public width = 0,
      public height = 0,
    ) {}
    getContext() {
      return {
        drawImage() {},
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          reads.push([w, h]);
          return { data: new Uint8ClampedArray(w * h * 4) };
        },
      };
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  vi.stubGlobal("document", { createElement: () => new FakeCanvas() });
  return reads;
}

afterEach(() => vi.unstubAllGlobals());

describe("emptyTilesOf", () => {
  it("finds the transparent tiles of a normal sheet", () => {
    const reads = stubCanvas();
    const bitmap = { width: 64, height: 32 } as ImageBitmap;
    expect(emptyTilesOf(grid(64, 32, 16), bitmap).size).toBe(8);
    expect(reads).toEqual([[64, 32]]);
  });

  // Bug: the panel scanned any sheet on the main thread during render; an 8192² atlas meant
  // ~600 MB of pixel copies and summed-area tables and a multi-second freeze (or a crashed tab).
  it("does not scan a huge sheet (same cap as the import card)", () => {
    const reads = stubCanvas();
    const bitmap = { width: 8192, height: 8192 } as ImageBitmap;
    expect(emptyTilesOf(grid(8192, 8192, 32), bitmap).size).toBe(0);
    expect(reads).toEqual([]);
  });
});
