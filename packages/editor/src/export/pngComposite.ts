/**
 * PNG export, the pure half: turns core's draw list into a flat list of 2D
 * canvas operations (alpha changes and transformed image draws), and guards
 * the output size. `pngRender.ts` replays the list on a real canvas.
 */
import type { DrawList } from "@smap/core";

/** Export scale factors offered in the dialog. */
export const PNG_SCALES = [1, 2, 4] as const;
export type PngScale = (typeof PNG_SCALES)[number];

/** Largest side Chromium allows for a canvas (and most image viewers open). */
export const PNG_MAX_SIDE = 16384;
/** Largest pixel count we try to allocate (256 MP ≈ 1 GiB of RGBA). */
export const PNG_MAX_PIXELS = 256 * 1024 * 1024;

/** `ctx.setTransform(a, b, c, d, e, f)` arguments. */
export type Transform = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export type CanvasOp =
  | { readonly kind: "alpha"; readonly alpha: number }
  | {
      readonly kind: "draw";
      readonly tilesetId: string;
      /** Source rectangle in the tileset image. */
      readonly sx: number;
      readonly sy: number;
      readonly sw: number;
      readonly sh: number;
      /** Maps tile-local space (0..dw, 0..dh) to the output image (scale and flips included). */
      readonly transform: Transform;
      /** Size drawn in tile-local space (the source tile's size, unscaled; see {@link tileTransform}). */
      readonly dw: number;
      readonly dh: number;
    };

/**
 * Transform that places a tile at `(x, y)` in map pixels, scaled by `scale`,
 * in one of the eight orientations (Tiled's rule, see core's `DrawItem`):
 * `flipD` first swaps the tile's x and y, then `flipH` / `flipV` mirror it
 * inside its own `width × height` destination rectangle (already transposed
 * when `flipD`). A mirror maps the tile's left edge to the rectangle's right
 * edge (negative scale plus an offset of the full width), so the tile stays
 * in its cell.
 *
 * Tile-local space is the source tile's: `(0..height, 0..width)` when
 * `flipD`, `(0..width, 0..height)` otherwise.
 */
export function tileTransform(
  x: number,
  y: number,
  width: number,
  height: number,
  flipH: boolean,
  flipV: boolean,
  scale: number,
  flipD = false,
): Transform {
  const sx = flipH ? -scale : scale;
  const sy = flipV ? -scale : scale;
  const e = (flipH ? x + width : x) * scale;
  const f = (flipV ? y + height : y) * scale;
  // x' = a·u + c·v + e, y' = b·u + d·v + f; the transpose swaps which of u, v feeds x'.
  return flipD ? [0, sy, sx, 0, e, f] : [sx, 0, 0, sy, e, f];
}

/** Canvas operations for `list` at `scale`, bottom layer first. Empty layers emit nothing. */
export function compositeOps(list: DrawList, scale: number): CanvasOp[] {
  const ops: CanvasOp[] = [];
  let alpha = 1;
  for (const layer of list.layers) {
    if (layer.items.length === 0) continue;
    if (layer.opacity !== alpha) {
      ops.push({ kind: "alpha", alpha: layer.opacity });
      alpha = layer.opacity;
    }
    for (const item of layer.items) {
      const { src, dest } = item;
      ops.push({
        kind: "draw",
        tilesetId: item.tileset.id,
        sx: src.x,
        sy: src.y,
        sw: src.width,
        sh: src.height,
        transform: tileTransform(dest.x, dest.y, dest.width, dest.height, item.flipH, item.flipV, scale, item.flipD),
        dw: item.flipD ? dest.height : dest.width,
        dh: item.flipD ? dest.width : dest.height,
      });
    }
  }
  return ops;
}

/** Output size in pixels of a `width × height` map image at `scale`. */
export function pngSize(width: number, height: number, scale: number): { width: number; height: number } {
  return { width: width * scale, height: height * scale };
}

/** Whether a `width × height` image at `scale` fits the canvas limits. */
export function pngFits(width: number, height: number, scale: number): boolean {
  const size = pngSize(width, height, scale);
  return (
    size.width > 0 &&
    size.height > 0 &&
    size.width <= PNG_MAX_SIDE &&
    size.height <= PNG_MAX_SIDE &&
    size.width * size.height <= PNG_MAX_PIXELS
  );
}

/** The largest offered scale that fits (`null` when even 1× is too big). */
export function largestFittingScale(width: number, height: number): PngScale | null {
  for (let i = PNG_SCALES.length - 1; i >= 0; i--) {
    const scale = PNG_SCALES[i]!;
    if (pngFits(width, height, scale)) return scale;
  }
  return null;
}

/** Ids of tilesets the ops draw from (to check that every image is loaded). */
export function opsTilesets(ops: readonly CanvasOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) if (op.kind === "draw") ids.add(op.tilesetId);
  return ids;
}
