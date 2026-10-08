/**
 * Brush size steps (tool options bar − / + and the `[` / `]` shortcuts). Size lives in the editor store
 * (`brushSize`, 1–16); the canvas reads it.
 */
export const MIN_BRUSH = 1;
export const MAX_BRUSH = 16;
/** Sizes `[` / `]` and − / + step through; the dropdown lists the common ones. */
export const BRUSH_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;
export const BRUSH_PRESETS = [1, 2, 3, 4, 5, 8] as const;

/** Next size up (dir 1) or down (dir -1) from `size` along BRUSH_STEPS. */
export function stepBrushSize(size: number, dir: 1 | -1): number {
  if (dir > 0) return BRUSH_STEPS.find((s) => s > size) ?? MAX_BRUSH;
  return [...BRUSH_STEPS].reverse().find((s) => s < size) ?? MIN_BRUSH;
}
