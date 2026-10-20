export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  let crc = 0xffffffff;
  for (const b of out.subarray(4, out.length - 4)) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0); return out;
}
export function withPngChunks(png: Uint8Array, ...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(png.length + chunks.reduce((n, c) => n + c.length, 0));
  result.set(png.subarray(0, 33)); let offset = 33;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  result.set(png.subarray(33), offset); return result;
}
export function pngChunks(png: Uint8Array): Map<string, Uint8Array> {
  const chunks = new Map<string, Uint8Array>(), view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at < png.length;) { const end = at + view.getUint32(at) + 12; chunks.set(String.fromCharCode(...png.subarray(at + 4, at + 8)), png.slice(at, end)); at = end; }
  return chunks;
}
