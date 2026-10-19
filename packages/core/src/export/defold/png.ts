import { decode, encode } from "fast-png";
import type { Tileset } from "../../tileset";

/** Defold's margin surrounds EVERY tile, unlike the editor's one outer
 * margin. Crop only the exported copy's outer border and use native margin 0.
 * Keep samples, depth, palette, transparency and colour interpretation intact.
 * No canvas, resampling, quantization or changes to source PNG bytes.
 */
export function defoldPng(bytes: Uint8Array, tileset: Tileset): Uint8Array {
  if (tileset.margin === 0) return bytes.slice();
  const source = decode(bytes, { checkCrc: true });
  const { margin, columns, rows, tileWidth, tileHeight, spacing } = tileset;
  const width = columns * tileWidth + (columns - 1) * spacing;
  const height = rows * tileHeight + (rows - 1) * spacing;
  if (margin + width > source.width || margin + height > source.height) throw new Error("PNG grid exceeds image");
  const { channels, depth } = source;
  const stride = depth < 8 ? Math.ceil(width * depth / 8) : width * channels;
  const data = depth === 16 ? new Uint16Array(stride * height) : new Uint8Array(stride * height);
  if (depth < 8) {
    const sourceStride = Math.ceil(source.width * depth / 8);
    const mask = (1 << depth) - 1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const bit = (x + margin) * depth;
      const sample = source.data[(y + margin) * sourceStride + (bit >> 3)]! >> (8 - depth - (bit & 7)) & mask;
      const to = y * stride + ((x * depth) >> 3);
      data[to] = data[to]! | sample << (8 - depth - ((x * depth) & 7));
    }
  } else for (let y = 0; y < height; y++) {
    const from = ((y + margin) * source.width + margin) * channels;
    data.set(source.data.subarray(from, from + stride), y * stride);
  }
  const output = encode({ width, height, data, depth, channels, ...(source.palette ? { palette: source.palette } : {}) });
  return preserveColourChunks(bytes, output);
}

interface PngChunk { type: string; bytes: Uint8Array }
function chunks(bytes: Uint8Array): PngChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: PngChunk[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at), end = at + length + 12;
    if (end > bytes.length) throw new Error("Invalid PNG chunk");
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    result.push({ type, bytes: bytes.subarray(at, end) });
    at = end;
  }
  return result;
}

/** The codec keeps raw samples but does not encode RGB/grey tRNS or colour
 * profiles. Copy their original chunks (and CRCs), in legal PNG chunk order.
 * Palette indices, colour type and channel depth are unchanged by cropping.
 */
function preserveColourChunks(original: Uint8Array, encoded: Uint8Array): Uint8Array {
  const profiles = new Set(["cHRM", "gAMA", "iCCP", "sRGB", "sBIT", "cICP", "mDCV", "cLLI", "pHYs"]);
  const beforePalette: Uint8Array[] = [], beforeData: Uint8Array[] = [];
  for (const chunk of chunks(original)) {
    if (profiles.has(chunk.type)) beforePalette.push(chunk.bytes);
    else if (chunk.type === "tRNS" || chunk.type === "bKGD") beforeData.push(chunk.bytes);
  }
  const output: Uint8Array[] = [encoded.subarray(0, 8)];
  let dataStarted = false;
  for (const chunk of chunks(encoded)) {
    if (chunk.type === "tRNS") continue;
    if (chunk.type === "IDAT" && !dataStarted) { output.push(...beforeData); dataStarted = true; }
    output.push(chunk.bytes);
    if (chunk.type === "IHDR") output.push(...beforePalette);
  }
  const result = new Uint8Array(output.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of output) { result.set(part, at); at += part.length; }
  return result;
}
