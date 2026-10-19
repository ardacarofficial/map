import { CELL_FLAG_MASK, FLIP_D, FLIP_H, FLIP_V } from "../cell";
import { assertPixelPoint, type PixelPoint } from "./tools";

export interface PixelMirrorAxes {
  /** Reflect y about the horizontal line y=origin.y. */
  readonly horizontal?: boolean;
  /** Reflect x about the vertical line x=origin.x. */
  readonly vertical?: boolean;
  /** Integer = through a pixel centre; half integer = between two pixels. */
  readonly origin: PixelPoint;
}

/** Mirror the actual footprint pixels, so even tips retain exact symmetry. */
export function mirrorPixels(points: readonly PixelPoint[], axes: PixelMirrorAxes): PixelPoint[] {
  const ox = axes.origin.x * 2, oy = axes.origin.y * 2;
  assertPixelPoint({ x: ox, y: oy });
  const seen = new Map<number, Set<number>>(), out: PixelPoint[] = [];
  const add = (x: number, y: number) => {
    let row = seen.get(y);
    if (!row) { row = new Set(); seen.set(y, row); }
    if (row.has(x)) return;
    row.add(x); out.push({ x, y });
  };
  for (const p of points) {
    assertPixelPoint(p);
    add(p.x, p.y);
    if (axes.vertical) add(ox - p.x, p.y);
    if (axes.horizontal) add(p.x, oy - p.y);
    if (axes.horizontal && axes.vertical) add(ox - p.x, oy - p.y);
  }
  return out;
}

/** Dimensions are native source pixels. D swaps the placed extent. */
export function placedPixelSize(width: number, height: number, flags = 0): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new RangeError("raster dimensions must be positive safe integers");
  return flags & FLIP_D ? { width: height, height: width } : { width, height };
}

/** Forward D-then-H/V mapping, using the existing cell flag bits. */
export function sourceToPlacedPixel(p: PixelPoint, width: number, height: number, flags = 0): PixelPoint {
  const size = placedPixelSize(width, height, flags);
  assertPixelPoint(p);
  let x = flags & FLIP_D ? p.y : p.x, y = flags & FLIP_D ? p.x : p.y;
  if (flags & FLIP_H) x = size.width - 1 - x;
  if (flags & FLIP_V) y = size.height - 1 - y;
  return { x, y };
}

/** Inverse of renderer UV sampling: undo H/V, then undo transpose. */
export function placedToSourcePixel(p: PixelPoint, width: number, height: number, flags = 0): PixelPoint {
  const size = placedPixelSize(width, height, flags);
  assertPixelPoint(p);
  const x = flags & FLIP_H ? size.width - 1 - p.x : p.x, y = flags & FLIP_V ? size.height - 1 - p.y : p.y;
  return flags & FLIP_D ? { x: y, y: x } : { x, y };
}

/** Apply before, then after; palette-index bits are ignored, result is unsigned. */
export function composePixelFlags(before: number, after: number): number {
  // D in `after` swaps the axes of the earlier mirrors before XORing them.
  const b = after & FLIP_D ? ((before & FLIP_H ? FLIP_V : 0) | (before & FLIP_V ? FLIP_H : 0) | (before & FLIP_D)) : before;
  return ((b ^ after) & CELL_FLAG_MASK) >>> 0;
}

export function inversePixelFlags(flags: number): number {
  return flags & FLIP_D ? ((flags & FLIP_H ? FLIP_V : 0) | (flags & FLIP_V ? FLIP_H : 0) | FLIP_D) >>> 0 : (flags & CELL_FLAG_MASK) >>> 0;
}
