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
