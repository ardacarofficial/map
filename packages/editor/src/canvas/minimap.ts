/**
 * Minimap (v0.5): a small DOM 2D canvas in the bottom-right corner of the
 * canvas container showing the map thumbnail (the same picture the far-zoom
 * LOD renders) and the viewport rectangle. Click / drag pans the camera.
 * Shown / hidden with `CanvasHandle.setMinimapVisible`.
 */
import type { Camera } from "./camera";
import { minimapLayout, minimapToWorld, viewportRect, type MinimapLayout } from "./minimapMath";

/** Largest minimap drawing area, CSS px. */
const MAX_W = 200;
const MAX_H = 150;
const MARGIN = 12;

export interface MinimapHost {
  /** Thumbnail canvas and its version, or null without a map. */
  thumbnail(): { canvas: HTMLCanvasElement; version: number } | null;
  /** Map size in map px, or null without a map. */
  mapSize(): { width: number; height: number } | null;
  camera(): { camera: Camera; viewW: number; viewH: number };
  /** Moves the camera so map px (`x`, `y`) is at the view centre. */
  centerOnWorld(x: number, y: number): void;
  colors(): { accent: number; background: number };
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
  #visible = true;
  #layout: MinimapLayout = { width: 0, height: 0, scale: 0 };
  #cacheKey = "";
  #drawKey = "";
  /** Thumbnail-independent part of the cache key, and when the cache was last redrawn. */
  #cacheShape = "";
  #cacheAt = -Infinity;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #drag: number | null = null;

  constructor(container: HTMLElement, host: MinimapHost, signal: AbortSignal) {
    this.#host = host;
    const el = this.element;
    el.setAttribute("data-minimap", "");
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "absolute",
      right: `${MARGIN}px`,
      bottom: `${MARGIN}px`,
      padding: "4px",
      borderRadius: "8px",
      background: "var(--color-panel, #19191c)",
      border: "1px solid var(--color-line, #2a2a30)",
      boxShadow: "0 4px 16px rgb(0 0 0 / 0.35)",
      display: "none",
      zIndex: "1",
      lineHeight: "0",
      userSelect: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    Object.assign(this.#canvas.style, { display: "block", cursor: "pointer", touchAction: "none", borderRadius: "4px" });
    el.appendChild(this.#canvas);
    container.appendChild(el);
    const c = this.#canvas;
    const opts = { signal };
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
      try {
        if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    c.addEventListener("pointerup", end, opts);
    c.addEventListener("pointercancel", end, opts);
    c.addEventListener("wheel", (e) => e.preventDefault(), { signal, passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault(), opts);
    signal.addEventListener("abort", () => {
      el.remove();
      if (this.#refreshTimer !== null) clearTimeout(this.#refreshTimer);
    });
  }

  get visible(): boolean {
    return this.#visible;
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    this.#drawKey = "";
    this.draw();
  }

  /** Redraws if anything it shows changed. Cheap when nothing did; call every frame. */
  draw(): void {
    const thumb = this.#host.thumbnail();
    const size = this.#host.mapSize();
    const show = this.#visible && !!thumb && !!size && size.width > 0 && size.height > 0;
    this.element.style.display = show ? "block" : "none";
    if (!show) return;
    const dpr = window.devicePixelRatio || 1;
    const layout = minimapLayout(size.width, size.height, MAX_W, MAX_H);
    this.#layout = layout;
    const bw = Math.max(1, Math.round(layout.width * dpr));
    const bh = Math.max(1, Math.round(layout.height * dpr));
    const colors = this.#host.colors();
    const shape = `${bw}x${bh}|${colors.background}|${thumb.canvas.width}x${thumb.canvas.height}`;
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
      this.#cacheKey = cacheKey;
      this.#cacheShape = shape;
      this.#cacheAt = now;
      this.#drawKey = "";
      const cache = this.#cache;
      cache.width = bw;
      cache.height = bh;
      const ctx = cache.getContext("2d");
      if (ctx) {
        ctx.fillStyle = css(colors.background);
        ctx.fillRect(0, 0, bw, bh);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(thumb.canvas, 0, 0, bw, bh);
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
    const lw = Math.max(1, Math.round(1.5 * dpr));
    ctx.strokeStyle = css(colors.accent);
    ctx.lineWidth = lw;
    ctx.strokeRect(
      Math.min(bw - lw, x0 + lw / 2),
      Math.min(bh - lw, y0 + lw / 2),
      Math.max(1, x1 - x0 - lw),
      Math.max(1, y1 - y0 - lw),
    );
  }

  #panTo(e: PointerEvent): void {
    const size = this.#host.mapSize();
    if (!size) return;
    const r = this.#canvas.getBoundingClientRect();
    const p = minimapToWorld(e.clientX - r.left, e.clientY - r.top, this.#layout, size.width, size.height);
    this.#host.centerOnWorld(p.x, p.y);
  }
}
