/**
 * Minimap (v0.5): a small DOM 2D canvas in the bottom-right corner of the
 * canvas container showing the map thumbnail (the same picture the far-zoom
 * LOD renders) and the viewport rectangle. Click / drag pans the camera.
 * Shown / hidden with `CanvasHandle.setMinimapVisible` (the user's choice);
 * while that is on it still hides itself whenever the whole map fits the
 * view (`setAutoHidden`), since it would show nothing new. The wheel over it
 * zooms the map.
 */
import type { Camera } from "./camera";
import { readThemeColors } from "./colors";
import { minimapLayout, minimapToWorld, viewportRect, type MinimapLayout } from "./minimapMath";
import { downscaleOver, type Pixels } from "./thumbnailRaster";

/** Largest minimap frame, CSS px (including its border). */
const MAX_W = 176;
const MAX_H = 120;
/** Below this canvas width (e.g. 1366 px screens) the minimap shrinks so the map keeps the room. */
const NARROW_VIEW = 1000;
const NARROW_SCALE = 0.72;
const MARGIN = 8;
/** Padding + border around the drawing area, CSS px per side. */
const FRAME = 1;
/** Keep the popup fill and border opaque at rest, too. */
const REST_OPACITY = "1";

/** What the minimap needs of `MapThumbnail`. */
export interface MinimapThumbnail {
  readonly version: number;
  /** CPU picture of the whole map (straight-alpha RGBA). */
  readonly overview: Pixels;
  /** Overview px redrawn since the last call (x1 / y1 exclusive), "all", or null. */
  takeDirty(): { x0: number; y0: number; x1: number; y1: number } | "all" | null;
}

export interface MinimapHost {
  /** The map thumbnail (canvas, version, redrawn area), or null without a map. */
  thumbnail(): MinimapThumbnail | null;
  /** Map size in map px, or null without a map. */
  mapSize(): { width: number; height: number } | null;
  camera(): { camera: Camera; viewW: number; viewH: number };
  /** Moves the camera so map px (`x`, `y`) is at the view centre. */
  centerOnWorld(x: number, y: number): void;
  colors(): { accent: number; background: number };
  /** A wheel event over the minimap: zoom the map (around the view centre). */
  wheel?(e: WheelEvent): void;
}

function css(color: number, alpha = 1): string {
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
}

/** Shortest interval between two redraws of the scaled-down picture while it changes. */
const CACHE_REFRESH_MS = 150;

export class Minimap {
  readonly element = document.createElement("div");
  readonly #canvas = document.createElement("canvas");
  /** Thumbnail scaled to the minimap size (redrawn when the thumbnail changes). */
  readonly #cache = document.createElement("canvas");
  readonly #host: MinimapHost;
  readonly #accentCss: string;
  readonly #keylineCss: string;
  #visible = true;
  #autoHidden = false;
  #layout: MinimapLayout = { width: 0, height: 0, scale: 0 };
  #cacheKey = "";
  #drawKey = "";
  /** Thumbnail-independent part of the cache key, and when the cache was last redrawn. */
  #cacheShape = "";
  #cacheAt = -Infinity;
  /** Thumbnail the cache was drawn from (a new map brings a new one). */
  #cacheThumb: MinimapThumbnail | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #drag: number | null = null;

