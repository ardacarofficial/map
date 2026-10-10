/**
 * Orientation of a cell: the three flip bits (FLIP_H, FLIP_V, FLIP_D) as
 * Tiled defines them — the diagonal flip (x/y transpose) applies first,
 * then the horizontal, then the vertical flip. Together they give all 8
 * orientations, so a 90° turn is a remap of the bits.
 *
 * Pure: drawing (UV corners, pixel sampling) and the rotate commands use it.
 * Unit tested.
 */
import { FLIP_D, FLIP_H, FLIP_V, cellFlags, makeCell, rotateCellFlags, type RotateDirection } from "@smap/core";

export type RotateDir = RotateDirection;

/** Flip bits after turning a tile with `flags` by 90° (core `rotateCellFlags`; other bits are dropped). */
export function rotateFlags(flags: number, dir: RotateDir): number {
  return cellFlags(rotateCellFlags(makeCell(1, (flags & (FLIP_H | FLIP_V | FLIP_D)) >>> 0), dir));
}

/** Flip bits after mirroring: `"x"` toggles FLIP_H, `"y"` FLIP_V (exact in the D-then-H-then-V order). */
export function flipFlags(flags: number, axis: "x" | "y"): number {
  return ((flags & (FLIP_H | FLIP_V | FLIP_D)) ^ (axis === "x" ? FLIP_H : FLIP_V)) >>> 0;
}

/**
 * Where tile-local point (`s`, `t`) (0..1, y down) of the drawn cell samples
 * the source tile, for flip bits `flags`.
 */
export function sourcePoint(flags: number, s: number, t: number): [number, number] {
  const s1 = (flags & FLIP_H) !== 0 ? 1 - s : s;
  const t1 = (flags & FLIP_V) !== 0 ? 1 - t : t;
  return (flags & FLIP_D) !== 0 ? [t1, s1] : [s1, t1];
}

/** The four UV corners of a drawn quad — TL, TR, BR, BL as `[u, v]` pairs — for flip bits `flags`. */
export function quadUvs(src: { u0: number; v0: number; u1: number; v1: number }, flags: number): [number, number, number, number, number, number, number, number] {
  const out: number[] = [];
  for (const [s, t] of CORNERS) {
    const [ss, tt] = sourcePoint(flags, s, t);
    out.push(ss === 0 ? src.u0 : src.u1, tt === 0 ? src.v0 : src.v1);
  }
  return out as [number, number, number, number, number, number, number, number];
}

const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

/** True when tiles of `tileW`×`tileH` px can be turned (a non-square tile would not fit its cell). */
export function canRotateTiles(tileW: number, tileH: number): boolean {
  return tileW === tileH;
}
