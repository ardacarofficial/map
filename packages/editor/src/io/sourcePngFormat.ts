import { encode } from 'fast-png';
import type { RgbaImage } from '@smap/core';

export class UnsupportedPngError extends Error {
  constructor(readonly reason: 'profile' | 'depth' | 'animation' | 'representation' | 'metadata') { super(`Unsupported PNG ${reason}: cannot preserve or represent source artwork losslessly`); }
}
interface Chunk { type: string; bytes: Uint8Array; data: Uint8Array }
export function sourceChunks(bytes: Uint8Array): Chunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result: Chunk[] = [];
  for (let at = 8; at + 12 <= bytes.length;) {
    const end = at + view.getUint32(at) + 12;
    if (end > bytes.length) throw Error('Invalid PNG chunk');
    let crc = 0xffffffff;
    for (const b of bytes.subarray(at + 4, end - 4)) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) throw Error('Invalid PNG CRC');
    result.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), bytes: bytes.subarray(at, end), data: bytes.subarray(at + 8, end - 4) }); at = end;
  }
  return result;
}
/** Working/picker/edited-atlas colors use sRGB. Only the sRGB primaries and
 * scalar PNG gamma have an implemented reversible sample-space conversion.
 * Arbitrary ICC/HDR primaries require a color-management engine: refuse them.
 */
export function sourceGamma(bytes: Uint8Array): number | null {
  const chunks = sourceChunks(bytes);
  if (bytes[24] === 16) throw new UnsupportedPngError('depth');
  if (chunks.some(c => c.type === 'acTL')) throw new UnsupportedPngError('animation');
  if (chunks.some(c => ['iCCP', 'cICP', 'mDCV', 'cLLI'].includes(c.type))) throw new UnsupportedPngError('profile');
  const chrm = chunks.find(c => c.type === 'cHRM');
  if (chrm) {
    const standard = [31270,32900,64000,33000,30000,60000,15000,6000];
    const view = new DataView(chrm.data.buffer, chrm.data.byteOffset, chrm.data.byteLength);
    if (chrm.data.length !== 32 || standard.some((n, i) => view.getUint32(i * 4) !== n)) throw new UnsupportedPngError('profile');
  }
  if (chunks.some(c => c.type === 'sRGB')) return null;
  const chunk = chunks.find(c => c.type === 'gAMA');
  if (!chunk) return null;
  if (chunk.data.length !== 4) throw Error('Invalid PNG gamma');
  const gamma = new DataView(chunk.data.buffer, chunk.data.byteOffset, 4).getUint32(0) / 100000;
  if (!gamma) throw Error('Invalid PNG gamma'); return gamma;
}
function srgb(linear: number): number { return linear <= .0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - .055; }
export function workingSample(raw: number, gamma: number | null): number { return gamma === null ? raw : Math.round(255 * srgb(Math.pow(raw / 255, 1 / gamma))); }
function rawSample(value: number, gamma: number | null): number {
  if (gamma === null) return value;
  const s = value / 255, linear = s <= .04045 ? s / 12.92 : Math.pow((s + .055) / 1.055, 2.4);
  const sample = Math.round(255 * Math.pow(linear, gamma));
  if (workingSample(sample, gamma) !== value) throw new UnsupportedPngError('representation');
  return sample;
}
export function workingSource(image: RgbaImage, bytes: Uint8Array): RgbaImage {
  const gamma = sourceGamma(bytes); if (gamma === null) return image;
  const data = image.data.slice();
  for (let p = 0; p < data.length; p += 4) for (let c = 0; c < 3; c++) data[p + c] = workingSample(data[p + c]!, gamma);
  return { ...image, data };
}
export function sourceSamplePixels(image: RgbaImage, before: RgbaImage, bytes: Uint8Array): Uint8Array {
  const gamma = sourceGamma(bytes), data = new Uint8Array(image.data);
  for (let p = 0; p < data.length; p += 4) for (let c = 0; c < 3; c++) data[p+c] = data[p+c] === workingSample(before.data[p+c]!, gamma) ? before.data[p+c]! : rawSample(data[p+c]!, gamma);
  return data;
}
/** Encode in the original sample model; replace IDAT alone so all supported
 * color chunks, palette, tRNS, depth and interlace remain byte-for-byte intact.
 */
