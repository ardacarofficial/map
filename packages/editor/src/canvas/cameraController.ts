/**
 * Camera state of the map canvas: view size, device resolution, continuous
 * and quantized zoom, zoom animation and the cell ↔ device-pixel mapping the
 * overlays use. No DOM listeners and no Pixi objects; the canvas feeds it.
 */
import type { CellPoint, MapInfo } from "@smap/core";

import type { CellRegion } from "../state/editorStore";
import {
  cameraAnchored,
  clampZoom,
  compensateViewShift,
  easeZoom,
  frameCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  centeredCamera,
  fitZoom,
  initialZoom,
  nearestZoomStep,
  nextZoomStep,
  quantizeZoom,
  screenToCell,
  snappedOffset,
  visibleCells,
  type Camera,
  type CornerBox,
  type Point,
} from "./camera";
import { cameraCenteredOn, type Rect } from "./minimapMath";

/** Time constant of the wheel-zoom easing. */
const ZOOM_TAU_MS = 55;
const FRAME_PADDING = 48;
/** A pinch settles on the nearest preset after this long without pinch events. */
const PINCH_SETTLE_MS = 160;

/** How a pending / kept framing places the map: the opening view, or "fit map". */
type FrameMode = "initial" | "fit";

interface ZoomAnim {
  current: number;
  target: number;
  anchorScreen: Point;
  anchorWorld: Point;
}

