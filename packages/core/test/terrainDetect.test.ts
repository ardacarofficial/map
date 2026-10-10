import { describe, expect, it } from "vitest";
import { detectTerrainBlock, type RgbaImage, type TerrainTemplate, type Tileset } from "../src";
import { embedImage, loadSample } from "./png";

function tilesetFor(image: RgbaImage, id = "t"): Tileset {
  return { id, name: id, imagePath: `tilesets/${id}.png`, tileWidth: 32, tileHeight: 32, columns: image.width / 32, rows: image.height / 32, margin: 0, spacing: 0 };
}

const CASES: { file: string; template: TerrainTemplate; cols: number; rows: number }[] = [
  { file: "blob47-godot-32.png", template: "blob47-godot", cols: 12, rows: 4 },
  { file: "blob47-cr31-32.png", template: "blob47-cr31", cols: 7, rows: 7 },
  { file: "wang16-32.png", template: "corner16", cols: 4, rows: 4 },
];

describe("detectTerrainBlock", () => {
  const filler = loadSample("overworld-32.png");
  for (const c of CASES) {
    it(`finds ${c.template} in ${c.file} (exact selection)`, () => {
      const image = loadSample(c.file);
      const result = detectTerrainBlock(tilesetFor(image), image, { col: 0, row: 0, columns: c.cols, rows: c.rows });
      expect(result[0]!.template).toBe(c.template);
      expect(result[0]!.origin).toEqual({ col: 0, row: 0 });
    });

    for (const [dc, dr, w, h] of [
      [1, 0, 0, 0],
      [-1, -1, 0, 0],
      [0, 1, -1, 0],
      [1, 1, 1, 1],
      [-1, 0, 2, -1],
    ] as const) {
      it(`finds ${c.template} embedded at (2, 2) with a rough rect off by (${dc}, ${dr}, ${w}, ${h})`, () => {
        const image = embedImage(loadSample(c.file), 32, 2, 2, c.cols + 5, c.rows + 4, filler);
        const result = detectTerrainBlock(tilesetFor(image), image, { col: 2 + dc, row: 2 + dr, columns: c.cols + w, rows: c.rows + h });
        expect(result[0]!.template).toBe(c.template);
        expect(result[0]!.origin).toEqual({ col: 2, row: 2 });
        expect(result[0]!.score).toBeGreaterThan(0.8);
      });
    }
  }

  it("scores a tileset without a terrain block low", () => {
    const image = loadSample("overworld-32.png");
    const result = detectTerrainBlock(tilesetFor(image), image, { col: 0, row: 0, columns: 8, rows: 8 });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.score).toBeLessThan(0.8);
  });

  it("returns nothing when no template fits the tileset", () => {
    const image = loadSample("dungeon-16.png");
    const tileset = { ...tilesetFor(image), tileWidth: 16, tileHeight: 16, columns: 6, rows: 4 };
    expect(detectTerrainBlock(tileset, image, { col: 0, row: 0, columns: 6, rows: 4 }, { templates: ["blob47-cr31"] })).toEqual([]);
  });
});
