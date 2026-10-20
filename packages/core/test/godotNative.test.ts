import { decode, encode } from "fast-png";
import { describe, expect, it } from "vitest";
import { createDocument, exportGodot, FLIP_D, FLIP_H, FLIP_V, makeCell, MapStore, preflightGodot, type Tileset } from "../src";
import { decodePng } from "./png";

function fixture(width: number, height: number, cell = 32) {
  const tileset: Tileset = { id: "art", name: "Art", imagePath: "art.png", tileWidth: width, tileHeight: height, columns: 2, rows: 2, margin: 1, spacing: 2 };
  const store = new MapStore(createDocument({ width: 16, height: 4, tileWidth: cell, tileHeight: cell, tilesets: [tileset] }));
  store.dispatch({ type: "addLayer", layer: { id: "a", name: "Art" } });
  store.dispatch({ type: "paintCells", layerId: "a", cells: Array.from({ length: 8 }, (_, i) => ({ x: i * 2, y: 2, cell: makeCell(store.getOrAddPaletteIndex("art", 3), (i & 1 ? FLIP_H : 0) | (i & 2 ? FLIP_V : 0) | (i & 4 ? FLIP_D : 0)) })) });
  const sw = 2 * width + 4, sh = 2 * height + 4;
  const data = new Uint8Array(sw * sh * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([x, y, 19, 117], ((height + 3 + y) * sw + width + 3 + x) * 4);
  const bytes = encode({ width: sw, height: sh, data, channels: 4, depth: 8 });
  return { store, bytes, maps: [{ doc: store.document, name: "native" }] };
}

describe("Godot native-size artwork", () => {
  it.each([[16,16], [16,48], [48,16], [48,64], [17,35]])("preserves %ix%i native samples and bottom-left anchors for every D4 orientation", (width, height) => {
    const { maps, bytes } = fixture(width!, height!);
    const before = bytes.slice();
    expect(preflightGodot(maps, () => bytes)).toEqual([]);
    const plan = exportGodot(maps, () => bytes);
    expect(exportGodot(maps, () => bytes)).toEqual(plan);
    expect(bytes).toEqual(before);
    const png = decodePng((plan.files.find(f => f.path.includes("/godot/")) ?? plan.files.find(f => f.bytes))!.bytes!);
    expect(plan.files.find(f => f.path === "smap/native/art.png")!.bytes).toEqual(bytes);
    const tres = plan.files.find(f => f.path.endsWith(".tres"))!.text!;
    const region = /texture_region_size = Vector2i\((\d+), (\d+)\)/.exec(tres)!;
    const rw = Number(region[1]), rh = Number(region[2]);
    const padded = rw !== width || rh !== height;
    if (padded) {
      expect(png.width).toBe(2 * rw); expect(png.height).toBe(2 * rh);
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
        const at = ((rh + y) * png.width + rw + x) * 4;
        expect([...png.data.slice(at, at + 4)]).toEqual(x < width! && y >= rh - height! ? [x, y - rh + height!, 19, 117] : [0,0,0,0]);
      }
    } else expect(plan.files.find(f => f.bytes)!.bytes).toEqual(bytes);
    for (let flags = 0; flags < 8; flags++) {
      const origin = new RegExp(`1:1/${flags}/texture_origin = Vector2i\\((-?\\d+), (-?\\d+)\\)`).exec(tres)!;
      expect(origin).not.toBeNull();
      const ox = Number(origin[1]), oy = Number(origin[2]);
      // Independent bounding-box oracle: transform all native pixels inside the
      // padded region, then apply Godot's centred rectangle and TileData origin.
      const points: number[][] = [];
      for (const [x, y] of [[0,0], [width! - 1,0], [0,height! - 1], [width! - 1,height! - 1]]) {
        let u = x!, v = y! + rh - height!, w = rw, h = rh;
        if (flags & 4) { [u,v] = [v,u]; [w,h] = [h,w]; }
        if (flags & 1) u = w - 1 - u;
        if (flags & 2) v = h - 1 - v;
        points.push([16 - w / 2 - ox + u, 16 - h / 2 - oy + v]);
      }
      expect(Math.min(...points.map(p => p[0]!))).toBe(0);
      expect(Math.max(...points.map(p => p[1]!))).toBe(31);
    }
  });

  it("preserves RGB transparency and colour interpretation while padding", () => {
    const { maps } = fixture(16,16);
    const base = encode({ width: 36, height: 36, data: new Uint8Array(36 * 36 * 3).fill(17), channels: 3, depth: 8 });
    const gamma = pngChunk("gAMA", new Uint8Array([0,0,177,143]));
    const trns = pngChunk("tRNS", new Uint8Array([0,17,0,17,0,17]));
    const bytes = new Uint8Array(base.length + gamma.length + trns.length);
    bytes.set(base.subarray(0,33)); bytes.set(gamma,33); bytes.set(trns,33 + gamma.length); bytes.set(base.subarray(33),33 + gamma.length + trns.length);
    const output = exportGodot(maps, () => bytes).files.find(f => f.path.includes("/godot/"))!.bytes!;
    expect(output.slice(33,33 + gamma.length)).toEqual(gamma);
    const image = decode(output, { checkCrc: true });
    expect([...image.data.slice((48 * 64 + 32) * 4, (48 * 64 + 32) * 4 + 4)]).toEqual([17,17,17,0]);
    const broken = bytes.slice(); broken[broken.length - 1] = broken.at(-1)! ^ 1;
    expect(preflightGodot(maps, () => broken).map(p => p.key)).toContain("godotExport.invalidImage");
  });

  it("pads palette transparency and 16-bit samples without quantizing", () => {
    const { maps } = fixture(16,16);
    for (const bytes of [
      indexedPng(),
      encode({ width: 36, height: 36, data: new Uint16Array(36 * 36 * 4).fill(12345), channels: 4, depth: 16 }),
    ]) {
      const plan = exportGodot(maps, () => bytes);
      const padded = decode(plan.files.find(f => f.path.includes("/godot/"))!.bytes!, { checkCrc: true });
      expect([...padded.data.slice((48 * 64 + 32) * 4, (48 * 64 + 32) * 4 + 4)]).toEqual(padded.depth === 16 ? [12345,12345,12345,12345] : [21,42,63,77]);
      expect([...padded.data.slice(0,4)]).toEqual([0,0,0,0]);
    }
  });
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set([...type].map(c => c.charCodeAt(0)), 4); result.set(data, 8);
  let crc = 0xffffffff;
  for (const n of result.subarray(4, 8 + data.length)) {
    crc ^= n;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return result;
}
function indexedPng(): Uint8Array {
  const base = encode({ width: 36, height: 36, data: new Uint8Array(36 * 36).fill(1), channels: 1, depth: 8, palette: [[255,0,0],[21,42,63]] });
  // The codec writes PLTE, but not palette alpha. Insert tRNS independently.
  const trns = pngChunk("tRNS", new Uint8Array([255,77]));
  const at = 33 + 12 + 6; // IHDR and two-entry PLTE.
  const result = new Uint8Array(base.length + trns.length);
  result.set(base.subarray(0,at)); result.set(trns,at); result.set(base.subarray(at),at + trns.length);
  return result;
}
