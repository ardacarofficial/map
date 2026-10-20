/** Shared modal classes and S/M/L widths (400/560/880px). */
// A closing dialog must not swallow the next click / stroke on the canvas.
export const backdropClass =
  "fixed inset-0 z-(--overlay-modal-backdrop) bg-overlay transition-opacity duration-(--duration-ui) data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0";

const popupBase =
  "fixed left-1/2 z-(--overlay-modal) -translate-x-1/2 rounded-lg border border-line-strong bg-popup text-text shadow-popup outline-none transition-opacity duration-(--duration-ui) ease-out data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0";

/** Vertically centered dialog. */
export const popupClass = `${popupBase} top-1/2 -translate-y-1/2`;
/** Top-anchored command palette, allowing its list to grow downwards. */
export const popupTopClass = `${popupBase} top-[12vh]`;
export const dialogWidthS = "w-dialog-s";
export const dialogWidthM = "w-dialog-m";
export const dialogWidthL = "w-dialog-l";
