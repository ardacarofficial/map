/**
 * Pixel-exact PNG composite of a lettered tile in all eight orientations
 * (FLIP_H / FLIP_V / FLIP_D). The ops are replayed on a tiny software 2D
 * context that implements `setTransform` + nearest-neighbour `drawImage`
 * like a canvas with smoothing off, so the expected letters are checked
 * without a browser.
 */
import { createDocument, FLIP_D, FLIP_H, FLIP_V, layerDrawList, makeCell, MapStore, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { compositeOps, type Transform } from "./pngComposite";
import { replayOps, type Replay2D } from "./pngRender";

/** A fake image: one character per pixel. */
interface CharImage {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
}

/** Software canvas: nearest-neighbour sampling at pixel centres, source-over, one character per pixel. */
class CharCanvas implements Replay2D {
  globalAlpha = 1;
  imageSmoothingEnabled = true;
  readonly pixels: string[][];
  #m: Transform = [1, 0, 0, 1, 0, 0];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = Array.from({ length: height }, () => Array<string>(width).fill("."));
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.#m = [a, b, c, d, e, f];
  }

  drawImage(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
    const img = image as unknown as CharImage;
    const [a, b, c, d, e, f] = this.#m;
    const det = a * d - b * c;
    for (let py = 0; py < this.height; py++) {
      for (let px = 0; px < this.width; px++) {
        // Inverse transform of the pixel centre into tile-local space.
        const X = px + 0.5 - e;
        const Y = py + 0.5 - f;
        const u = (d * X - c * Y) / det;
        const v = (-b * X + a * Y) / det;
        if (u < dx || v < dy || u >= dx + dw || v >= dy + dh) continue;
        const ix = sx + Math.floor(((u - dx) * sw) / dw);
        const iy = sy + Math.floor(((v - dy) * sh) / dh);
        this.pixels[py]![px] = img.rows[iy]![ix]!;
      }
    }
  }

  text(): string[] {
    return this.pixels.map((row) => row.join(""));
  }
}

/**
 * Tileset image 9×5: margin 1, spacing 1, two 3×3 tiles. Tile 1 (the
 * second) is lettered; `#` is margin / spacing, `o` is tile 0.
 */
const IMAGE: CharImage = {
  width: 9,
  height: 5,
  rows: ["#########", "#ooo#abc#", "#ooo#def#", "#ooo#ghi#", "#########"],
};
const TILES: Tileset = {
  id: "letters",
  name: "Letters",
  imagePath: "tilesets/letters.png",
  tileWidth: 3,
  tileHeight: 3,
  columns: 2,
  rows: 1,
  margin: 1,
  spacing: 1,
};

/** Export flags (H=1, V=2, D=4) → cell bits. */
function cellBits(flags: number): number {
  return (flags & 1 ? FLIP_H : 0) | (flags & 2 ? FLIP_V : 0) | (flags & 4 ? FLIP_D : 0);
}

/** Composites one cell with `flags` at `scale` and returns the rows. */
function render(flags: number, scale = 1, tileset = TILES, image = IMAGE, cell = { w: 3, h: 3 }, map = { w: 1, h: 1 }): string[] {
  const store = new MapStore(createDocument({ width: map.w, height: map.h, tileWidth: cell.w, tileHeight: cell.h }));
  store.dispatch({ type: "addTileset", tileset });
  store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
  const p = store.getOrAddPaletteIndex(tileset.id, 1);
  store.dispatch({ type: "paintCells", layerId: "l", cells: [{ x: 0, y: map.h - 1, cell: makeCell(p, cellBits(flags)) }] });
  const list = layerDrawList(store.document);
  const canvas = new CharCanvas(list.width * scale, list.height * scale);
  replayOps(canvas, compositeOps(list, scale), () => image as unknown as CanvasImageSource);
  return canvas.text();
}

/** Expected letters for each export flag value (index). Written by hand, not derived. */
const EXPECTED: readonly (readonly string[])[] = [
  ["abc", "def", "ghi"], // 0 as drawn
  ["cba", "fed", "ihg"], // 1 H
  ["ghi", "def", "abc"], // 2 V
  ["ihg", "fed", "cba"], // 3 H+V = 180°
  ["adg", "beh", "cfi"], // 4 D = transpose
  ["gda", "heb", "ifc"], // 5 D+H = 90° clockwise
  ["cfi", "beh", "adg"], // 6 D+V = 90° counter-clockwise
  ["ifc", "heb", "gda"], // 7 D+H+V = anti-transpose
];

describe("PNG composite orientation (pixel-exact)", () => {
  for (let flags = 0; flags < 8; flags++) {
    it(`flags ${flags}`, () => {
      expect(render(flags)).toEqual(EXPECTED[flags]);
    });
  }

  it("keeps every orientation pixel-exact at 2× scale", () => {
    for (let flags = 0; flags < 8; flags++) {
      const doubled = EXPECTED[flags]!.flatMap((row) => {
        const wide = [...row].map((ch) => ch + ch).join("");
        return [wide, wide];
      });
      expect(render(flags, 2)).toEqual(doubled);
    }
  });

  it("transposes a non-square tile into a rectangle anchored bottom-left of its cell", () => {
    // 2×3 tile (tile 1 of a 2-column tileset, no margin) on a 2×2 cell, map 3×2 cells.
    const image: CharImage = { width: 4, height: 3, rows: ["ooab", "oocd", "ooef"] };
    const tall: Tileset = { ...TILES, id: "tall", tileWidth: 2, tileHeight: 3, margin: 0, spacing: 0 };
    const cell = { w: 2, h: 2 };
    const map = { w: 3, h: 2 };
    // As drawn: 2 wide, 3 tall, bottom on the map's bottom edge.
    expect(render(0, 1, tall, image, cell, map)).toEqual(["......", "ab....", "cd....", "ef...."]);
    // 90° clockwise: 3 wide, 2 tall, still bottom-left.
    expect(render(5, 1, tall, image, cell, map)).toEqual(["......", "......", "eca...", "fdb..."]);
    // 90° counter-clockwise.
    expect(render(6, 1, tall, image, cell, map)).toEqual(["......", "......", "bdf...", "ace..."]);
  });
});
