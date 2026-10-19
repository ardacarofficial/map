/** Decode our authoritative filter-0/stored-DEFLATE PNG without premultiplication.
 * Browser canvas readback loses RGB precision at low alpha, invalidating hashes.
 * Re-encoding verifies PNG CRCs, zlib checksums and exact deterministic policy.
 */
import { encodeRgbaPng, MAX_RASTER_BYTES } from '@smap/core';
export function decodeEditedPng(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const fail = (): never => { throw new Error('Invalid edited PNG'); };
  if (bytes.length < 65) return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width * height * 4 > MAX_RASTER_BYTES) return fail();
  const stride = width * 4, raw = new Uint8Array((stride + 1) * height);
  // The deterministic encoder writes exactly IHDR, IDAT, IEND and one zlib stream.
  const size = view.getUint32(33), end = 41 + size - 4;
  let p = 43, offset = 0, last = false;
  while (!last) {
    if (p + 5 > end) return fail();
    const header = bytes[p++]!; last = header === 1; if (header !== 0 && header !== 1) return fail();
    const n = bytes[p]! | (bytes[p + 1]! << 8), inverse = bytes[p + 2]! | (bytes[p + 3]! << 8); p += 4;
    if ((n ^ inverse) !== 65535 || p + n > end || offset + n > raw.length) return fail();
    raw.set(bytes.subarray(p, p + n), offset); p += n; offset += n;
  }
  if (offset !== raw.length || p !== end) return fail();
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) { if (raw[y * (stride + 1)] !== 0) return fail(); data.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride); }
  const encoded = encodeRgbaPng(width, height, data);
  if (encoded.length !== bytes.length || encoded.some((v, i) => v !== bytes[i])) return fail();
  return { width, height, data };
}

/** A generated raster is authoritative: never open it as an editable missing texture. */
export class EditedAssetError extends Error {
  constructor(readonly paths: readonly string[]) { super('Invalid edited raster asset'); this.name = 'EditedAssetError'; }
}
