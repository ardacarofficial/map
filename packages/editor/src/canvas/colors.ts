/**
 * Canvas colours. Where a design token exists (`src/theme/tokens.css`) the
 * canvas reads it at mount via {@link readThemeColors}; the values here are
 * the fallbacks and the canvas-only colours.
 */
export const CANVAS_COLORS = {
  /** Area outside the map — token `--color-canvas`. */
  outside: 0x0b1217,
  /** Map area — token `--color-map-bg`. */
  mapBackground: 0x151c23,
  /** 1-device-pixel line around the map — token `--color-line`. */
  mapBorder: 0x323b45,
  /** Grid lines (drawn with `gridAlpha`). */
  grid: 0xffffff,
  /** Brush preview opacity. */
  previewAlpha: 0.5,
  /** White for marching ants and pick dashes (footprints use accent / danger). */
  cursor: 0xffffff,
  cursorShadow: 0x000000,
  /** Popup surfaces, outlines and label text. */
  popup: 0x212932,
  lineStrong: 0x414b56,
  text: 0xe6ebf0,
  muted: 0xa4adb7,
  /** Selection region, rectangle outline, fill highlight — token `--color-accent`. */
  accent: 0x69c9ae,
  /** Fill of the selection region / select drag. */
  regionFillAlpha: 0.1,
  /** Fill-tool hover highlight. */
  fillPreviewAlpha: 0.35,
  /** Brush / rectangle footprint on a grid layer (accent). */
  gridBrushAlpha: 0.35,

  /** Solid cells of the collision overlay — token `--color-collision-solid`. */
  collisionSolid: 0xff5468,
  collisionSolidAlpha: 0.3,
  /** Outline of solid areas (same colour). */
  collisionLineAlpha: 0.9,
  /** Cells a collision layer forces passable — token `--color-collision-pass`. */
  collisionPassable: 0x5cb2ff,
  collisionPassableAlpha: 0.45,
  /** Built-in spawn point — token `--color-entity-spawn` (fallback: core's built-in type colour). */
  entitySpawn: 0x4ade80,
  /** Built-in portal — token `--color-entity-portal`. */
  entityPortal: 0xb47bff,
  /** Portal whose target level was removed, entity of an unknown type — token `--color-danger`. */
  danger: 0xf0707a,
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
    mapBackground: token("--color-map-bg", CANVAS_COLORS.mapBackground),
    popup: token("--color-popup", CANVAS_COLORS.popup),
    lineStrong: token("--color-line-strong", CANVAS_COLORS.lineStrong),
    text: token("--color-text", CANVAS_COLORS.text),
    muted: token("--color-muted", CANVAS_COLORS.muted),
    mapBorder: token("--color-line", CANVAS_COLORS.mapBorder),
    accent: token("--color-accent", CANVAS_COLORS.accent),
    collisionSolid: token("--color-collision-solid", CANVAS_COLORS.collisionSolid),
    collisionPassable: token("--color-collision-pass", CANVAS_COLORS.collisionPassable),
    entitySpawn: token("--color-entity-spawn", CANVAS_COLORS.entitySpawn),
    entityPortal: token("--color-entity-portal", CANVAS_COLORS.entityPortal),
    danger: token("--color-danger", CANVAS_COLORS.danger),
  };
}
