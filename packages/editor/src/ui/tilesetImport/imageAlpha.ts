import { alphaFromRgba } from "@smap/core";

/** Images above this many pixels skip the alpha scan (inference still works from size and name). */
const MAX_ALPHA_PIXELS = 4096 * 4096;

/**
 * The alpha channel of a decoded image (`width * height` bytes), for grid
 * inference and empty-tile dimming. `null` when it cannot be read (no
 * OffscreenCanvas, a closed bitmap, a huge image).
 */
export function readAlpha(bitmap: ImageBitmap): Uint8Array | null {
  const { width, height } = bitmap;
  if (width < 1 || height < 1 || width * height > MAX_ALPHA_PIXELS || typeof OffscreenCanvas === "undefined") return null;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return alphaFromRgba(ctx.getImageData(0, 0, width, height).data, width, height);
  } catch {
    return null;
  }
}
