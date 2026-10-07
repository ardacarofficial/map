import type { CanvasHandle } from "../../canvas";

/** Marks the element that hosts the canvas (used for focus checks, e.g. `Tab`). */
export const CANVAS_HOST_ATTR = "data-canvas-host";

let current: CanvasHandle | null = null;

/** The mounted canvas, or `null` (welcome screen, or still starting). */
export function getCanvasHandle(): CanvasHandle | null {
  return current;
}

/** @internal Set by `CanvasHost`. */
export function setCanvasHandle(handle: CanvasHandle | null): void {
  current = handle;
}
