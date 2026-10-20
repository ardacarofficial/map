/** Only browser overlay components inspect the DOM; toast producers read published UI state. */
export function findActiveModalScope(): string | null {
  const modals = document.querySelectorAll<HTMLElement>('[data-overlay-modal]:not([data-ending-style])');
  return modals.item(modals.length - 1)?.dataset.overlayModal ?? null;
}
