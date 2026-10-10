/**
 * Small picture of the open map for the recent-projects list (welcome
 * screen). Taken at save time from the same renderer as the minimap
 * (`MapThumbnail`), letterboxed into a fixed box and stored with the recent
 * entry as a PNG data URL (IndexedDB in the browser, `recent.json` on the
 * desktop).
 */
import type { MapStore } from "@smap/core";

import { MapThumbnail, type ThumbImageLookup } from "../canvas/mapThumbnail";

/** Longest side of a recent-project thumbnail, in px. */
export const RECENT_THUMB_PX = 192;
/** Data URLs longer than this are not stored (a noisy map can compress badly). */
export const RECENT_THUMB_MAX_CHARS = 200_000;

/** True for what may be stored as a thumbnail: a PNG data URL under the size limit. */
export function isStorableThumbnail(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/png;base64,") && value.length <= RECENT_THUMB_MAX_CHARS;
}

/**
 * The thumbnail a recent entry keeps after an update: the new one when it is
 * storable, otherwise the old one (an "open" adds no picture and must not
 * erase the last saved one).
 */
export function mergeThumbnail(previous: string | undefined, next: string | undefined): string | undefined {
  if (isStorableThumbnail(next)) return next;
  return isStorableThumbnail(previous) ? previous : undefined;
}

/**
 * Renders the visible tile layers of `store` into a PNG data URL (longest
 * side ≤ `maxPx`). `undefined` where there is no DOM canvas or rendering
 * fails — a missing thumbnail never fails a save.
 */
export function captureMapThumbnail(store: MapStore, images: ThumbImageLookup, maxPx = RECENT_THUMB_PX): string | undefined {
  if (typeof document === "undefined") return undefined;
  let thumb: MapThumbnail | null = null;
  try {
    thumb = new MapThumbnail(store, images, () => undefined, maxPx);
    // A small picture: one generous budget is enough, the loop is a guard.
    for (let i = 0; i < 64 && thumb.pending; i++) thumb.update(50);
    const src = thumb.canvas;
    if (src.width === 0 || src.height === 0) return undefined;
    // Upscale tiny maps (nearest) so the card is not a blur of a few px.
    const scale = Math.max(1, Math.floor(maxPx / Math.max(src.width, src.height)));
    const out = document.createElement("canvas");
    out.width = src.width * scale;
    out.height = src.height * scale;
    const ctx = out.getContext("2d");
    if (!ctx) return undefined;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, out.width, out.height);
    const url = out.toDataURL("image/png");
    return isStorableThumbnail(url) ? url : undefined;
  } catch (error) {
    console.warn("Could not render the recent-project thumbnail", error);
    return undefined;
  } finally {
    thumb?.destroy();
  }
}
