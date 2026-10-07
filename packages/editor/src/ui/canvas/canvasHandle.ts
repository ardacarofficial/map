import type { CanvasHandle } from "../../canvas";

/** Marks the element that hosts the canvas (used for focus checks, e.g. `Tab`). */
export const CANVAS_HOST_ATTR = "data-canvas-host";

let current: CanvasHandle | null = null;

/** The mounted canvas, or `null` (welcome screen, or still starting). */
export function getCanvasHandle(): CanvasHandle | null {
  return current;
}

const listeners = new Set<(handle: CanvasHandle | null) => void>();

/** Runs `cb` with the current canvas and again whenever it is mounted / unmounted. Returns an unsubscribe. */
export function watchCanvasHandle(cb: (handle: CanvasHandle | null) => void): () => void {
  listeners.add(cb);
  cb(current);
  return () => listeners.delete(cb);
}

/** @internal Set by `CanvasHost`. */
export function setCanvasHandle(handle: CanvasHandle | null): void {
  current = handle;
  for (const cb of [...listeners]) cb(handle);
}
