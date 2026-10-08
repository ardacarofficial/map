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
  #anim: ZoomAnim | null = null;
  #pendingFrameMap = true;
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
    if (this.#pendingFrameMap || this.#framed) this.frameMap();
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

  /** Frames the map as soon as the view has a size (new project). */
  requestFrameMap(): void {
    this.#pendingFrameMap = true;
    if (this.viewW > 1 && this.viewH > 1) this.frameMap();
  }

  stopAnimation(): void {
    this.#anim = null;
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
    this.#framed = false;
    this.#anim = {
      current: this.#anim?.current ?? this.zoomLevel,
      target: this.#clamp(target),
      anchorScreen: anchor,
      anchorWorld: this.#worldAt(anchor),
    };
    this.#requestRender();
  }

  zoomStep(dir: 1 | -1): void {
    const from = this.zoomTarget;
    let next = nextZoomStep(from, dir);
    // Below the smallest step (world view): keep zooming in factors.
    if (dir < 0 && next >= from) next = from / 1.5;
    this.animateZoomTo(next, this.viewCenter());
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
