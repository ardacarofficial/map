/**
 * PixiJS map canvas (WebGL2 only). Pixi is driven directly, not via @pixi/react.
 * The renderer subscribes to `MapStore` change events and rebuilds only
 * dirty chunk meshes.
 *
 * Usage (React): mount on a full-size div, destroy on unmount. Because
 * mounting is async, a StrictMode-safe effect destroys the handle when the
 * promise resolves after cleanup:
 *
 * ```ts
 * useEffect(() => {
 *   let handle: CanvasHandle | null = null;
 *   let cancelled = false;
 *   void mountCanvas(el).then((h) => (cancelled ? h.destroy() : (handle = h)));
 *   return () => { cancelled = true; handle?.destroy(); };
 * }, []);
 * ```
 */
import { MapCanvas, type CanvasHandle } from "./mapCanvas";

export type { CanvasHandle, ScreenRect } from "./mapCanvas";
export type { BlockedAction, BlockedReason, CanvasContextRequest } from "./canvasEvents";
export { ZOOM_PRESETS } from "./camera";

/**
 * Stable public helper: how a wheel event should be read, shared by every
 * zoomable surface (map canvas, tileset panel, tileset import dialog) so
 * the mouse behaves the same everywhere:
 *
 * - mouse wheel notch → `"zoom"` (at the cursor);
 * - Shift + wheel → `"pan"` (horizontal);
 * - trackpad two-finger scroll (small pixel deltas, any horizontal delta,
 *   or an ongoing pan gesture `recentPan`) → `"pan"`;
 * - trackpad pinch (Chrome sends ctrl + small deltas) → `"pinch"`;
 *   ctrl / ⌘ + mouse wheel → `"zoom"`.
 *
 * Pass deltas already in pixels (`deltaMode` 1 = lines ≈ 16 px, 2 = pages
 * ≈ 800 px; see {@link wheelDeltaPixels}) and the original `deltaMode`.
 * Keep `recentPan` true for ~250 ms after the last `"pan"` result so a
 * trackpad gesture does not flip to zooming mid-scroll.
 */
export { classifyWheel, type WheelAction } from "./brush";
export { wheelDeltaPixels } from "./camera";

export async function mountCanvas(container: HTMLElement): Promise<CanvasHandle> {
  const canvas = new MapCanvas(container);
  try {
    await canvas.init();
  } catch (error) {
    canvas.destroy();
    throw error;
  }
  return canvas.handle;
}
