import { describe, expect, it } from "vitest";
import { FLIP_D, FLIP_H, FLIP_V, makeCell, nineSliceLayout, orientPoint, type Stamp, type Tileset } from "@smap/core";
import { rasterizeSmartStamp, type PixelImage } from "./smartStampBake";

const stamp = (flags = 0): Stamp => ({ id: "road", name: "Road", width: 3, height: 3, palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: "source", tileId })), layers: [{ layerId: "ground", name: "Ground", cells: Uint32Array.from({ length: 9 }, (_, i) => makeCell(i + 1, flags)) }] });
const sheet = (size: number): Tileset => ({ id: "source", name: "Source", imagePath: "tilesets/source.png", columns: 3, rows: 3, margin: 0, spacing: 0, tileWidth: size, tileHeight: size });
const source = (size: number): PixelImage => {
  const width = size * 3, data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) data.set([x, y, (x * 9 + y) % 255, (x + y) % 3 ? 127 : 0], (y * width + x) * 4);
  return { width, height: width, data };
};
const pixel = (p: PixelImage, x: number, y: number) => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];
describe("smart stamp bake", () => {
  it.each([0, FLIP_H, FLIP_V, FLIP_D, (FLIP_H | FLIP_V | FLIP_D) >>> 0])("a cropped, offset source gives identical assembly pixels with flags %s", flags => {
    const ts = { ...sheet(3), columns: 8, rows: 8, margin: 0, spacing: 0 }, width = 24;
    const data = Uint8ClampedArray.from({ length: width * width * 4 }, (_, i) => (i * 37) % 256);
    const original = { width, height: width, data }, cropped = new Uint8ClampedArray(9 * 9 * 4);
    for (let y = 0; y < 9; y++) cropped.set(data.subarray(((y + 9) * width + 6) * 4, ((y + 9) * width + 15) * 4), y * 9 * 4);
    const s = { ...stamp(flags), palette: stamp().palette.map((e, i) => ({ ...e, tileId: 2 + i % 3 + (3 + Math.floor(i / 3)) * 8 })) };
    const target = { ...ts, id: "generated", columns: 8, rows: 8 };
    const full = rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels: original }]]));
    expect(rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels: { width: 9, height: 9, data: cropped, originX: 6, originY: 9 } }]]))).toEqual(full);
  });
  it.each([0, FLIP_H, FLIP_V, FLIP_H | FLIP_V, FLIP_D, (FLIP_D | FLIP_H) >>> 0, (FLIP_D | FLIP_V) >>> 0, (FLIP_H | FLIP_V | FLIP_D) >>> 0])("word copies match the legacy byte path in every slot with flags %s", flags => {
    for (const size of [1, 3, 4, 5]) {
      const ts = sheet(size), pixels = source(size), s = stamp(flags), target = { ...ts, columns: 8, rows: 8 };
      const unaligned = new Uint8Array(new ArrayBuffer(pixels.data.length + 1), 1); unaligned.set(pixels.data);
      const legacy = rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels: { ...pixels, data: unaligned } }]]));
      expect(rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels }]]))).toEqual(legacy);
    }
  });
  for (const size of [1, 3, 4, 5]) for (const flags of [0, FLIP_H, FLIP_V, FLIP_D, (FLIP_H | FLIP_V | FLIP_D) >>> 0]) {
    it(`copies all source slots exactly with alpha, size ${size}, flags ${flags}`, () => {
      const ts = sheet(size), pixels = source(size), s = stamp(flags), target = { ...ts, id: "generated", columns: 8, rows: 8 };
      const before = new Uint8ClampedArray(pixels.data);
      const p = rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels }]]));
      for (let id = 0; id < 9; id++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const q = orientPoint({ x, y }, size, size, flags);
        expect(pixel(p, (id % 8) * size + q.x, Math.floor(id / 8) * size + q.y)).toEqual(pixel(pixels, (id % 3) * size + x, Math.floor(id / 3) * size + y));
      }
      expect(pixels.data).toEqual(before);
      expect(rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels }]]))).toEqual(p);
    });
  }
  it("splices compact caps at floor(size/2), with stable row-major slots and transparent trailing capacity", () => {
    const size = 5, ts = sheet(size), pixels = source(size), s = stamp(), target = { ...ts, columns: 8, rows: 8 };
    const p = rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels }]])), layout = nineSliceLayout(s);
    const at = (slot: number, x: number, y: number) => pixel(p, (slot % 8) * size + x, Math.floor(slot / 8) * size + y);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      expect(at(layout.collapsedWidth, x, y)).toEqual(pixel(pixels, x < 2 ? x : 2 * size + x, y));
      expect(at(layout.isolated, x, y)).toEqual(pixel(pixels, x < 2 ? x : 2 * size + x, y < 2 ? y : 2 * size + y));
    }
    for (let slot = layout.slots; slot < 64; slot++) expect(at(slot, 0, 0)).toEqual([0, 0, 0, 0]);
  });
  it("fails before publishing anything when a source is missing or its grid no longer fits", () => {
    const ts = sheet(4), s = stamp();
    expect(() => rasterizeSmartStamp(s, "ground", { ...ts, columns: 8, rows: 8 }, new Map())).toThrow("Missing source");
    expect(() => rasterizeSmartStamp(s, "ground", { ...ts, columns: 8, rows: 8 }, new Map([[ts.id, { tileset: ts, pixels: source(3) }]]))).toThrow("does not fit");
  });
});
