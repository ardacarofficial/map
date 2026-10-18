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
/** Highest level-view zoom: the largest preset (1600 %). */
export const MAX_ZOOM = 16;

/**
 * Zoom presets of the level view (12.5 % … 1600 %). Wheel notches, Ctrl+± and
 * a finished pinch settle on these; the UI's zoom dropdown lists them.
 * Integer steps at ≥ 100 % draw every tile pixel as a whole number of
 * device pixels at 100 % Windows scaling, and every step draws every tile at
 * the same whole device-pixel size (see {@link quantizeZoom}).
 */
export const ZOOM_PRESETS: readonly number[] = [0.125, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];

/** Zoom levels used by zoom-in / zoom-out commands (same as {@link ZOOM_PRESETS}). */
export const ZOOM_STEPS: readonly number[] = ZOOM_PRESETS;

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

/**
 * Next zoom step strictly above (`dir` = 1) or below (`dir` = -1) `zoom`;
 * past the last step: `max` / `min`.
 */
export function nextZoomStep(zoom: number, dir: 1 | -1, steps: readonly number[] = ZOOM_STEPS, min = MIN_ZOOM, max = MAX_ZOOM): number {
  const eps = 1e-6;
  if (dir > 0) return steps.find((s) => s > zoom * (1 + eps) && s <= max) ?? max;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s < zoom * (1 - eps) && s >= min) return s;
  }
  return min;
}

