/**
 * Canvas colours. Where a design token exists (`src/theme/tokens.css`) the
 * canvas reads it at mount via {@link readThemeColors}; the values here are
 * the fallbacks and the canvas-only colours.
 */
export const CANVAS_COLORS = {
  /** Area outside the map — token `--color-canvas`. */
  outside: 0x101012,
  /** Map area (slightly lighter than the surround). */
  mapBackground: 0x1b1b1f,
  /** 1-device-pixel line around the map — token `--color-line`. */
  mapBorder: 0x2a2a30,
  /** Grid lines (drawn with `gridAlpha`). */
  grid: 0xffffff,
  gridAlpha: 0.09,
  /** Brush preview opacity. */
  previewAlpha: 0.5,
  /** Eraser cell highlight. */
  cursor: 0xffffff,
  cursorShadow: 0x000000,
  /** Selection region, rectangle outline, fill highlight — token `--color-accent`. */
  accent: 0x6d8cff,
  /** Fill of the selection region / select drag. */
  regionFillAlpha: 0.1,
  /** Fill-tool hover highlight. */
  fillPreviewAlpha: 0.35,
  /** Brush / rectangle footprint on a grid layer (accent). */
  gridBrushAlpha: 0.35,
  /** Painted cells of the active terrain layer (accent). */
  terrainTintAlpha: 0.15,
  /** Solid cells of the collision overlay — token `--color-collision-solid`. */
  collisionSolid: 0xff5a5a,
  collisionSolidAlpha: 0.3,
  /** Outline of solid areas (same colour). */
  collisionLineAlpha: 0.9,
  /** Cells a collision layer forces passable — token `--color-collision-passable`. */
  collisionPassable: 0x3ddc84,
  collisionPassableAlpha: 0.45,
};

/** The canvas colour set (fallbacks merged with theme tokens). */
export type CanvasColors = typeof CANVAS_COLORS;

function parseHex(value: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  return m ? parseInt(m[1]!, 16) : null;
}

/** Applies theme tokens (if the stylesheet exposes them as CSS variables) over the fallbacks. */
export function readThemeColors(el: Element): CanvasColors {
  const style = getComputedStyle(el);
  const token = (name: string, fallback: number) => parseHex(style.getPropertyValue(name)) ?? fallback;
  return {
    ...CANVAS_COLORS,
    outside: token("--color-canvas", CANVAS_COLORS.outside),
    mapBorder: token("--color-line", CANVAS_COLORS.mapBorder),
    accent: token("--color-accent", CANVAS_COLORS.accent),
    collisionSolid: token("--color-collision-solid", CANVAS_COLORS.collisionSolid),
    collisionPassable: token("--color-collision-passable", CANVAS_COLORS.collisionPassable),
  };
}
