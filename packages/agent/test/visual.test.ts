import { describe, expect, it } from "vitest";
import { FLIP_D, FLIP_H, FLIP_V, placedPixelSize, sourceToPlacedPixel, type RgbaImage, type Tileset } from "@smap/core";
import { AgentErrorCode } from "../src/contracts";
import { ExactReferenceSearch } from "../src/tools/visual";

const tileset: Tileset = { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: 2, tileHeight: 3, columns: 1, rows: 1, margin: 0, spacing: 0 };
const source: RgbaImage = { width: 2, height: 3, data: Uint8Array.from([10, 0, 0, 255, 20, 0, 0, 128, 30, 0, 0, 255, 40, 0, 0, 255, 50, 0, 0, 255, 60, 0, 0, 255]) };
function transformed(image: RgbaImage, orientation: number, scale = 1): RgbaImage {
  const flags = ((orientation & 1 ? FLIP_H : 0) | (orientation & 2 ? FLIP_V : 0) | (orientation & 4 ? FLIP_D : 0)) >>> 0;
  const size = placedPixelSize(image.width, image.height, flags);
  const result = { width: size.width * scale, height: size.height * scale, data: new Uint8Array(image.data.length * scale * scale) };
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const p = sourceToPlacedPixel({ x, y }, image.width, image.height, flags);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) result.data.set(image.data.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4), ((p.y * scale + dy) * result.width + p.x * scale + dx) * 4);
  }
  return result;
}
function search(reference: RgbaImage, topK = 8, checkpoint = async () => {}) {
  return new ExactReferenceSearch(reference, { topK, maxScale: 4, revision: 7, checkpoint });
}

describe("bounded exact visual reference matching", () => {
  for (let flags = 0; flags < 8; flags++) for (const scale of [1, 2, 3, 4]) it(`finds D4 ${flags} at integer scale ${scale}, including non-square extents`, async () => {
    const s = search(transformed(source, flags, scale));
    await s.addSource({ tileset, pixels: source });
    expect(s.result()).toEqual({ status: "matched", candidates: [{ tilesetId: "art", tileId: 0, region: { x: 0, y: 0, width: 1, height: 1 }, flags, scale, match: "exact_rgba" }], truncated: false, revision: 7 });
  });

  it("assembles multi-tile regions while excluding source margins and spacing", async () => {
    const t = { ...tileset, tileWidth: 2, tileHeight: 2, columns: 3, rows: 2, margin: 1, spacing: 1 };
    const pixels = { width: 10, height: 7, data: new Uint8Array(10 * 7 * 4).fill(223) };
    const reference = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) };
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const rgba = [x * 17, y * 31, x + y, 255];
      reference.data.set(rgba, (y * 4 + x) * 4);
      pixels.data.set(rgba, ((1 + Math.floor(y / 2) * 3 + y % 2) * 10 + 4 + Math.floor(x / 2) * 3 + x % 2) * 4);
    }
    const before = pixels.data.slice(), s = search(transformed(reference, 5, 2));
    await s.addSource({ tileset: t, pixels });
    expect(s.result().candidates).toEqual([{ tilesetId: "art", tileId: 1, region: { x: 1, y: 0, width: 2, height: 2 }, flags: 5, scale: 2, match: "exact_rgba" }]);
    expect(pixels.data).toEqual(before);
  });

  it("canonicalizes hidden RGB while keeping partial alpha exact", async () => {
    const pixels = { ...source, data: source.data.slice() }, reference = { ...source, data: source.data.slice() };
    pixels.data.set([90, 80, 70, 0], 0); reference.data.set([0, 0, 0, 0], 0);
    const s = search(reference); await s.addSource({ tileset, pixels }); expect(s.result().status).toBe("matched");
    reference.data[7] = 127;
    const changed = search(reference); await changed.addSource({ tileset, pixels }); expect(changed.result().status).toBe("no_match");
  });

  it("reports duplicate source ambiguity even when topK is one", async () => {
    const s = search(source, 1);
    await s.addSource({ tileset, pixels: source });
    await s.addSource({ tileset: { ...tileset, id: "duplicate" }, pixels: source });
    expect(s.result()).toMatchObject({ status: "ambiguous", truncated: true });
    expect(s.result().candidates).toHaveLength(1);
  });

  it("uses one canonical orientation for symmetric pixels", async () => {
    const pixels = { width: 2, height: 3, data: new Uint8Array(24) }, s = search(pixels);
    await s.addSource({ tileset, pixels });
    expect(s.result().status).toBe("matched");
    expect(s.result().candidates[0]!.flags).toBe(0);
  });

  it("never returns no_match after exhausting a work budget", async () => {
    const pixels = { width: 100001, height: 1, data: new Uint8Array(100001 * 4) };
    const s = search({ width: 1, height: 1, data: Uint8Array.of(1, 0, 0, 255) });
    await expect(s.addSource({ tileset: { ...tileset, tileWidth: 1, tileHeight: 1, columns: 100001 }, pixels })).rejects.toMatchObject({ code: AgentErrorCode.LIMIT_EXCEEDED });
  });

  it("yields cancellation checkpoints inside long atlas scans", async () => {
    let calls = 0;
    const pixels = { width: 1000, height: 1, data: new Uint8Array(4000) };
    const s = search({ width: 1, height: 1, data: Uint8Array.of(1, 0, 0, 255) }, 8, async () => { if (++calls === 2) throw Error("cancelled"); });
    await expect(s.addSource({ tileset: { ...tileset, tileWidth: 1, tileHeight: 1, columns: 1000 }, pixels })).rejects.toThrow("cancelled");
  });
});