/** The step closest to `zoom` in log space (a pinch settles there). */
export function nearestZoomStep(zoom: number, steps: readonly number[] = ZOOM_STEPS): number {
  let best = steps[0] ?? zoom;
  let bestD = Infinity;
  const lz = Math.log(Math.max(1e-9, zoom));
  for (const s of steps) {
    const d = Math.abs(Math.log(s) - lz);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Wheel distance (px) of one zoom step for small-delta wheels (high-resolution mice). */
export const WHEEL_STEP_PX = 100;
/** A single wheel event at least this large (px) is one whole notch. */
export const WHEEL_NOTCH_PX = 50;

/**
 * Zoom steps of one wheel event: a notch (line / page mode, or ≥
 * {@link WHEEL_NOTCH_PX}) is one step; smaller deltas (high-resolution
 * wheels) accumulate in `acc` until they make {@link WHEEL_STEP_PX}.
 * Positive steps zoom in (wheel up = negative delta). Returns the new
 * accumulator; reset it to 0 when the gesture pauses.
 */
export function wheelZoomSteps(deltaPx: number, deltaMode: number, acc: number): { steps: number; acc: number } {
  if (deltaPx === 0) return { steps: 0, acc };
  if (deltaMode !== 0 || Math.abs(deltaPx) >= WHEEL_NOTCH_PX) return { steps: deltaPx < 0 ? 1 : -1, acc: 0 };
  // A change of direction starts over.
  const next = Math.sign(acc) === -Math.sign(deltaPx) ? deltaPx : acc + deltaPx;
  const whole = Math.trunc(next / WHEEL_STEP_PX);
  return { steps: whole === 0 ? 0 : -whole, acc: next - whole * WHEEL_STEP_PX };
}

/** Largest pixel-exact preset or whole-device-pixel tile step no greater than the fit. */
export function initialZoom(fit: number, tileSize: number, resolution = 1, steps: readonly number[] = ZOOM_PRESETS): number {
  const unit = Math.max(1, tileSize) * resolution;
  let best = Math.floor(fit * unit + 1e-9) / unit;
  for (const step of steps) {
    if (step <= fit + 1e-9 && Math.abs(step * unit - Math.round(step * unit)) < 1e-9) best = Math.max(best, step);
  }
  // A map larger than one device pixel per tile can still be opened in full.
  return best > 0 ? best : fit;
}

/** Pixel snapping for {@link fitZoom}: tile size (world px) and device pixels per CSS px. */
export interface FitSnap {
  readonly tileSize: number;
  readonly resolution: number;
}

/** How far below the exact fit a pixel-snapped zoom may fall and still be preferred. */
export const FIT_SNAP_TOLERANCE = 0.1;

/**
 * Zoom that fits a `mapW`×`mapH` px map into the view with `padding` CSS px
 * on each side, capped at `max`. Continuous (not a {@link ZOOM_STEPS} level),
 * so a map fills the view whatever its size. With `snap`, the zoom is rounded
 * down to a whole number of device pixels per tile (crisp pixel art) when
 * that is within {@link FIT_SNAP_TOLERANCE} of the exact fit; otherwise the
 * exact fit is used. Never exceeds the exact fit.
 */
export function fitZoom(
  viewW: number,
  viewH: number,
  mapW: number,
  mapH: number,
  padding: number,
  max = 4,
  snap: FitSnap | null = null,
): number {
  const availW = Math.max(1, viewW - padding * 2);
  const availH = Math.max(1, viewH - padding * 2);
  const fit = Math.max(MIN_ZOOM, Math.min(availW / Math.max(1, mapW), availH / Math.max(1, mapH), max));
  if (!snap || snap.tileSize <= 0 || snap.resolution <= 0) return fit;
  const unit = snap.tileSize * snap.resolution;
  const snapped = Math.floor(fit * unit + 1e-9) / unit;
  return snapped >= MIN_ZOOM && snapped >= fit * (1 - FIT_SNAP_TOLERANCE) ? snapped : fit;
}

/** Camera centering a `mapW`×`mapH` px map at `zoom` in a `viewW`×`viewH` view. */
export function centeredCamera(viewW: number, viewH: number, mapW: number, mapH: number, zoom: number): Camera {
  return { x: (viewW - mapW * zoom) / 2, y: (viewH - mapH * zoom) / 2, zoom };
}

/** A box in the bottom-right corner of the view that framing keeps clear (e.g. the minimap), CSS px from the corner. */
export interface CornerBox {
  readonly width: number;
  readonly height: number;
}

/**
 * Frames a `mapW`×`mapH` px map (see {@link fitZoom}), keeping `corner` clear:
 * when the map centred in the whole view would run under it, the map is fitted
 * into the strip left of it or the strip above it, whichever allows the larger
 * zoom, and centred there.
 */
export function frameCamera(
  viewW: number,
  viewH: number,
  mapW: number,
  mapH: number,
  padding: number,
  corner: CornerBox | null = null,
  snap: FitSnap | null = null,
): Camera {
  const zoom = fitZoom(viewW, viewH, mapW, mapH, padding, 4, snap);
  const full = centeredCamera(viewW, viewH, mapW, mapH, zoom);
  if (!corner || corner.width <= 0 || corner.height <= 0) return full;
  const clear = (c: Camera, z: number) =>
    c.x + mapW * z <= viewW - corner.width || c.y + mapH * z <= viewH - corner.height;
  if (clear(full, zoom)) return full;
  // The strip's edge next to the box needs no extra padding: the box has its own margin.
  const leftW = viewW - corner.width + padding;
  const topH = viewH - corner.height + padding;
  const zLeft = leftW > padding * 2 ? fitZoom(leftW, viewH, mapW, mapH, padding, 4, snap) : 0;
  const zTop = topH > padding * 2 ? fitZoom(viewW, topH, mapW, mapH, padding, 4, snap) : 0;
  if (zLeft <= 0 && zTop <= 0) return full;
  return zLeft >= zTop
    ? centeredCamera(leftW, viewH, mapW, mapH, zLeft)
    : centeredCamera(viewW, topH, mapW, mapH, zTop);
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

/**
 * Camera x after the view's left edge moved right by `shift` CSS px (a side
 * column widened; negative = it narrowed): the content keeps its place on
 * screen (`x - shift` in the new view's coordinates). Exception: when the
 * content's left edge (`contentLeft`, view px; null = no such edge) was in
 * view or just outside it (within `near` px), it keeps its distance to the
 * view edge (at most `pad` px in), so a widening column never hides the
 * start of the map the user is working at.
 */
export function compensateViewShift(x: number, shift: number, contentLeft: number | null, pad = 16, near = 64): number {
  const stable = x - shift;
  if (!(shift > 0) || contentLeft === null || contentLeft < -near) return stable;
  const edge = contentLeft - shift;
  const keep = Math.min(contentLeft, pad);
  return edge >= keep ? stable : stable + (keep - edge);
}