export function encodePatchedSource(image: RgbaImage, original: Uint8Array, before: RgbaImage): Uint8Array {
  sourceGamma(original);
  const native = sourceSamplePixels(image, before, original);
  const chunks = sourceChunks(original), depth = original[24]!, type = original[25]!;
  const known = new Set(['IHDR','IDAT','IEND','PLTE','tRNS','gAMA','cHRM','sRGB','sBIT','bKGD','pHYs','tEXt','zTXt','iTXt','tIME','eXIf','sPLT']);
  if (chunks.some(c => !known.has(c.type) && c.type[3] === c.type[3]!.toUpperCase())) throw new UnsupportedPngError('metadata');
  const channels = type === 0 || type === 3 ? 1 : type === 2 ? 3 : type === 4 ? 2 : type === 6 ? 4 : 0;
  if (!channels || ![1,2,4,8].includes(depth)) throw new UnsupportedPngError('depth');
  const stride = Math.ceil(image.width * channels * depth / 8), data = new Uint8Array(stride * image.height);
  const paletteChunk = chunks.find(c => c.type === 'PLTE'), trns = chunks.find(c => c.type === 'tRNS');
  const palette = paletteChunk ? Array.from({ length: paletteChunk.data.length / 3 }, (_, i) => [paletteChunk.data[i*3]!,paletteChunk.data[i*3+1]!,paletteChunk.data[i*3+2]!]) : undefined;
  const max = (1 << depth) - 1;
  const transparentSample = trns && type !== 3 ? new DataView(trns.data.buffer, trns.data.byteOffset, trns.data.byteLength) : undefined;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const p = (y * image.width + x) * 4, rgba = Array.from(native.subarray(p, p + 4));
    let samples: number[];
    if (type === 3) {
      const index = palette?.findIndex((color, i) => color.every((v,c) => v === rgba[c]) && (trns?.data[i] ?? 255) === rgba[3]) ?? -1;
      if (index < 0 || index > max) throw new UnsupportedPngError('representation'); samples = [index];
    } else {
      if ((type === 0 || type === 4) && (rgba[0] !== rgba[1] || rgba[1] !== rgba[2])) throw new UnsupportedPngError('representation');
      samples = type === 0 ? [rgba[0]!] : type === 4 ? [rgba[0]!,rgba[3]!] : type === 2 ? rgba.slice(0,3) : rgba;
      if (depth < 8) { samples = samples.map(v => v * max / 255); if (samples.some(v => !Number.isInteger(v))) throw new UnsupportedPngError('representation'); }
      if (type === 0 || type === 2) {
        const transparent = transparentSample && samples.every((v,c) => v === transparentSample.getUint16(c * 2));
        if (rgba[3] !== (transparent ? 0 : 255)) throw new UnsupportedPngError('representation');
      }
    }
    for (let c = 0; c < channels; c++) {
      const bit = (x * channels + c) * depth;
      data[y * stride + (bit >> 3)]! |= samples[c]! << (8 - depth - (bit & 7));
    }
  }
  const encoded = encode({ width: image.width, height: image.height, data, depth: depth as 1 | 2 | 4 | 8, channels: channels as 1 | 2 | 3 | 4, ...(type === 3 ? { palette: palette! } : {}) }, original[28] === 1 ? { interlace: 'Adam7' } : {});
  const idat = sourceChunks(encoded).filter(c => c.type === 'IDAT').map(c => c.bytes);
  const parts = [original.subarray(0, 8)]; let inserted = false;
  for (const chunk of chunks) {
    if (chunk.type !== 'IDAT') parts.push(chunk.bytes);
    else if (!inserted) { parts.push(...idat); inserted = true; }
  }
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
