/**
 * Small, strict base64 (RFC 4648, standard alphabet, with `=` padding).
 * Pure TypeScript: core's lib is ES2022, so neither `btoa` nor `Buffer` exist.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** Alphabet as character codes (encoding writes codes, then builds the string in blocks). */
const ALPHABET_CODES = Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0));
const PAD = 61; // "="

/** True on little-endian hosts (all current ones): Uint32 data can be viewed as bytes without swapping. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** ASCII codes → string, in blocks (fromCharCode's argument count is limited). */
function codesToString(codes: Uint8Array): string {
  const BLOCK = 8192;
  if (codes.length <= BLOCK) return String.fromCharCode.apply(null, codes as unknown as number[]);
  const parts: string[] = [];
  for (let i = 0; i < codes.length; i += BLOCK) {
    parts.push(String.fromCharCode.apply(null, codes.subarray(i, i + BLOCK) as unknown as number[]));
  }
  return parts.join("");
}

/** Encodes bytes as padded base64. */
export function encodeBase64(bytes: Uint8Array): string {
  const n = bytes.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  const A = ALPHABET_CODES;
  let i = 0;
  let o = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out[o++] = A[(v >> 18) & 63]!;
    out[o++] = A[(v >> 12) & 63]!;
    out[o++] = A[(v >> 6) & 63]!;
    out[o++] = A[v & 63]!;
  }
  const rest = n - i;
  if (rest === 1) {
    const v = bytes[i]! << 16;
    out[o++] = A[(v >> 18) & 63]!;
    out[o++] = A[(v >> 12) & 63]!;
    out[o++] = PAD;
    out[o] = PAD;
  } else if (rest === 2) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out[o++] = A[(v >> 18) & 63]!;
    out[o++] = A[(v >> 12) & 63]!;
    out[o++] = A[(v >> 6) & 63]!;
    out[o] = PAD;
  }
  return codesToString(out);
}

/** Position of the first character in `text[from, from+4)` that is not in the alphabet. */
function badCharAt(text: string, from: number): number {
  for (let p = from; p < from + 4; p++) {
    const code = text.charCodeAt(p);
    if (code >= 128 || LOOKUP[code]! < 0) return p;
  }
  return from;
}

/**
 * Decodes padded base64. Strict: rejects whitespace, unknown characters,
 * missing/misplaced padding and non-zero trailing bits, so every byte string
 * has exactly one accepted encoding.
 *
 * @throws SyntaxError on malformed input.
 */
export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new SyntaxError("base64 length must be a multiple of 4");
  let padding = 0;
  if (text.endsWith("==")) padding = 2;
  else if (text.endsWith("=")) padding = 1;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  const L = LOOKUP;
  const sextet = (pos: number): number => {
    const code = text.charCodeAt(pos);
    const value = code < 128 ? L[code]! : -1;
    if (value < 0) throw new SyntaxError(`invalid base64 character at position ${pos}`);
    return value;
  };
  let o = 0;
  const full = text.length - (padding > 0 ? 4 : 0);
  for (let i = 0; i < full; i += 4) {
    const c0 = text.charCodeAt(i);
    const c1 = text.charCodeAt(i + 1);
    const c2 = text.charCodeAt(i + 2);
    const c3 = text.charCodeAt(i + 3);
    // Codes ≥ 128 are masked into the table range here and rejected by the check below.
    const a = L[c0 & 127]!;
    const b = L[c1 & 127]!;
    const c = L[c2 & 127]!;
    const d = L[c3 & 127]!;
    if (((c0 | c1 | c2 | c3) & ~127) !== 0 || (a | b | c | d) < 0) {
      throw new SyntaxError(`invalid base64 character at position ${badCharAt(text, i)}`);
    }
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (v >> 16) & 255;
    out[o++] = (v >> 8) & 255;
    out[o++] = v & 255;
  }
  if (padding === 2) {
    const a = sextet(full);
    const b = sextet(full + 1);
    if ((b & 15) !== 0) throw new SyntaxError("base64 has non-zero trailing bits");
    out[o] = (a << 2) | (b >> 4);
  } else if (padding === 1) {
    const a = sextet(full);
    const b = sextet(full + 1);
    const c = sextet(full + 2);
    if ((c & 3) !== 0) throw new SyntaxError("base64 has non-zero trailing bits");
    out[o++] = (a << 2) | (b >> 4);
    out[o] = ((b & 15) << 4) | (c >> 2);
  }
  return out;
}

/** Encodes 32-bit unsigned integers as little-endian bytes, then base64. */
export function encodeUint32LE(values: Uint32Array): string {
  if (LITTLE_ENDIAN) return encodeBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setUint32(i * 4, values[i]!, true);
  return encodeBase64(bytes);
}

/**
 * Inverse of {@link encodeUint32LE}.
 * @throws SyntaxError on malformed base64 or a byte length not divisible by 4.
 */
export function decodeUint32LE(text: string): Uint32Array {
  const bytes = decodeBase64(text);
  if (bytes.length % 4 !== 0) throw new SyntaxError("byte length is not a multiple of 4");
  // A fresh, exclusively owned buffer: view it directly on little-endian hosts.
  if (LITTLE_ENDIAN && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return new Uint32Array(bytes.buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}
