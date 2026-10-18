import type { Camera } from "./camera";
import type { GridLayout } from "./grid";

export interface MajorGridSettings { readonly interval: number; readonly x: number; readonly y: number }
export const DEFAULT_MAJOR_GRID: MajorGridSettings = Object.freeze({ interval: 0, x: 0, y: 0 });

/** Visible guides only, one device pixel wide. Dense guides disappear rather than aliasing. */
export function majorGridLayout(cam: Camera, resolution: number, viewW: number, viewH: number, tileW: number, tileH: number, mapW: number, mapH: number, settings: MajorGridSettings): GridLayout {
  const ox = Math.round(cam.x * resolution), oy = Math.round(cam.y * resolution);
  const cw = tileW * cam.zoom * resolution, ch = tileH * cam.zoom * resolution;
  const left = Math.max(0, ox), top = Math.max(0, oy);
  const right = Math.min(Math.round(viewW * resolution), Math.round(ox + mapW * cw));
  const bottom = Math.min(Math.round(viewH * resolution), Math.round(oy + mapH * ch));
  const xs: number[] = [], ys: number[] = [];
  const interval = settings.interval;
  if (interval >= 2 && interval <= 64 && Number.isInteger(interval) && Math.min(cw, ch) * interval / resolution >= 6 && right > left && bottom > top) {
    const lines = (offset: number, cell: number, origin: number, min: number, max: number, count: number, out: number[]) => {
      const start = Math.max(1, Math.ceil((min - offset) / cell));
      const end = Math.min(count - 1, Math.floor((max - offset) / cell));
      const first = origin + Math.ceil((start - origin) / interval) * interval;
      for (let i = first; i <= end; i += interval) {
        const p = Math.round(offset + i * cell);
        if (p >= min && p < max) out.push(p);
      }
    };
    lines(ox, cw, settings.x, left, right, mapW, xs);
    lines(oy, ch, settings.y, top, bottom, mapH, ys);
  }
  return { xs, ys, left, top, right, bottom, alpha: 1 };
}
