import type { Tileset } from '@smap/core';
export function pixelSourceGrid(ts: Tileset): string {
  return JSON.stringify([ts.tileWidth, ts.tileHeight, ts.columns, ts.rows, ts.margin, ts.spacing]);
}
/** Keep pixel hashes readable by v6 while capturing the grid in the same opaque string. */
export function capturedPixelHash(hash: string, ts: Tileset): string { return `${hash}|${pixelSourceGrid(ts)}`; }
