/** Shared geometry for every anchored Base UI overlay. */
export const overlayPosition = {
  sideOffset: 6,
  collisionPadding: 8,
  collisionAvoidance: { side: 'flip', align: 'shift', fallbackAxisSide: 'end' },
  sticky: true,
} as const;

export const dismissOverlayEvent = 'smap:dismiss-overlays';
export const dismissTooltipEvent = 'smap:dismiss-tooltips';
export function dismissTooltips(): void {
  window.dispatchEvent(new Event(dismissTooltipEvent));
}
export function dismissOverlays(): void {
  window.dispatchEvent(new Event(dismissOverlayEvent));
  dismissTooltips();
}

// Published by the production lifecycle. Toast producers also run in headless
// desktop flows, so reading their UI scope must never require DOM methods.
let modalScope: string | null = null;
export function activeModalScope(): string | null { return modalScope; }
export function setActiveModalScope(scope: string | null): void { modalScope = scope; }

/** Closing animation callbacks must not steal focus from the user's next action. */
export function canRestoreOverlayFocus(owner: string, openModal: string | null, focusedOutside: boolean): boolean {
  return (!openModal || openModal === owner) && !focusedOutside;
}
