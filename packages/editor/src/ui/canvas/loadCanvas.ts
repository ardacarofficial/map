/**
 * The map canvas module (PixiJS + renderers, ~600 kB) is loaded on demand:
 * the welcome screen does not need it, so start-up parses only React and the
 * panels. `preloadCanvas()` warms it up in idle time after the first frame
 * and when a project starts opening, so the editor does not wait for it.
 */
import type * as Canvas from "../../canvas";

type CanvasModule = typeof Canvas;

let pending: Promise<CanvasModule> | null = null;

export function loadCanvasModule(): Promise<CanvasModule> {
  pending ??= import("../../canvas").catch((error: unknown) => {
    pending = null; // a later mount may retry (e.g. after a network hiccup in dev)
    throw error;
  });
  return pending;
}

/** Starts loading the canvas module without waiting for it. */
export function preloadCanvas(): void {
  loadCanvasModule().catch(() => undefined);
}
