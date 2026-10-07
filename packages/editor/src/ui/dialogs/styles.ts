/** Shared classes for modal dialogs (tokens only). */
// A closing dialog (fade-out) must not swallow the next click / stroke on the canvas.
export const backdropClass =
  "fixed inset-0 z-40 bg-overlay transition-opacity duration-150 data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0";

const popupBase =
  "fixed left-1/2 z-50 -translate-x-1/2 rounded-xl border border-line bg-raised text-text shadow-popup outline-none transition-[opacity,scale] duration-150 ease-(--ease-out) data-ending-style:pointer-events-none data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0";

/** Vertically centered dialog. */
export const popupClass = `${popupBase} top-1/2 -translate-y-1/2`;

/** Dialog anchored near the top (command palette: the list grows downwards without jumping). */
export const popupTopClass = `${popupBase} top-[16%]`;
