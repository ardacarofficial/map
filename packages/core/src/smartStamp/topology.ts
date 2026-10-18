/** Smart-stamp neighbourhood masks; layout-1 mask order is permanent. */
export const BLOB_N = 1;
export const BLOB_NE = 2;
export const BLOB_E = 4;
export const BLOB_SE = 8;
export const BLOB_S = 16;
export const BLOB_SW = 32;
export const BLOB_W = 64;
export const BLOB_NW = 128;

/**
 * Drops corner bits whose two adjacent edge bits are not both set
 * (NE needs N and E, SE needs S and E, SW needs S and W, NW needs N and W).
 * Idempotent; maps all 256 masks onto the 47 of {@link BLOB47_MASKS}.
 */
export function reduceBlobMask(mask: number): number {
  let m = mask & 255;
  if ((m & (BLOB_N | BLOB_E)) !== (BLOB_N | BLOB_E)) m &= ~BLOB_NE;
  if ((m & (BLOB_S | BLOB_E)) !== (BLOB_S | BLOB_E)) m &= ~BLOB_SE;
  if ((m & (BLOB_S | BLOB_W)) !== (BLOB_S | BLOB_W)) m &= ~BLOB_SW;
  if ((m & (BLOB_N | BLOB_W)) !== (BLOB_N | BLOB_W)) m &= ~BLOB_NW;
  return m;
}

/**
 * The 47 reduced masks, ascending. Also the legacy `blob47` layout:
 * `BLOB47_MASKS[slot]` is the mask that slot's tile shows.
 */
export const BLOB47_MASKS: readonly number[] = Object.freeze(
  [...new Set(Array.from({ length: 256 }, (_, m) => reduceBlobMask(m)))].sort((a, b) => a - b),
);

const swapBits = (m: number, a: number, b: number) => {
  const hasA = (m & a) !== 0;
  const hasB = (m & b) !== 0;
  m &= ~(a | b);
  return m | (hasA ? b : 0) | (hasB ? a : 0);
};

export function flipBlobMask(mask: number, flipH: boolean, flipV: boolean, flipD: boolean): number {
  let m = mask & 255;
  if (flipD) {
    m = swapBits(m, BLOB_N, BLOB_W);
    m = swapBits(m, BLOB_S, BLOB_E);
    m = swapBits(m, BLOB_NE, BLOB_SW);
  }
  if (flipH) {
    m = swapBits(m, BLOB_E, BLOB_W);
    m = swapBits(m, BLOB_NE, BLOB_NW);
    m = swapBits(m, BLOB_SE, BLOB_SW);
  }
  if (flipV) {
    m = swapBits(m, BLOB_N, BLOB_S);
    m = swapBits(m, BLOB_NE, BLOB_SE);
    m = swapBits(m, BLOB_NW, BLOB_SW);
  }
  return m;
}
