/**
 * RGBA pixels of a tileset image for core `detectTerrainBlock`, decoded once
 * per image (cached by bitmap: a replaced image decodes again).
 */
import type { RgbaImage } from "@smap/core";

import { getTilesetImage } from "../../state/tilesetImages";

const cache = new WeakMap<ImageBitmap, RgbaImage>();

/** Pixels of `tilesetId`'s image, or null when it is not loaded / cannot be read. */
export function tilesetPixels(tilesetId: string): RgbaImage | null {
  const bitmap = getTilesetImage(tilesetId)?.bitmap;
  if (!bitmap) return null;
  const hit = cache.get(bitmap);
  if (hit) return hit;
  try {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bitmap.width, bitmap.height) : document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const image: RgbaImage = { width: data.width, height: data.height, data: data.data };
    cache.set(bitmap, image);
    return image;
  } catch (error) {
    console.warn("[terrain] cannot read tileset pixels", error);
    return null;
  }
}
