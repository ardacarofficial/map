import { describe, expect, it } from "vitest";
import { createDocument, MapStore, makeCell, FLIP_H, FLIP_D } from "@smap/core";
import { renderPreviewPixels } from "./preview";
const tileset = { id: "art", name: "art", imagePath: "tilesets/art.png", tileWidth: 2, tileHeight: 2, columns: 1, rows: 1, margin: 0, spacing: 0 };
const art = { width: 2, height: 2, data: new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]) };
function doc(flags = 0) {
  const store = new MapStore(createDocument({ width: 3, height: 2, tileWidth: 2, tileHeight: 2, tilesets: [tileset] }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const index = store.getOrAddPaletteIndex("art", 0);
  store.dispatch({ type: "paintCells", layerId, cells: [{ x: 1, y: 0, cell: makeCell(index, flags) }] });
  return store.document;
}
const pixel = (image: { width: number; data: Uint8Array | Uint8ClampedArray }, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x + 1) * 4)];
describe("agent preview replay", () => {
  it("crops in map coordinates and preserves Tiled diagonal then horizontal orientation", () => {
    const result = renderPreviewPixels(doc(FLIP_H | FLIP_D), { x: 1, y: 0, width: 1, height: 1 }, { maxSide: 256 }, () => art);
    expect(result.image.pixelOrigin).toEqual({ x: 2, y: 0 });
    expect(result.image.cellSize).toEqual({ width: 2, height: 2 });
    expect(pixel(result, 0, 0)).toEqual([0,0,255,255]);
    expect(pixel(result, 1, 0)).toEqual([255,0,0,255]);
    expect(pixel(result, 0, 1)).toEqual([255,255,255,255]);
    expect(pixel(result, 1, 1)).toEqual([0,255,0,255]);
  });
  it("puts numeric coordinates in separate gutters and confines grid lines to content", () => {
    const result = renderPreviewPixels(doc(), { x: 1, y: 0, width: 2, height: 2 }, { grid: true, coordinates: true, maxSide: 256 }, () => art);
    expect(result.image.contentRect.x).toBeGreaterThan(0);
    expect(result.image.contentRect.y).toBeGreaterThan(0);
    const content = result.image.contentRect;
    expect(pixel(result, content.x + 1, content.y + 1)).toEqual([255,255,255,255]);
    const gutterColors = new Set<string>();
    for (let y = 0; y < content.y; y++) for (let x = 0; x < result.width; x++) gutterColors.add(pixel(result, x, y).join(","));
    expect(gutterColors.size).toBeGreaterThan(1); // Label ink, not an empty padding strip.
  });
  it("clips oversized tiles that originate outside the requested region", () => {
    const result = renderPreviewPixels(doc(), { x: 0, y: 0, width: 1, height: 1 }, { maxSide: 256 }, () => art);
    expect(pixel(result, 0, 0)).not.toEqual([255,0,0,255]);
    expect(result.width).toBe(2);
  });
});
