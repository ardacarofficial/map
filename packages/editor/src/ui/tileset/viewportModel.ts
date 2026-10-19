import type { Tileset } from "@smap/core";

/** Source pixels → viewport CSS pixels. View data only; never map history. */
export interface ViewportTransform { readonly x: number; readonly y: number; readonly scale: number }
export const inversePoint = (v: ViewportTransform, x: number, y: number) => ({ x: (x - v.x) / v.scale, y: (y - v.y) / v.scale });
export const panViewport = (v: ViewportTransform, dx: number, dy: number): ViewportTransform => ({ ...v, x: v.x + dx, y: v.y + dy });
export const wheelScale = (scale: number, delta: number) => Math.max(0.125, Math.min(16, scale * Math.exp(-delta * 0.002)));
export function zoomViewport(v: ViewportTransform, scale: number, x: number, y: number): ViewportTransform {
  const p = inversePoint(v, x, y);
  const next = Math.max(0.125, Math.min(16, scale));
  return { scale: next, x: x - p.x * next, y: y - p.y * next };
}
export const snapOrigin = (v: ViewportTransform, dpr: number): ViewportTransform => ({ ...v, x: Math.round(v.x * dpr) / dpr, y: Math.round(v.y * dpr) / dpr });

/** Reject source margins, gutters and all positions outside the sliced PNG. */
export function sourceCellAt(ts: Pick<Tileset, "tileWidth" | "tileHeight" | "columns" | "rows" | "margin" | "spacing">, point: { x: number; y: number }) {
  const x = point.x - ts.margin;
  const y = point.y - ts.margin;
  const pw = ts.tileWidth + ts.spacing;
  const ph = ts.tileHeight + ts.spacing;
  const col = Math.floor(x / pw);
  const row = Math.floor(y / ph);
  if (col < 0 || row < 0 || col >= ts.columns || row >= ts.rows || x - col * pw >= ts.tileWidth || y - row * ph >= ts.tileHeight) return null;
  return { col, row };
}
