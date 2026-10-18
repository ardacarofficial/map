/**
 * Pure helpers for the fill preview: the region a fill would cover as a
 * one-pixel-per-cell RGBA image cropped to its bounding box (drawn as one
 * nearest-filtered sprite, however many cells it has), plus a membership
 * mask so hovering elsewhere inside the same region needs no new flood fill.
 */
import type { CellPoint, FillRun } from "@smap/core";

export interface CellMaskImage {
  /** Bounding box in cells. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** `width × height` RGBA pixels; covered cells are opaque white (tinted when drawn). */
  readonly data: Uint8ClampedArray;
}

/** Image of `points` cropped to their bounding box; null when empty. */
export function cellMaskImage(points: readonly CellPoint[]): CellMaskImage | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (const p of points) {
    const i = ((p.y - y0) * width + (p.x - x0)) * 4;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return { x: x0, y: y0, width, height, data };
}

/** `mapWidth × mapHeight` membership mask of `points`. */
export function membershipMask(points: readonly CellPoint[], mapWidth: number, mapHeight: number): Uint8Array {
  const mask = new Uint8Array(mapWidth * mapHeight);
  for (const p of points) mask[p.y * mapWidth + p.x] = 1;
  return mask;
}

/** Cropped RGBA image without expanding scanline runs into point objects. */
export function runMaskImage(runs: readonly FillRun[]): CellMaskImage | null {
  if (runs.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of runs) {
    x0 = Math.min(x0, r.left);
    x1 = Math.max(x1, r.right);
    y0 = Math.min(y0, r.y);
    y1 = Math.max(y1, r.y);
  }
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (const r of runs) {
    const start = ((r.y - y0) * width + r.left - x0) * 4;
    data.fill(255, start, start + (r.right - r.left + 1) * 4);
  }
  return { x: x0, y: y0, width, height, data };
}

/** Membership of scanline runs, without intermediate points. */
export function runMembershipMask(runs: readonly FillRun[], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const r of runs) mask.fill(1, r.y * width + r.left, r.y * width + r.right + 1);
  return mask;
}
