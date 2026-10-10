/**
 * Minimal PNG decoder for tests (no dependencies; node:zlib for inflate).
 * Supports 8-bit, non-interlaced greyscale, RGB, palette, grey+alpha and RGBA.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import type { RgbaImage } from "../src";

export function decodePng(bytes: Uint8Array): RgbaImage {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error("not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos < bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = view.getUint32(16);
      height = view.getUint32(20);
      if (body[8] !== 8) throw new Error("only 8-bit PNGs");
      colorType = body[9]!;
      if (body[12] !== 0) throw new Error("interlaced PNG");
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`color type ${colorType}`);
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of idat) {
    joined.set(c, at);
    at += c.length;
  }
  const raw = inflateSync(joined);
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let v = line[i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = v & 255;
    }
    prev = out;
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (colorType === 6) data.set(pixels.subarray(o, o + 4), o);
    else if (colorType === 2) {
      data.set(pixels.subarray(i * 3, i * 3 + 3), o);
      data[o + 3] = 255;
    } else if (colorType === 0 || colorType === 4) {
      const g = pixels[i * channels]!;
      data[o] = data[o + 1] = data[o + 2] = g;
      data[o + 3] = colorType === 4 ? pixels[i * 2 + 1]! : 255;
    } else {
      const idx = pixels[i]!;
      data[o] = palette![idx * 3]!;
      data[o + 1] = palette![idx * 3 + 1]!;
      data[o + 2] = palette![idx * 3 + 2]!;
      data[o + 3] = trns && idx < trns.length ? trns[idx]! : 255;
    }
  }
  return { width, height, data };
}

/** Decodes `samples/tilesets/<name>` of the repository. */
export function loadSample(name: string): RgbaImage {
  let dir = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/\/[^/]*$/, "");
  if (/^\/[A-Za-z]:/.test(dir)) dir = dir.slice(1);
  return decodePng(readFileSync(`${dir}/../../../samples/tilesets/${name}`));
}

/**
 * `image` pasted into a bigger canvas at tile offset (`dx`, `dy`); the
 * border is filled with tiles copied from `filler` (cycled), like a real
 * tileset where the terrain block sits among other tiles.
 */
export function embedImage(image: RgbaImage, tile: number, dx: number, dy: number, cols: number, rows: number, filler: RgbaImage): RgbaImage {
  const width = cols * tile;
  const height = rows * tile;
  const data = new Uint8Array(width * height * 4);
  const fillerCols = Math.floor(filler.width / tile);
  const fillerCount = fillerCols * Math.floor(filler.height / tile);
  let next = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const inside = tx >= dx && ty >= dy && tx < dx + image.width / tile && ty < dy + image.height / tile;
      const src = inside ? image : filler;
      let sx: number;
      let sy: number;
      if (inside) {
        sx = (tx - dx) * tile;
        sy = (ty - dy) * tile;
      } else {
        const f = next++ % fillerCount;
        sx = (f % fillerCols) * tile;
        sy = Math.floor(f / fillerCols) * tile;
      }
      for (let y = 0; y < tile; y++) {
        const from = ((sy + y) * src.width + sx) * 4;
        data.set(src.data.subarray(from, from + tile * 4), ((ty * tile + y) * width + tx * tile) * 4);
      }
    }
  }
  return { width, height, data };
}
