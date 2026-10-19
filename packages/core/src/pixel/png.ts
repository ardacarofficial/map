import { assertRasterSize, canonicalRgba } from './assets';

function u32(n: number): number[] { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + bytes.length);
  body.set([...type].map(c => c.charCodeAt(0))); body.set(bytes, 4);
  const out = new Uint8Array(bytes.length + 12);
  out.set(u32(bytes.length)); out.set(body, 4); out.set(u32(crc32(body)), bytes.length + 8);
  return out;
}
/** Dependency-free deterministic PNG: RGBA8, no interlace, filter 0, zlib stored DEFLATE. Call off the gesture path. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const pixels = canonicalRgba(width, height, rgba);
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const blocks = Math.ceil(raw.length / 65535);
  const zlib = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  zlib.set([0x78, 0x01]);
  let p = 2, a = 1, b = 0;
  for (let start = 0; start < raw.length; start += 65535) {
    const count = Math.min(65535, raw.length - start);
    zlib.set([start + count === raw.length ? 1 : 0, count & 255, count >>> 8, (~count) & 255, ((~count) >>> 8) & 255], p); p += 5;
    zlib.set(raw.subarray(start, start + count), p); p += count;
  }
  for (const value of raw) { a = (a + value) % 65521; b = (b + a) % 65521; }
  zlib.set(u32(((b << 16) | a) >>> 0), p);
  const parts = [new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', new Uint8Array([...u32(width), ...u32(height),8,6,0,0,0])), chunk('IDAT', zlib), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

// Preparation and live dispatch often hash the exact same small atlas. Cache
// owned canonical snapshots, with byte equality (no fingerprint collisions).
// Large atlases are never retained here; total cache storage is at most 1 MiB.
const HASH_CACHE_BYTES = 1024 * 1024;
const hashCache: { width: number; height: number; pixels: Uint8Array; fingerprint: number; hash: string }[] = [];
let hashCacheBytes = 0;
function pixelFingerprint(rgba: Uint8Array): number {
  let hash = 2166136261;
  for (let p = 0; p < rgba.length; p += 4) {
    const a = rgba[p + 3]!, word = a ? (rgba[p]! | (rgba[p + 1]! << 8) | (rgba[p + 2]! << 16) | (a << 24)) : 0;
    hash = Math.imul(hash ^ word, 16777619);
  }
  return hash >>> 0;
}
function cachedHash(width: number, height: number, rgba: Uint8Array, fingerprint: number): string | undefined {
  for (let n = 0; n < hashCache.length; n++) {
    const entry = hashCache[n]!;
    if (entry.width !== width || entry.height !== height || entry.fingerprint !== fingerprint) continue;
    let equal = true;
    for (let p = 0; p < rgba.length; p += 4) {
      const a = rgba[p + 3]!;
      if (a !== entry.pixels[p + 3] || (a !== 0 && (rgba[p] !== entry.pixels[p] || rgba[p + 1] !== entry.pixels[p + 1] || rgba[p + 2] !== entry.pixels[p + 2]))) { equal = false; break; }
    }
    if (equal) { hashCache.splice(n, 1); hashCache.unshift(entry); return entry.hash; }
  }
  return undefined;
}
/** SHA-256 of big-endian width/height then canonical tight RGBA8. Pure and byte-stable across runtimes. */
export function rasterContentHash(width: number, height: number, rgba: Uint8Array): string {
  assertRasterSize(width, height);
  if (!(rgba instanceof Uint8Array) || rgba.length !== width * height * 4) throw new RangeError('incorrect RGBA8 byte length');
  const fingerprint = rgba.length <= HASH_CACHE_BYTES ? pixelFingerprint(rgba) : 0;
  const hit = rgba.length <= HASH_CACHE_BYTES ? cachedHash(width, height, rgba, fingerprint) : undefined;
  if (hit) return hit;
  const pixels = canonicalRgba(width, height, rgba);
  const bytes = new Uint8Array(8 + pixels.length); bytes.set(u32(width)); bytes.set(u32(height), 4); bytes.set(pixels, 8);
  const hash = sha256(bytes);
  if (pixels.length <= HASH_CACHE_BYTES) {
    hashCache.unshift({ width, height, pixels, fingerprint, hash }); hashCacheBytes += pixels.length;
    while (hashCacheBytes > HASH_CACHE_BYTES || hashCache.length > 8) hashCacheBytes -= hashCache.pop()!.pixels.length;
  }
  return hash;
}
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotr = (n: number, k: number): number => (n >>> k) | (n << (32 - k));
function sha256(bytes: Uint8Array): string {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes); padded[bytes.length] = 128;
  const view = new DataView(padded.buffer); view.setUint32(padded.length - 4, bytes.length * 8); view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let start = 0; start < padded.length; start += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(start + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i-15]!, y = w[i-2]!;
      w[i] = w[i-16]! + (rotr(x,7)^rotr(x,18)^(x>>>3)) + w[i-7]! + (rotr(y,17)^rotr(y,19)^(y>>>10));
    }
    let [a,b,c,d,e,f,g,j] = [...h] as [number,number,number,number,number,number,number,number];
    for (let i = 0; i < 64; i++) {
      const t1 = (j + (rotr(e,6)^rotr(e,11)^rotr(e,25)) + ((e&f)^(~e&g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a,2)^rotr(a,13)^rotr(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0;
      j=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    const state = [a,b,c,d,e,f,g,j]; for (let i=0;i<8;i++) h[i] = h[i]! + state[i]!;
  }
  return [...h].map(n => n.toString(16).padStart(8,'0')).join('');
}
