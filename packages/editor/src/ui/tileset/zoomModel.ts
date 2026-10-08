/**
 * Tileset panel zoom, as pure functions (unit tested): the default "fit"
 * scale fills the panel width with the tileset's columns, preferring a
 * whole-number scale (crisp pixels); wheel steps and cursor-anchored scroll.
 */

/** Zoom levels the wheel and the −/+ buttons step through. */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
export const MIN_ZOOM = ZOOM_STEPS[0]!;
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
/** "Fit" never magnifies beyond this (a 2-column tileset would otherwise be huge). */
export const MAX_FIT_SCALE = 6;
/**
 * A whole-number fit is used while it fills at least this share of the
 * width; below it (e.g. 1× in a panel 1.8× as wide) a tile-aligned
 * fractional scale fills the panel instead.
 */
export const MIN_INTEGER_FILL = 0.75;

/**
 * Scale that fits `contentWidth` CSS px (columns × tile width at 1×) into
 * `available` px. Whole numbers when they fill enough of the width; else a
 * scale at which one tile is a whole number of CSS px (grid lines stay sharp).
 */
export function fitScale(available: number, contentWidth: number, tileWidth: number): number {
  if (!(available > 0) || !(contentWidth > 0) || !(tileWidth > 0)) return 1;
  const fit = available / contentWidth;
  if (fit >= 1) {
    const whole = Math.min(MAX_FIT_SCALE, Math.floor(fit));
    if (whole >= MAX_FIT_SCALE || whole / fit >= MIN_INTEGER_FILL) return whole;
  }
  const tilePx = Math.max(1, Math.floor(fit * tileWidth));
  return Math.min(MAX_FIT_SCALE, tilePx / tileWidth);
}

/** Next zoom step above (`direction` 1) or below (-1) `current`; stays put at the ends. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((s) => s > current + 1e-6) ?? Math.max(current, MAX_ZOOM);
  return [...ZOOM_STEPS].reverse().find((s) => s < current - 1e-6) ?? Math.min(current, MIN_ZOOM);
}

/**
 * Scroll offset that keeps the content point under the pointer in place
 * across a zoom. Positions are along one axis, in viewport px:
 * `pointer` = pointer position, `contentStart` = where the content began
 * before the zoom, `newBase` = where it begins at scroll 0 after the zoom
 * (padding + centring offset). The browser clamps the result.
 */
export function anchoredScroll(pointer: number, contentStart: number, oldScale: number, newScale: number, newBase: number): number {
  const u = (pointer - contentStart) / oldScale;
  return Math.max(0, Math.round(newBase + u * newScale - pointer));
}

/** "100%", "150%", "33%". */
export function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
