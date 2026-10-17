/**
 * Pure grid-overlay layout: which lines to draw, in whole device pixels.
 * Lines are drawn as 1-device-pixel rectangles so they stay crisp at any
 * zoom and any Windows scaling.
 */
import { type Camera } from "./camera";

export interface GridLayout {
  /** Device-pixel x of each vertical line (interior lines only; the map border is drawn separately). */
  readonly xs: number[];
  /** Device-pixel y of each horizontal line. */
  readonly ys: number[];
  /** Device-pixel extent of the map rectangle clipped to the view: lines span this range. */
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** Final grid opacity (0 = do not draw). */
  readonly alpha: number;
}

/** Cells this small in CSS pixels remain too dense to show a grid. */
export const GRID_HIDE_PX = 6;

/** Grid opacity by camera zoom, with an optional tiny-cell guard. */
export function gridAlpha(zoom: number, cellCssPx = Infinity): number {
  if (cellCssPx <= GRID_HIDE_PX || zoom <= 0.5) return 0;
  if (zoom <= 1) return (zoom - 0.5) * 0.2;
  if (zoom < 2) return 0.1 + (zoom - 1) * 0.04;
  return 0.14;
}

/**
 * Lines visible in a `viewW`×`viewH` CSS px view. Positions are
 * `round(offsetDevice + i * cellDevice)`, the same rounding the tile meshes
 * get (the camera keeps both integers when zoomed in), so lines sit exactly
 * on tile edges.
 */
export function gridLayout(
  cam: Camera,
  resolution: number,
  viewW: number,
  viewH: number,
  tileW: number,
  tileH: number,
  mapW: number,
  mapH: number,
): GridLayout {
  const ox = Math.round(cam.x * resolution);
  const oy = Math.round(cam.y * resolution);
  const cw = tileW * cam.zoom * resolution;
  const ch = tileH * cam.zoom * resolution;
  const vw = Math.round(viewW * resolution);
  const vh = Math.round(viewH * resolution);
  const left = Math.max(0, ox);
  const top = Math.max(0, oy);
  const right = Math.min(vw, Math.round(ox + mapW * cw));
  const bottom = Math.min(vh, Math.round(oy + mapH * ch));
  const alpha = gridAlpha(cam.zoom, Math.min(cw, ch) / resolution);
  const xs: number[] = [];
  const ys: number[] = [];
  if (alpha > 0 && right > left && bottom > top) {
    const i0 = Math.max(1, Math.ceil((left - ox) / cw));
    const i1 = Math.min(mapW - 1, Math.floor((right - ox) / cw));
    for (let i = i0; i <= i1; i++) {
      const x = Math.round(ox + i * cw);
      if (x >= left && x < right) xs.push(x);
    }
    const j0 = Math.max(1, Math.ceil((top - oy) / ch));
    const j1 = Math.min(mapH - 1, Math.floor((bottom - oy) / ch));
    for (let j = j0; j <= j1; j++) {
      const y = Math.round(oy + j * ch);
      if (y >= top && y < bottom) ys.push(y);
    }
  }
  return { xs, ys, left, top, right, bottom, alpha };
}
