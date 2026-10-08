/** Gap between the undo pill and a toast stack it has to clear (CSS px). */
export const HUD_STACK_GAP = 8;

export interface HRange {
  left: number;
  right: number;
}

export interface Box extends HRange {
  top: number;
  bottom: number;
}

/**
 * Bottom offset (CSS px, from the container's bottom edge) for the undo pill
 * so it never covers the toast stack: `base` normally; when the toasts sit in
 * the same columns as the pill and reach above `base`, the pill moves up to
 * sit `gap` above them (stacked, never overlapping).
 */
export function hudBottom(pill: HRange | null, toasts: Box | null, containerBottom: number, base: number, gap = HUD_STACK_GAP): number {
  if (!pill || !toasts || toasts.bottom <= toasts.top) return base;
  const sharesColumns = pill.left < toasts.right + gap && toasts.left - gap < pill.right;
  if (!sharesColumns) return base;
  // The toasts' top, measured from the container's bottom edge.
  const toastsTop = containerBottom - toasts.top;
  return Math.max(base, Math.ceil(toastsTop + gap));
}
