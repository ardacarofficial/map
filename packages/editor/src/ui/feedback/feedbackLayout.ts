/** Canvas-local placement; the stack is 12 px inset and clears the minimap by 8 px. */
export function feedbackPlacement(canvasWidth: number, stackWidth: number, minimapLeft?: number): { maxWidth: number; center: number } {
  const gutter = minimapLeft === undefined || minimapLeft - 20 >= 160 ? minimapLeft : undefined;
  const right = Math.min(canvasWidth - 12, gutter === undefined ? Infinity : gutter - 8);
  const maxWidth = Math.max(0, right - 12);
  const width = Math.min(stackWidth, maxWidth);
  return { maxWidth, center: Math.max(12 + width / 2, Math.min(canvasWidth / 2, right - width / 2)) };
}
