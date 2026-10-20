import { decode, encode } from "fast-png";
import type { Tileset } from "../../tileset";

/** Even differences allow integer TileData origins without half-pixel sampling. */
export function nativeRegion(t: Tileset, cellWidth: number, cellHeight: number) {
  const width = Math.max(t.tileWidth, cellWidth), height = Math.max(t.tileHeight, cellHeight);
  return { width: width + ((width - cellWidth) & 1), height: height + ((height - cellHeight) & 1) };
}

/** TileData transforms act before origin translation, unlike cell transform bits.
 * Compensate for transformed padding so the native rectangle stays bottom-left.
 */
export function nativeOrigin(t: Tileset, cellWidth: number, cellHeight: number, flags: number) {
  const region = nativeRegion(t, cellWidth, cellHeight);
  let width = region.width, height = region.height;
  let x = 0, y = height - t.tileHeight, w = t.tileWidth, h = t.tileHeight;
  if (flags & 4) { [width, height] = [height, width]; [x, y] = [y, x]; [w, h] = [h, w]; }
  if (flags & 1) x = width - x - w;
  if (flags & 2) y = height - y - h;
  return { x: (cellWidth - width) / 2 + x, y: (cellHeight - height) / 2 + y - cellHeight + h };
}

/** Repack only the exported copy; preserve native sample precision and alpha.
 * Palette/grey/RGB (including tRNS) expand losslessly to RGBA; no resampling.
 */
export function nativePng(bytes: Uint8Array, t: Tileset, cellWidth: number, cellHeight: number): Uint8Array {
  const region = nativeRegion(t, cellWidth, cellHeight);
  if (region.width === t.tileWidth && region.height === t.tileHeight) return bytes.slice();
  const source = decode(bytes, { checkCrc: true });
  const depth = source.depth === 16 ? 16 : 8;
  const max = depth === 16 ? 65535 : 255;
  const width = region.width * t.columns, height = region.height * t.rows;
  const data = depth === 16 ? new Uint16Array(width * height * 4) : new Uint8Array(width * height * 4);
  const sample = (x: number, y: number, channel: number) => source.depth < 8
    ? (source.data[y * Math.ceil(source.width * source.depth / 8) + ((x * source.depth) >> 3)]! >> (8 - source.depth - ((x * source.depth) & 7))) & ((1 << source.depth) - 1)
    : source.data[(y * source.width + x) * source.channels + channel]!;
  for (let row = 0; row < t.rows; row++) for (let col = 0; col < t.columns; col++) {
    for (let y = 0; y < t.tileHeight; y++) for (let x = 0; x < t.tileWidth; x++) {
      const sx = t.margin + col * (t.tileWidth + t.spacing) + x;
      const sy = t.margin + row * (t.tileHeight + t.spacing) + y;
      const values = Array.from({ length: source.channels }, (_, c) => sample(sx, sy, c));
      let rgba: number[];
      if (source.palette) {
        const color = source.palette[values[0]!]!;
        rgba = [color[0]!, color[1]!, color[2]!, color[3] ?? 255];
      } else {
        const grey = source.channels <= 2;
        const rgb = grey ? [values[0]!, values[0]!, values[0]!] : values.slice(0,3);
        if (source.depth < 8) for (let i = 0; i < 3; i++) rgb[i] = rgb[i]! * 255 / ((1 << source.depth) - 1);
        const transparent = source.transparency?.length && [...source.transparency].every((v, i) => values[i] === v);
        rgba = [...rgb, source.channels === 2 || source.channels === 4 ? values.at(-1)! : transparent ? 0 : max];
      }
      const at = ((row * region.height + region.height - t.tileHeight + y) * width + col * region.width + x) * 4;
      data.set(rgba, at);
    }
  }
  const output = encode({ width, height, data, depth, channels: 4 });
  // Preserve colour interpretation. sBIT/bKGD/tRNS depend on the old colour type;
  // transparency is already represented by the expanded alpha samples.
  const profiles = new Set(["cHRM", "gAMA", "iCCP", "sRGB", "cICP", "mDCV", "cLLI", "pHYs"]);
  const extra: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at < bytes.length;) {
    const end = at + view.getUint32(at) + 12;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (profiles.has(type)) extra.push(bytes.subarray(at, end));
    at = end;
  }
  const result = new Uint8Array(output.length + extra.reduce((sum, part) => sum + part.length, 0));
  result.set(output.subarray(0,33));
  let at = 33;
  for (const part of extra) { result.set(part, at); at += part.length; }
  result.set(output.subarray(33), at);
  return result;
}
