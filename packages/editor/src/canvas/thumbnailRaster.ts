/**
 * Pure pixel work of the map thumbnail (minimap + far-zoom LOD): tiles are
 * box-filtered down to k×k pixels once, then each 32×32 chunk is composited
 * from those blocks over all visible tile layers. No DOM: unit tested.
 */
import { CELL_INDEX_MASK, CHUNK_SHIFT, CHUNK_SIZE, FLIP_H, FLIP_V } from "@smap/core";

/** RGBA pixels, row-major. */
export interface Pixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * Box-filters the `rect` of `src` down to `k`×`k` RGBA pixels (alpha
 * weighted, so transparent pixels do not darken the colour).
 */
export function tileThumb(src: Pixels, rect: { x: number; y: number; width: number; height: number }, k: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(k * k * 4);
  for (let by = 0; by < k; by++) {
    const sy0 = rect.y + Math.floor((by * rect.height) / k);
    const sy1 = Math.max(sy0 + 1, rect.y + Math.floor(((by + 1) * rect.height) / k));
    for (let bx = 0; bx < k; bx++) {
      const sx0 = rect.x + Math.floor((bx * rect.width) / k);
      const sx1 = Math.max(sx0 + 1, rect.x + Math.floor(((bx + 1) * rect.width) / k));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = sy0; y < sy1; y++) {
        if (y < 0 || y >= src.height) continue;
        for (let x = sx0; x < sx1; x++) {
          if (x < 0 || x >= src.width) continue;
          const i = (y * src.width + x) * 4;
          const pa = src.data[i + 3]!;
          r += src.data[i]! * pa;
          g += src.data[i + 1]! * pa;
          b += src.data[i + 2]! * pa;
          a += pa;
          n++;
        }
      }
      const o = (by * k + bx) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(a / Math.max(1, n));
      }
    }
  }
  return out;
}

/** One layer's chunk for {@link compositeChunk}. */
export interface ChunkLayerInput {
  /** `CHUNK_AREA` cells (undefined = empty chunk). */
  readonly data: ArrayLike<number> | undefined;
  /** 0…1. */
  readonly opacity: number;
}

/**
 * Composites one chunk at `k` px per cell, bottom layer first ("over"
 * blending with layer opacity). `block(paletteIndex)` gives the tile's k×k
 * pixels (undefined = not drawable). Horizontal / vertical flips are
 * honoured (like the chunk meshes, the diagonal flip is not drawn).
 * Returns straight-alpha RGBA of (32k)×(32k) px.
 */
export function compositeChunk(
  layers: readonly ChunkLayerInput[],
  k: number,
  block: (paletteIndex: number) => Uint8ClampedArray | undefined,
): Uint8ClampedArray {
  const side = CHUNK_SIZE * k;
  // Premultiplied accumulation.
  const acc = new Float32Array(side * side * 4);
  for (const layer of layers) {
    const data = layer.data;
    if (!data || layer.opacity <= 0) continue;
    const op = Math.min(1, layer.opacity);
    const n = Math.min(data.length, CHUNK_SIZE * CHUNK_SIZE);
    for (let i = 0; i < n; i++) {
      const cell = data[i]! >>> 0;
      if (cell === 0) continue;
      const px = block(cell & CELL_INDEX_MASK);
      if (!px) continue;
      const fh = (cell & FLIP_H) !== 0;
      const fv = (cell & FLIP_V) !== 0;
      const ox = (i & (CHUNK_SIZE - 1)) * k;
      const oy = (i >> CHUNK_SHIFT) * k;
      for (let y = 0; y < k; y++) {
        const sy = fv ? k - 1 - y : y;
        for (let x = 0; x < k; x++) {
          const sx = fh ? k - 1 - x : x;
          const s = (sy * k + sx) * 4;
          const sa = (px[s + 3]! / 255) * op;
          if (sa <= 0) continue;
          const d = ((oy + y) * side + ox + x) * 4;
          const keep = 1 - sa;
          acc[d] = px[s]! * sa + acc[d]! * keep;
          acc[d + 1] = px[s + 1]! * sa + acc[d + 1]! * keep;
          acc[d + 2] = px[s + 2]! * sa + acc[d + 2]! * keep;
          acc[d + 3] = sa + acc[d + 3]! * keep;
        }
      }
    }
  }
  const out = new Uint8ClampedArray(side * side * 4);
  for (let d = 0; d < out.length; d += 4) {
    const a = acc[d + 3]!;
    if (a <= 0) continue;
    out[d] = acc[d]! / a;
    out[d + 1] = acc[d + 1]! / a;
    out[d + 2] = acc[d + 2]! / a;
    out[d + 3] = a * 255;
  }
  return out;
}
