/** Anchor cell of the 3×3 picker, row-major: 0 = top left, 4 = center, 8 = bottom right. */
export type Anchor = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Content offset for core `resizeMap`: the anchored side keeps its cells,
 * the opposite side grows or shrinks (center: both sides, extra cell on the
 * right / bottom).
 */
export function resizeOffsets(
  from: { width: number; height: number },
  to: { width: number; height: number },
  anchor: Anchor,
): { offsetX: number; offsetY: number } {
  const ax = anchor % 3;
  const ay = Math.floor(anchor / 3);
  const along = (a: number, d: number) => (a === 0 ? 0 : a === 1 ? Math.floor(d / 2) : d);
  return { offsetX: along(ax, to.width - from.width), offsetY: along(ay, to.height - from.height) };
}

/** Arrow rotation (deg, 0 = up) for picker cell `cell`, or null for the anchor / far cells. */
export function arrowRotation(cell: Anchor, anchor: Anchor): number | null {
  const dx = (cell % 3) - (anchor % 3);
  const dy = Math.floor(cell / 3) - Math.floor(anchor / 3);
  if ((dx === 0 && dy === 0) || Math.abs(dx) > 1 || Math.abs(dy) > 1) return null;
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90);
}
