/** Stable coordinate hashing shared by random brushes and smart stamps. */
export function cellHash(seed: number, x: number, y: number): number {
  let h = seed >>> 0;
  h = mix(h, x | 0);
  h = mix(h, y | 0);
  h ^= 8;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function mix(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** Index into a candidate list of length `count` for cell (`x`, `y`). */
export function pickVariant(count: number, seed: number, x: number, y: number): number {
  return count <= 1 ? 0 : cellHash(seed, x, y) % count;
}
