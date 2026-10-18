/** Optional recent-project pictures. Never compose a map on an IO path. */
import {
  RECENT_THUMB_PX,
  thumbnailSnapshots,
  type ThumbnailSnapshotBridge,
  type ThumbnailTag,
} from "../canvas/thumbnailSnapshotBridge";
import type { Pixels } from "../canvas/thumbnailRaster";

export { RECENT_THUMB_PX };

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

/** Encode an owned, ready CPU snapshot, preserving straight alpha and Y down. */
export function captureMapThumbnail(pixels: Pixels, maxPx = RECENT_THUMB_PX): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const src = document.createElement("canvas");
    src.width = pixels.width;
    src.height = pixels.height;
    const ctx = src.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    const image = ctx.createImageData(pixels.width, pixels.height);
    image.data.set(pixels.data);
    ctx.putImageData(image, 0, 0);
    const scale = Math.max(1, Math.floor(maxPx / Math.max(src.width, src.height)));
    let out = src;
    if (scale > 1) {
      out = document.createElement("canvas");
      out.width = src.width * scale;
      out.height = src.height * scale;
      const outCtx = out.getContext("2d", { willReadFrequently: true });
      if (!outCtx) return undefined;
      outCtx.imageSmoothingEnabled = false;
      outCtx.drawImage(src, 0, 0, out.width, out.height);
    }
    const url = out.toDataURL("image/png");
    return isStorableThumbnail(url) ? url : undefined;
  } catch (error) {
    console.warn("Could not encode the recent-project thumbnail", error);
    return undefined;
  }
}

/** Returns cancellation. Even the timeout fallback runs after the save promise. */
export function afterCriticalWork(work: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(work, { timeout: 1000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(work, 0);
  return () => clearTimeout(id);
}

export interface RecentThumbnailRequest {
  tag: ThumbnailTag;
  isCurrent(): boolean;
  publish(thumbnail: string): Promise<void>;
}

/** One coalesced request, no retries/polling while the overview is pending. */
export class RecentThumbnailScheduler {
  #request: RecentThumbnailRequest | null = null;
  #cancelIdle: (() => void) | null = null;
  #running = false;
  readonly #unsubscribe: () => void;

  constructor(
    readonly bridge: ThumbnailSnapshotBridge = thumbnailSnapshots,
    readonly schedule: (work: () => void) => () => void = afterCriticalWork,
    readonly encode: (pixels: Pixels) => string | undefined | Promise<string | undefined> = captureMapThumbnail,
  ) {
    this.#unsubscribe = bridge.subscribe(() => this.#schedule());
  }

  request(request: RecentThumbnailRequest): void {
    this.cancel();
    this.#request = request;
    this.#schedule();
  }

  cancel(): boolean {
    const pending = this.#request !== null;
    this.#cancelIdle?.();
    this.#cancelIdle = null;
    this.#request = null;
    return pending;
  }

  destroy(): void {
    this.cancel();
    this.#unsubscribe();
  }

  #schedule(): void {
    const request = this.#request;
    if (!request) return;
    if (!request.isCurrent()) {
      this.cancel();
      return;
    }
    if (this.#cancelIdle || this.#running || !this.bridge.ready(request.tag)) return;
    this.#cancelIdle = this.schedule(() => {
      this.#cancelIdle = null;
      void this.#run();
    });
  }

  async #run(): Promise<void> {
    const request = this.#request;
    if (!request || !request.isCurrent()) { this.cancel(); return; }
    this.#running = true;
    try {
      const snapshot = this.bridge.snapshot(request.tag);
      if (!snapshot) {
        if (this.bridge.ready(request.tag)) this.#request = null;
        return;
      }
      const url = await this.encode(snapshot.pixels);
      if (this.#request !== request || !request.isCurrent()) return;
      if (!this.bridge.matches(snapshot)) return; // changed during async encoding: try the latest ready revision
      this.#request = null;
      if (isStorableThumbnail(url)) await request.publish(url);
    } catch (error) {
      if (this.#request === request) this.#request = null;
      console.warn("Could not update the recent-project thumbnail", error);
    } finally {
      this.#running = false;
      this.#schedule();
    }
  }
}
