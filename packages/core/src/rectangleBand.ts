import type { CellPoint, CellRect } from "./geometry";

/** Whether a cell belongs to a rectangle's inner band. Thickness 0 means filled. */
export function rectangleBandContains(r: CellRect, thickness: number, x: number, y: number): boolean {
  if (x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height) return false;
  return thickness === 0 || Math.min(x - r.x, y - r.y, r.x + r.width - 1 - x, r.y + r.height - 1 - y) < thickness;
}

export function* rectangleBand(r: CellRect, thickness = 0, clip: CellRect = r): Generator<CellPoint> {
  const x0 = Math.max(r.x, clip.x);
  const y0 = Math.max(r.y, clip.y);
  const x1 = Math.min(r.x + r.width, clip.x + clip.width);
  const y1 = Math.min(r.y + r.height, clip.y + clip.height);
  for (let y = y0; y < y1; y++) {
    const full = thickness === 0 || y - r.y < thickness || r.y + r.height - 1 - y < thickness;
    for (let x = x0; x < x1; x++) {
      if (full || x - r.x < thickness || r.x + r.width - 1 - x < thickness) yield { x, y };
      else x = Math.max(x, Math.min(x1, r.x + r.width - thickness) - 1);
    }
  }
}
