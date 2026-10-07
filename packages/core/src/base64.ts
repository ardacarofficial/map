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

/** Encodes bytes as padded base64. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(v >> 18) & 63]! + ALPHABET[(v >> 12) & 63]! + ALPHABET[(v >> 6) & 63]! + ALPHABET[v & 63]!;
  }
  const rest = n - i;
  if (rest === 1) {
    const v = bytes[i]! << 16;
    out += ALPHABET[(v >> 18) & 63]! + ALPHABET[(v >> 12) & 63]! + "==";
  } else if (rest === 2) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(v >> 18) & 63]! + ALPHABET[(v >> 12) & 63]! + ALPHABET[(v >> 6) & 63]! + "=";
  }
  return out;
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
  const sextet = (pos: number): number => {
    const code = text.charCodeAt(pos);
    const value = code < 128 ? LOOKUP[code]! : -1;
    if (value < 0) throw new SyntaxError(`invalid base64 character at position ${pos}`);
    return value;
  };
  let o = 0;
  const full = text.length - (padding > 0 ? 4 : 0);
  for (let i = 0; i < full; i += 4) {
    const v = (sextet(i) << 18) | (sextet(i + 1) << 12) | (sextet(i + 2) << 6) | sextet(i + 3);
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
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}