/** Device-pixel box of a cell rectangle (x1/y1 exclusive). */
export interface DeviceBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class CameraController {
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  /** Continuous zoom; `camera.zoom` is its quantized value. */
  zoomLevel = 1;
  viewW = 0;
  viewH = 0;
  resolution = 1;
  /** Zoom limits (the world view zooms further out than a level). */
  minZoom = MIN_ZOOM;
  maxZoom = MAX_ZOOM;
  /**
   * When set, {@link frameMap} frames this world rectangle (map px) instead
   * of the map: the world view frames all levels. `null` from the provider
   * = nothing to frame.
   */
  frameBounds: (() => Rect | null) | null = null;
  /** Bottom-right box {@link frameMap} keeps clear (the minimap), or null. */
  frameCorner: (() => CornerBox | null) | null = null;
  /**
   * Level view: wheel notches, zoom commands and a finished pinch settle on
   * the zoom presets (`ZOOM_STEPS`). The world view zooms in plain factors.
   */
  snapSteps = true;
  #anim: ZoomAnim | null = null;
  #pendingFrameMap = true;
  #frameMode: FrameMode = "initial";
  #settleTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The camera still shows the last {@link frameMap} result (the user has not
   * panned or zoomed since): a view resize re-frames instead of leaving the
   * map off-centre, e.g. when a side column widens.
   */
  #framed = false;
  readonly #map: () => MapInfo | undefined;
  readonly #requestRender: () => void;

  constructor(map: () => MapInfo | undefined, requestRender: () => void) {
    this.#map = map;
    this.#requestRender = requestRender;
  }

  /** Target of the running zoom animation, else the current zoom (base for relative zoom steps). */
  get zoomTarget(): number {
    return this.#anim?.target ?? this.zoomLevel;
  }

  tileSize(): { tw: number; th: number } {
    const map = this.#map();
    return { tw: map?.tileWidth ?? 32, th: map?.tileHeight ?? 32 };
  }

  viewCenter(): Point {
    return { x: this.viewW / 2, y: this.viewH / 2 };
  }

  /** Sizes the view; frames the map if that is still pending. */
  resize(viewW: number, viewH: number, resolution: number): void {
    const resChanged = resolution !== this.resolution;
    this.resolution = resolution;
    this.viewW = viewW;
    this.viewH = viewH;
    if (this.#pendingFrameMap || this.#framed) this.#applyFrame();
    else if (resChanged) this.setZoom(this.zoomLevel, this.viewCenter());
  }

  /**
   * The view's left edge moved right by `shift` CSS px on screen (a side
   * column changed width): keep the content where it was on screen, but keep
   * the map's left edge in view if it was (see {@link compensateViewShift}).
   * A view that still follows "frame the map" re-frames on resize instead.
   * `keepMapEdge` false (world view): no map edge to keep.
   */
  shiftView(shift: number, keepMapEdge = true): void {
    if (shift === 0 || this.#pendingFrameMap || this.#framed) return;
    const x = compensateViewShift(this.camera.x, shift, keepMapEdge ? this.camera.x : null);
    const dx = x - this.camera.x;
    if (dx === 0) return;
    this.camera = { ...this.camera, x };
    if (this.#anim) this.#anim = { ...this.#anim, anchorScreen: { x: this.#anim.anchorScreen.x + dx, y: this.#anim.anchorScreen.y } };
    this.#requestRender();
  }

  /** Frames the map ("fit") as soon as the view has a size. */
  requestFrameMap(): void {
    this.#frameMode = "fit";
    this.#pendingFrameMap = true;
    if (this.viewW > 1 && this.viewH > 1) this.frameMap();
  }

  /**
   * Shows a just-opened level as soon as the view has a size: centred at a
   * working zoom preset (see `initialZoom`), not a tiny overview.
   */
  requestInitialView(): void {
    this.#frameMode = "initial";
    this.#pendingFrameMap = true;
    if (this.viewW > 1 && this.viewH > 1) this.initialView();
  }

  /** Centres the map at its opening zoom (see {@link requestInitialView}). */
  initialView(): void {
    const map = this.#map();
    if (this.frameBounds || !map) {
      this.frameMap();
      return;
    }
    if (this.viewW <= 1 || this.viewH <= 1) {
      this.#frameMode = "initial";
      this.#pendingFrameMap = true;
      return;
    }
    this.#pendingFrameMap = false;
    this.#frameMode = "initial";
    this.#anim = null;
    this.#framed = true;
    const mw = map.width * map.tileWidth;
    const mh = map.height * map.tileHeight;
    const fit = fitZoom(this.viewW, this.viewH, mw, mh, FRAME_PADDING, MAX_ZOOM);
    const z = this.#quantize(this.#clamp(initialZoom(fit, Math.min(map.tileWidth, map.tileHeight))));
    this.zoomLevel = z;
    this.camera = centeredCamera(this.viewW, this.viewH, mw, mh, z);
    this.#requestRender();
  }

  #applyFrame(): void {
    if (this.#frameMode === "initial") this.initialView();
    else this.frameMap();
  }

  stopAnimation(): void {
    this.#anim = null;
    this.#clearSettle();
  }

  /** Stops timers (canvas destroyed). */
  dispose(): void {
    this.stopAnimation();
  }

  panBy(dx: number, dy: number): void {
    this.#framed = false;
    this.camera = { ...this.camera, x: this.camera.x + dx, y: this.camera.y + dy };
    this.#requestRender();
  }

  /** Moves the camera (zoom unchanged) so map px (`wx`, `wy`) is at the view centre. */
  centerOnWorld(wx: number, wy: number): void {
    this.#anim = null;
    this.#pendingFrameMap = false;
    this.#framed = false;
    this.camera = cameraCenteredOn(wx, wy, this.camera.zoom, this.viewW, this.viewH);
    this.#requestRender();
  }

  /**
   * The view to remember for this level (map px at the view centre + zoom),
   * or null while it still shows the opening view (reopening shows that
   * again anyway). `camera` defaults to the current one.
   */
  savedView(camera: Camera = this.camera): { cx: number; cy: number; zoom: number } | null {
    // The untouched opening view is not remembered; a fitted ("Sığdır") view is: it differs from the opening one.
    if (this.#pendingFrameMap || (this.#framed && this.#frameMode === "initial" && camera === this.camera) || this.viewW <= 1 || this.viewH <= 1) return null;
    const zoom = this.#anim && camera === this.camera ? this.#quantize(this.#clamp(this.#anim.target)) : camera.zoom;
    const cx = (this.viewW / 2 - camera.x) / camera.zoom;
    const cy = (this.viewH / 2 - camera.y) / camera.zoom;
    return { cx, cy, zoom };
  }

  /** The camera that shows `view` (see {@link savedView}) in this view size. */
  cameraFor(view: { cx: number; cy: number; zoom: number }): Camera {
    const zoom = this.#quantize(this.#clamp(view.zoom));
    return cameraCenteredOn(view.cx, view.cy, zoom, this.viewW, this.viewH);
  }

  /** Shows a remembered level view; falls back to the opening view while the view has no size. */
  restoreView(view: { cx: number; cy: number; zoom: number }): void {
    if (this.viewW <= 1 || this.viewH <= 1) {
      this.requestInitialView();
      return;
    }
    const camera = this.cameraFor(view);
    this.place(camera.x, camera.y, camera.zoom);
  }

  /** The zoom the camera actually ends at for a requested `zoom` (clamped, tiles whole device px). */
  effectiveZoom(zoom: number): number {
    return this.#quantize(this.#clamp(zoom));
  }

  /** Places the camera directly (zoom = CSS px per map px); counts as a user move. */
  place(x: number, y: number, zoom: number): void {
    this.#anim = null;
    this.#pendingFrameMap = false;
    this.#framed = false;
    this.zoomLevel = zoom;
    this.camera = { x, y, zoom };
    this.#requestRender();
  }

  /** Immediately sets the zoom keeping `anchor` fixed. */
  setZoom(zoom: number, anchor: Point): void {
    this.#anim = null;
    this.#framed = false;
    this.zoomLevel = this.#clamp(zoom);
    this.camera = cameraAnchored(anchor, this.#worldAt(anchor), this.#quantize(this.zoomLevel));
    this.#requestRender();
  }

  animateZoomTo(target: number, anchor: Point): void {
    this.#clearSettle();
    this.#framed = false;
    this.#anim = {
      current: this.#anim?.current ?? this.zoomLevel,
      target: this.#clamp(target),
      anchorScreen: anchor,
      anchorWorld: this.#worldAt(anchor),
    };
    this.#requestRender();
  }

  zoomStep(dir: 1 | -1, anchor: Point = this.viewCenter()): void {
    this.animateZoomTo(this.#stepFrom(this.zoomTarget, dir), anchor);
  }

  /** `count` zoom steps (negative = out) at once, animated, keeping `anchor` fixed (wheel notches). */
  zoomSteps(count: number, anchor: Point): void {
    if (count === 0) return;
    this.#clearSettle();
    let z = this.zoomTarget;
    const dir: 1 | -1 = count > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(count); i++) z = this.#stepFrom(z, dir);
    this.animateZoomTo(z, anchor);
  }

  /**
   * Continuous zoom by `factor` (trackpad pinch): follows the fingers, then
   * settles on the nearest preset once the pinch pauses (level view).
   */
  pinchZoom(factor: number, anchor: Point): void {
    this.setZoom(this.zoomTarget * factor, anchor);
    if (!this.snapSteps) return;
    this.#clearSettle();
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = null;
      const target = this.#clamp(nearestZoomStep(this.zoomLevel));
      if (Math.abs(target - this.zoomLevel) > 1e-9) this.animateZoomTo(target, anchor);
    }, PINCH_SETTLE_MS);
  }

  #stepFrom(from: number, dir: 1 | -1): number {
    if (!this.snapSteps) return this.#clamp(dir > 0 ? from * 1.5 : from / 1.5);
    return nextZoomStep(from, dir, undefined, this.minZoom, this.maxZoom);
  }

  #clearSettle(): void {
    if (this.#settleTimer !== null) clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
  }

  /** Changes the zoom limits; the current zoom is clamped into them. */
  setZoomLimits(min: number, max: number): void {
    this.minZoom = min;
    this.maxZoom = max;
    if (this.zoomLevel < min || this.zoomLevel > max) this.setZoom(this.zoomLevel, this.viewCenter());
  }

  /** Centers the map in the view (fit if it is larger than the view). */
  frameMap(): void {
    if (this.viewW <= 1 || this.viewH <= 1) {
      this.#pendingFrameMap = true;
      return;
    }
    this.#pendingFrameMap = false;
    this.#frameMode = "fit";
    this.#anim = null;
    this.#framed = true;
    if (this.frameBounds) {
      this.#frameRect(this.frameBounds());
      return;
    }
    const map = this.#map();
    if (!map) {
      this.zoomLevel = 1;
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.#requestRender();
      return;
    }
    const mw = map.width * map.tileWidth;
    const mh = map.height * map.tileHeight;
    const framed = frameCamera(this.viewW, this.viewH, mw, mh, FRAME_PADDING, this.frameCorner?.() ?? null, {
      tileSize: map.tileWidth,
      resolution: this.resolution,
    });
    let z = this.#quantize(framed.zoom);
    // The renderer rounds to whole device pixels per tile; round down here so the framed map still fits.
    if (z > framed.zoom * (1 + 1e-9)) {
      const unit = map.tileWidth * this.resolution;
      const down = Math.floor(framed.zoom * unit) / unit;
      if (down >= this.minZoom) z = down;
    }
    this.zoomLevel = z;
    // Quantizing may nudge the zoom: keep the framed centre.
    const cx = framed.x + (mw * framed.zoom) / 2;
    const cy = framed.y + (mh * framed.zoom) / 2;
    this.camera = { x: cx - (mw * z) / 2, y: cy - (mh * z) / 2, zoom: z };
    this.#requestRender();
  }

  /** Fits a world rectangle into the view (continuous zoom, at most 1), centred. */
  #frameRect(r: Rect | null): void {
    if (!r || r.width <= 0 || r.height <= 0) {
      this.zoomLevel = this.#clamp(1);
      this.camera = { x: this.viewW / 2, y: this.viewH / 2, zoom: this.#quantize(this.zoomLevel) };
      this.#requestRender();
      return;
    }
    const availW = Math.max(1, this.viewW - FRAME_PADDING * 2);
    const availH = Math.max(1, this.viewH - FRAME_PADDING * 2);
    this.zoomLevel = this.#clamp(Math.min(availW / r.width, availH / r.height, 1));
    const z = this.#quantize(this.zoomLevel);
    this.camera = { x: (this.viewW - r.width * z) / 2 - r.x * z, y: (this.viewH - r.height * z) / 2 - r.y * z, zoom: z };
    this.#requestRender();
  }

  /** Advances the zoom animation; true while it keeps running. */
  step(dt: number): boolean {
    const a = this.#anim;
    if (!a) return false;
    a.current = easeZoom(a.current, a.target, dt, ZOOM_TAU_MS);
    this.zoomLevel = a.current;
    this.camera = cameraAnchored(a.anchorScreen, a.anchorWorld, this.#quantize(a.current));
    if (a.current === a.target) {
      this.#anim = null;
      return false;
    }
    return true;
  }

  /** Cell under a screen point (may be outside the map); null without a map. */
  cellAt(p: Point): CellPoint | null {
    const map = this.#map();
    if (!map) return null;
    return screenToCell(this.camera, p.x, p.y, map.tileWidth, map.tileHeight, this.resolution);
  }

  /** Cells on screen (clipped to the map), or null without a map. */
  visibleRegion(): CellRegion | null {
    const map = this.#map();
    if (!map) return null;
    const { tw, th } = this.tileSize();
    const r = visibleCells(this.camera, this.viewW, this.viewH, tw, th, map.width, map.height, this.resolution);
    return { x: r.x0, y: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 };
  }

  /** Device-pixel box of a cell rectangle, matching the snapped world transform. */
  cellBox(r: CellRegion): DeviceBox {
    const { tw, th } = this.tileSize();
    const res = this.resolution;
    const off = snappedOffset(this.camera, res);
    const ox = Math.round(off.x * res);
    const oy = Math.round(off.y * res);
    const cw = tw * this.camera.zoom * res;
    const ch = th * this.camera.zoom * res;
    return {
      x0: Math.round(ox + r.x * cw),
      y0: Math.round(oy + r.y * ch),
      x1: Math.round(ox + (r.x + r.width) * cw),
      y1: Math.round(oy + (r.y + r.height) * ch),
    };
  }

  /** Outline thickness in device pixels: one CSS pixel, at least one device pixel. */
  lineWidth(): number {
    return Math.max(1, Math.round(this.resolution));
  }

  #quantize(zoom: number): number {
    return quantizeZoom(zoom, this.tileSize().tw, this.resolution, this.minZoom, this.maxZoom);
  }

  #clamp(zoom: number): number {
    return clampZoom(zoom, this.minZoom, this.maxZoom);
  }

  /** World point under a screen point for the current (unsnapped) camera. */
  #worldAt(p: Point): Point {
    return { x: (p.x - this.camera.x) / this.camera.zoom, y: (p.y - this.camera.y) / this.camera.zoom };
  }
}