  constructor(container: HTMLElement, host: MinimapHost, signal: AbortSignal) {
    this.#host = host;
    const colors = readThemeColors(container);
    this.#accentCss = css(colors.accent);
    this.#keylineCss = css(colors.cursorShadow, 0.6);
    const el = this.element;
    el.setAttribute("data-minimap", "");
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "absolute",
      right: `${MARGIN}px`,
      bottom: `${MARGIN}px`,
      borderRadius: "6px",
      background: css(colors.popup),
      border: `1px solid ${css(colors.lineStrong)}`,
      display: "none",
      zIndex: "var(--overlay-chrome)",
      lineHeight: "0",
      userSelect: "none",
      opacity: REST_OPACITY,
      transition: "opacity 120ms ease-out",
    } satisfies Partial<CSSStyleDeclaration>);
    Object.assign(this.#canvas.style, { display: "block", cursor: "pointer", touchAction: "none", borderRadius: "5px" });
    el.appendChild(this.#canvas);
    container.appendChild(el);
    const c = this.#canvas;
    const opts = { signal };
    el.addEventListener("pointerenter", () => this.#setActive(true), opts);
    el.addEventListener("pointerleave", () => this.#setActive(this.#drag !== null), opts);
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.#drag = e.pointerId;
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // pointer gone
      }
      this.#panTo(e);
    }, opts);
    c.addEventListener("pointermove", (e) => {
      if (this.#drag === e.pointerId) this.#panTo(e);
    }, opts);
    const end = (e: PointerEvent) => {
      if (this.#drag !== e.pointerId) return;
      this.#drag = null;
      if (!el.matches(":hover")) this.#setActive(false);
      try {
        if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    c.addEventListener("pointerup", end, opts);
    c.addEventListener("pointercancel", end, opts);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.#host.wheel?.(e);
    }, { signal, passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault(), opts);
    signal.addEventListener("abort", () => {
      el.remove();
      if (this.#refreshTimer !== null) clearTimeout(this.#refreshTimer);
    });
  }

  #setActive(active: boolean): void {
    this.element.style.opacity = active ? "1" : REST_OPACITY;
  }

  /**
   * Space the minimap takes from the bottom-right corner of the canvas
   * (margin included), CSS px, or null when hidden. From the layout math, so
   * it is known before the first draw (framing a just-opened map).
   */
  footprint(): { width: number; height: number } | null {
    const size = this.#host.mapSize();
    if (!this.visible || !size || size.width <= 0 || size.height <= 0) return null;
    const layout = this.#layoutFor(size);
    return { width: layout.width + 2 * FRAME + MARGIN, height: layout.height + 2 * FRAME + MARGIN };
  }

  /** Drawing area for a map of `size` map px: smaller in a narrow canvas. */
  #layoutFor(size: { width: number; height: number }): MinimapLayout {
    const k = this.#host.camera().viewW < NARROW_VIEW ? NARROW_SCALE : 1;
    return minimapLayout(size.width, size.height, Math.round(MAX_W * k) - 2 * FRAME, Math.round(MAX_H * k) - 2 * FRAME);
  }

  /** Shown right now: the user's choice and not auto-hidden. */
  get visible(): boolean {
    return this.#visible && !this.#autoHidden;
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    this.#drawKey = "";
    this.draw();
  }

  /** Hides the minimap while the whole map is in view (the user's choice still applies otherwise). */
  setAutoHidden(hidden: boolean): void {
    if (hidden === this.#autoHidden) return;
    this.#autoHidden = hidden;
    this.#drawKey = "";
    // Keep the pointer state sane if it disappears under a drag.
    if (hidden) this.#drag = null;
  }

  /** Redraws if anything it shows changed. Cheap when nothing did; call every frame. */
  draw(): void {
    const thumb = this.#host.thumbnail();
    const size = this.#host.mapSize();
    const show = this.visible && !!thumb && !!size && size.width > 0 && size.height > 0;
    this.element.style.display = show ? "block" : "none";
    if (!show) return;
    const dpr = window.devicePixelRatio || 1;
    const layout = this.#layoutFor(size);
    this.#layout = layout;
    const bw = Math.max(1, Math.round(layout.width * dpr));
    const bh = Math.max(1, Math.round(layout.height * dpr));
    const colors = this.#host.colors();
    const shape = `${bw}x${bh}|${colors.background}|${thumb.overview.width}x${thumb.overview.height}`;
    if (thumb !== this.#cacheThumb) {
      // Another map: its versions start over, so the key alone cannot tell. Redraw now.
      this.#cacheKey = "";
      this.#cacheShape = "";
    }
    let cacheKey = `${thumb.version}|${shape}`;
    // While the picture keeps changing (a big edit is recomposited slice by slice), scaling the
    // whole thumbnail (up to 4096² px) down on every slice is wasted work: refresh at most every
    // CACHE_REFRESH_MS and once more when it settles.
    const now = performance.now();
    if (cacheKey !== this.#cacheKey && shape === this.#cacheShape && now - this.#cacheAt < CACHE_REFRESH_MS) {
      this.#refreshTimer ??= setTimeout(() => {
        this.#refreshTimer = null;
        this.draw();
      }, CACHE_REFRESH_MS - (now - this.#cacheAt));
      cacheKey = this.#cacheKey;
    }
    if (cacheKey !== this.#cacheKey) {
      const dirty = thumb.takeDirty();
      const full = dirty === "all" || shape !== this.#cacheShape || thumb !== this.#cacheThumb;
      this.#cacheKey = cacheKey;
      this.#cacheShape = shape;
      this.#cacheThumb = thumb;
      this.#cacheAt = now;
      this.#drawKey = "";
      const cache = this.#cache;
      if (full) {
        cache.width = bw;
        cache.height = bh;
      }
      const ctx = cache.getContext("2d");
      if (ctx && (full || dirty)) {
        // Box filter of the CPU overview, only where it changed (see MapThumbnail.overview).
        const ov = thumb.overview;
        const sx = bw / ov.width;
        const sy = bh / ov.height;
        const r = full || !dirty ? { x0: 0, y0: 0, x1: ov.width, y1: ov.height } : dirty;
        // Cache px touched by the changed overview px (box filter: no wider reach).
        const dx0 = Math.max(0, Math.floor(r.x0 * sx));
        const dy0 = Math.max(0, Math.floor(r.y0 * sy));
        const dx1 = Math.min(bw, Math.ceil(r.x1 * sx));
        const dy1 = Math.min(bh, Math.ceil(r.y1 * sy));
        if (dx1 > dx0 && dy1 > dy0) {
          const image = new ImageData(dx1 - dx0, dy1 - dy0);
          downscaleOver(ov, 0, 0, ov.width, ov.height, sx, sy, dx0, dy0, image.width, image.height, colors.background, image.data);
          ctx.putImageData(image, dx0, dy0);
        }
      }
    }
    const { camera, viewW, viewH } = this.#host.camera();
    const vr = viewportRect(camera, viewW, viewH, layout);
    const drawKey = `${cacheKey}|${vr.x.toFixed(2)},${vr.y.toFixed(2)},${vr.width.toFixed(2)},${vr.height.toFixed(2)}|${colors.accent}`;
    if (drawKey === this.#drawKey) return;
    this.#drawKey = drawKey;
    const c = this.#canvas;
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    c.style.width = `${layout.width}px`;
    c.style.height = `${layout.height}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, bw, bh);
    ctx.drawImage(this.#cache, 0, 0);
    if (vr.width <= 0 || vr.height <= 0) return;
    // Viewport: dim outside, accent frame inside.
    const x0 = Math.round(vr.x * dpr);
    const y0 = Math.round(vr.y * dpr);
    const x1 = Math.round((vr.x + vr.width) * dpr);
    const y1 = Math.round((vr.y + vr.height) * dpr);
    const covers = x0 <= 0 && y0 <= 0 && x1 >= bw && y1 >= bh;
    if (!covers) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.beginPath();
      ctx.rect(0, 0, bw, bh);
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.fill("evenodd");
    }
    // One device pixel outside the accent frame keeps it visible on light tiles.
    const lw = 1;
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.#keylineCss;
    ctx.strokeRect(x0 - lw / 2, y0 - lw / 2, Math.max(1, x1 - x0 + lw), Math.max(1, y1 - y0 + lw));
    ctx.strokeStyle = this.#accentCss;
    ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, Math.max(1, x1 - x0 - lw), Math.max(1, y1 - y0 - lw));
  }

  #panTo(e: PointerEvent): void {
    const size = this.#host.mapSize();
    if (!size) return;
    const r = this.#canvas.getBoundingClientRect();
    const p = minimapToWorld(e.clientX - r.left, e.clientY - r.top, this.#layout, size.width, size.height);
    this.#host.centerOnWorld(p.x, p.y);
  }
}
