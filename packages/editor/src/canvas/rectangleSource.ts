import { flipClip, rectangleBandContains, type CellRect, type TileClip } from "@smap/core";

import type { RandomStampPlacement } from "./randomPaint";

/**
 * A random stamp's contribution to a rectangle band. Orient first, then mask
 * each layer; preview and placement consume the same flat clip. Empty cells
 * retain paste's usual skip semantics, so the interior is never erased.
 */
export function rectangleStampSource(
  stamp: TileClip,
  placement: Pick<RandomStampPlacement, "x" | "y" | "flip">,
  region: CellRect,
  thickness: number,
): TileClip | null {
  let clip = stamp;
  if (placement.flip.x) clip = flipClip(clip, "x");
  if (placement.flip.y) clip = flipClip(clip, "y");
  let any = false;
  const layers = clip.layers.map(layer => {
    const cells = new Uint32Array(layer.cells.length);
    for (let i = 0; i < cells.length; i++) {
      const cell = layer.cells[i]!;
      if (cell === 0 || !rectangleBandContains(region, thickness, placement.x + i % clip.width, placement.y + Math.floor(i / clip.width))) continue;
      cells[i] = cell;
      any = true;
    }
    return { ...layer, cells };
  });
  return any ? { ...clip, layers } : null;
}
