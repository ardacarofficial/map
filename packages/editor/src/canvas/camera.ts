/**
 * Pure camera math for the map canvas. No DOM, no Pixi.
 *
 * Coordinate spaces:
 * - **screen**: CSS pixels relative to the canvas' top-left corner.
 * - **device**: physical pixels (`screen * resolution`).
 * - **world**: map pixels (cell `(cx, cy)` covers `[cx*tileW, (cx+1)*tileW)`).
 *
 * `screen = world * zoom + offset`. The offset is kept continuous (smooth
 * panning) and snapped to whole device pixels only where it is used
 * ({@link snappedOffset}), so every tile edge lands on a device pixel.
 */

export interface Camera {
  /** Screen x (CSS px) of world x = 0. */
  readonly x: number;
  /** Screen y (CSS px) of world y = 0. */
  readonly y: number;
  /** CSS pixels per world pixel. */
  readonly zoom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 32;

/** Zoom levels used by zoom-in / zoom-out commands (pixel-art friendly). */
export const ZOOM_STEPS: readonly number[] = [
  0.1, 0.125, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32,
];

/**
 * Below this many device pixels per tile the zoom is left continuous;
 * above it, the zoom is quantized so a tile is a whole number of device pixels.
 */
export const QUANTIZE_MIN_TILE_DEVICE_PX = 8;

export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  if (!Number.isFinite(zoom)) return Math.min(max, Math.max(min, 1));
  return Math.min(max, Math.max(min, zoom));
}

/**
 * Quantizes `zoom` so one tile spans a whole number of device pixels. Every
 * tile then has exactly the same on-screen width (no 32/33/32/33 jitter at
 * 125 % / 150 % Windows scaling). Tiny tiles are left continuous so zooming
 * far out stays smooth.
 */
export function quantizeZoom(zoom: number, tileSize: number, resolution: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  const z = clampZoom(zoom, min, max);
  const deviceTile = tileSize * z * resolution;
  if (deviceTile < QUANTIZE_MIN_TILE_DEVICE_PX) return z;
  const q = Math.round(deviceTile) / (tileSize * resolution);
  return q >= min && q <= max ? q : z;
}

/** Offset snapped to whole device pixels, in CSS px. */
export function snappedOffset(cam: Camera, resolution: number): Point {
  return { x: Math.round(cam.x * resolution) / resolution, y: Math.round(cam.y * resolution) / resolution };
}

/** Screen (CSS px) → world px, using the snapped offset the renderer draws with. */
export function screenToWorld(cam: Camera, sx: number, sy: number, resolution: number): Point {
  const o = snappedOffset(cam, resolution);
  return { x: (sx - o.x) / cam.zoom, y: (sy - o.y) / cam.zoom };
}

/** World px → screen (CSS px), using the snapped offset. */
export function worldToScreen(cam: Camera, wx: number, wy: number, resolution: number): Point {
  const o = snappedOffset(cam, resolution);
  return { x: wx * cam.zoom + o.x, y: wy * cam.zoom + o.y };
}

/** Cell under a screen point (may be outside the map). */
export function screenToCell(
  cam: Camera,
  sx: number,
  sy: number,
  tileW: number,
  tileH: number,
  resolution: number,
): Point {
  const w = screenToWorld(cam, sx, sy, resolution);
  return { x: Math.floor(w.x / tileW), y: Math.floor(w.y / tileH) };
}

/** Camera with `zoom` such that world point `world` stays at screen point `screen`. */
export function cameraAnchored(screen: Point, world: Point, zoom: number): Camera {
  return { x: screen.x - world.x * zoom, y: screen.y - world.y * zoom, zoom };
}

/** Zooms to `newZoom` keeping the world point under screen (`sx`, `sy`) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, newZoom: number): Camera {
  const world = { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
  return cameraAnchored({ x: sx, y: sy }, world, newZoom);
}

/**
 * Exponential ease of `current` toward `target` in log space (zoom feels
 * uniform at every scale). `tauMs` is the time constant. Returns `target`
 * once close enough.
 */
export function easeZoom(current: number, target: number, dtMs: number, tauMs: number): number {
  const lc = Math.log(current);
  const lt = Math.log(target);
  const t = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  const next = lc + (lt - lc) * t;
  if (Math.abs(lt - next) < 0.002) return target;
  return Math.exp(next);
}

/** Normalizes a wheel delta to pixels (`deltaMode` 1 = lines, 2 = pages). */
export function wheelDeltaPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 800;
  return delta;
}

/**
 * Zoom multiplier for one wheel event. `pinch` = trackpad pinch (Chrome sends
 * it as ctrl+wheel with small deltas). Mouse notches (~100 px) give ×1.25;
 * a single event is clamped so huge deltas cannot jump.
 */
export function wheelZoomFactor(deltaPx: number, pinch: boolean): number {
  if (pinch) return Math.exp(-Math.max(-50, Math.min(50, deltaPx)) * 0.01);
  const d = Math.max(-300, Math.min(300, deltaPx));
  return Math.exp(-d * (Math.LN2 / 310));
}

/** Next zoom step strictly above (`dir` = 1) or below (`dir` = -1) `zoom`. */
export function nextZoomStep(zoom: number, dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir > 0) return ZOOM_STEPS.find((s) => s > zoom * (1 + eps)) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const s = ZOOM_STEPS[i]!;
    if (s < zoom * (1 - eps)) return s;
  }
  return MIN_ZOOM;
}

/**
 * Zoom that fits a `mapW`×`mapH` px map into the view with `padding` CSS px
 * on each side: the largest {@link ZOOM_STEPS} level that fits, capped at `max`.
 */
export function fitZoom(
  viewW: number,
  viewH: number,
  mapW: number,
  mapH: number,
  padding: number,
  max = 4,
): number {
  const availW = Math.max(1, viewW - padding * 2);
  const availH = Math.max(1, viewH - padding * 2);
  const fit = Math.min(availW / mapW, availH / mapH, max);
  let best = MIN_ZOOM;
  for (const s of ZOOM_STEPS) if (s <= fit + 1e-9) best = s;
  return best;
}

/** Camera centering a `mapW`×`mapH` px map at `zoom` in a `viewW`×`viewH` view. */
export function centeredCamera(viewW: number, viewH: number, mapW: number, mapH: number, zoom: number): Camera {
  return { x: (viewW - mapW * zoom) / 2, y: (viewH - mapH * zoom) / 2, zoom };
}

/** Inclusive-exclusive range of cells, clipped to the map. Empty when `x1 <= x0` or `y1 <= y0`. */
export interface CellRange {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Cells (clipped to `mapW`×`mapH`) that are at least partly visible. */
export function visibleCells(
  cam: Camera,
  viewW: number,
  viewH: number,
  tileW: number,
  tileH: number,
  mapW: number,
  mapH: number,
  resolution: number,
): CellRange {
  const a = screenToWorld(cam, 0, 0, resolution);
  const b = screenToWorld(cam, viewW, viewH, resolution);
  return {
    x0: Math.max(0, Math.floor(a.x / tileW)),
    y0: Math.max(0, Math.floor(a.y / tileH)),
    x1: Math.min(mapW, Math.ceil(b.x / tileW)),
    y1: Math.min(mapH, Math.ceil(b.y / tileH)),
  };
}
