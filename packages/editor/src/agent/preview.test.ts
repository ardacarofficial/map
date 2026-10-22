import { describe, expect, it, vi } from "vitest";
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
  it("does not scan empty collision cells across a large downscaled region", () => {
    const store = new MapStore(createDocument({ width: 4096, height: 4096, tileWidth: 2, tileHeight: 2 }));
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintGrid", layerId, cells: [{ x: 4095, y: 4095, value: 1 }] });
    const layer = store.document.layers[0]!, originalRead = layer.getCell.bind(layer);
    let reads = 0;
    const read = vi.spyOn(layer, "getCell").mockImplementation((x, y) => {
      if (++reads > 1024) throw Error("Preview scanned empty collision cells");
      return originalRead(x, y);
    });
    try {
      const result = renderPreviewPixels(store.document, { x: 0, y: 0, width: 4096, height: 4096 }, { maxSide: 64, layerIds: [layerId] }, () => undefined);
      expect(result.width).toBe(64);
      expect(pixel(result, 63, 63)).toEqual([109,52,59,255]);
      expect(reads).toBeLessThanOrEqual(1024);
    } finally { read.mockRestore(); }
  });
  it("keeps collision cells in row-major blend order across chunks and excludes cells outside the crop", () => {
    const store = new MapStore(createDocument({ width: 256, height: 64, tileWidth: 2, tileHeight: 2 }));
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
    // Insert the right chunk first, so insertion/chunk-major order would change the pixel.
    store.dispatch({ type: "paintGrid", layerId, cells: [
      { x: 32, y: 31, value: 1 }, { x: 31, y: 30, value: 1 },
      { x: 32, y: 30, value: 2 }, { x: 31, y: 31, value: 2 },
      { x: 30, y: 29, value: 1 }, { x: 30, y: 36, value: 1 },
    ] });
    const result = renderPreviewPixels(store.document, { x: 30, y: 30, width: 192, height: 6 }, { maxSide: 64, layerIds: [layerId] }, () => undefined);
    let expected = [36, 36, 36];
    for (const color of [[255,84,104], [92,178,255], [92,178,255], [255,84,104]])
      expected = expected.map((channel, i) => Math.round(color[i]! / 3 + channel * 2 / 3));
    expect(pixel(result, 0, 0)).toEqual([...expected, 255]);
    expect(pixel(result, 0, 1)).toEqual([36,36,36,255]);
  });
});
