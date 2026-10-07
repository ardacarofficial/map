/**
 * The map canvas: Pixi application, camera, input, overlays.
 *
 * Rendering is on demand: the Pixi ticker never runs. Anything that changes
 * the picture calls `#requestRender()`, which schedules one
 * requestAnimationFrame; the frame keeps re-scheduling itself only while a
 * zoom animation is running. An idle editor therefore costs ~0 CPU/GPU, and
 * a brush change is drawn on the very next frame.
 */
import type { CellPoint, MapStore } from "@smap/core";
import { AlphaFilter, Application, Container, Graphics, Sprite, Texture } from "pixi.js";

import { useEditorStore, type EditorState, type OpenProject } from "../state/editorStore";
import { getTilesetImage, onTilesetImage } from "../state/tilesetImages";
import { cellWrites, classifyWheel, strokeCells } from "./brush";
import {
  cameraAnchored,
  centeredCamera,
  clampZoom,
  easeZoom,
  fitZoom,
  nextZoomStep,
  quantizeZoom,
  screenToCell,
  snappedOffset,
  visibleCells,
  wheelDeltaPixels,
  wheelZoomFactor,
  type Camera,
  type Point,
} from "./camera";
import { CANVAS_COLORS, readThemeColors } from "./colors";
import { gridLayout } from "./grid";
import { MapScene } from "./mapScene";

export interface CanvasHandle {
  destroy(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  /** Center the map in the view (fit if it is larger than the view). */
  frameMap(): void;
}

/** Time constant of the wheel-zoom easing. */
const ZOOM_TAU_MS = 55;
/** How long a pan gesture "sticks" for following wheel events. */
const PAN_GESTURE_MS = 250;
const FRAME_PADDING = 48;

interface Stroke {
  readonly store: MapStore;
  readonly layerId: string;
  readonly value: number;
  readonly pointerId: number;
  last: CellPoint | null;
}

interface Pan {
  readonly pointerId: number;
  lastX: number;
  lastY: number;
}

interface ZoomAnim {
  current: number;
  target: number;
  anchorScreen: Point;
  anchorWorld: Point;
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}

export class MapCanvas {
  readonly #container: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #app = new Application();
  readonly #abort = new AbortController();
  #initialized = false;
  #destroyed = false;
  #restoreContainerPosition: string | null = null;
  #colors = CANVAS_COLORS;

  // scene graph
  readonly #world = new Container();
  /** Grid lines, drawn opaque; the filter applies the fade as one layer so crossings are not brighter. */
  readonly #grid = new Graphics();
  readonly #gridFilter = new AlphaFilter({ alpha: 1, resolution: "inherit" });
  readonly #overlay = new Graphics();
  readonly #preview = new Sprite();
  #scene: MapScene | null = null;

  // view
  #viewW = 0;
  #viewH = 0;
  #resolution = 1;
  #camera: Camera = { x: 0, y: 0, zoom: 1 };
  /** Continuous zoom; `#camera.zoom` is its quantized value. */
  #zoomLevel = 1;
  #anim: ZoomAnim | null = null;
  #pendingFrameMap = true;
  #raf = 0;
  #lastFrameTime = 0;
  #ro: ResizeObserver | null = null;

  // input
  #pointer: Point | null = null;
  #canvasRect: DOMRect | null = null;
  #spaceDown = false;
  #pan: Pan | null = null;
  #stroke: Stroke | null = null;
  #lastPanWheel = -Infinity;
  #reportedZoom = NaN;
  #reportedHover: CellPoint | null = null;

  #unsubs: (() => void)[] = [];

  constructor(container: HTMLElement) {
    this.#container = container;
    const canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "map canvas");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      outline: "none",
      touchAction: "none",
      userSelect: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    this.#canvas = canvas;
  }

  async init(): Promise<void> {
    if (getComputedStyle(this.#container).position === "static") {
      this.#restoreContainerPosition = this.#container.style.position;
      this.#container.style.position = "relative";
    }
    this.#container.appendChild(this.#canvas);
    this.#colors = readThemeColors(this.#container);
    const rect = this.#canvas.getBoundingClientRect();
    this.#resolution = window.devicePixelRatio || 1;
    this.#viewW = Math.max(1, rect.width);
    this.#viewH = Math.max(1, rect.height);
    await this.#app.init({
      canvas: this.#canvas,
      width: this.#viewW,
      height: this.#viewH,
      resolution: this.#resolution,
      autoDensity: false,
      antialias: false,
      backgroundColor: this.#colors.outside,
      preference: ["webgl"],
      webgl: { preferWebGLVersion: 2 },
      autoStart: false,
      sharedTicker: false,
      hello: false,
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
      accessibilityOptions: { enabledByDefault: false, activateOnTab: false },
    });
    this.#initialized = true;
    if (this.#destroyed) {
      this.#teardownApp();
      return;
    }
    this.#app.ticker?.stop();
    this.#app.stage.eventMode = "none";
    this.#preview.alpha = CANVAS_COLORS.previewAlpha;
    this.#preview.visible = false;
    this.#grid.filters = [this.#gridFilter];
    this.#app.stage.addChild(this.#world, this.#grid, this.#overlay);

    this.#observeSize();
    this.#addListeners();
    this.#unsubs.push(useEditorStore.subscribe((s, prev) => this.#onEditorState(s, prev)));
    this.#unsubs.push(
      onTilesetImage((id) => {
        this.#scene?.imageChanged(id);
        this.#requestRender();
      }),
    );
    this.#loadProject(useEditorStore.getState().project);
  }

  readonly handle: CanvasHandle = {
    destroy: () => this.destroy(),
    zoomIn: () => this.#zoomStep(1),
    zoomOut: () => this.#zoomStep(-1),
    zoomReset: () => this.#animateZoomTo(1, this.#viewCenter()),
    frameMap: () => this.#frameMap(),
  };

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#endStroke();
    this.#abort.abort();
    this.#ro?.disconnect();
    this.#ro = null;
    cancelAnimationFrame(this.#raf);
    for (const u of this.#unsubs) u();
    this.#unsubs = [];
    this.#scene?.destroy();
    this.#scene = null;
    const s = useEditorStore.getState();
    if (s.hoverCell) s.setHoverCell(null);
    if (this.#initialized) this.#teardownApp();
    else this.#removeCanvas(); // init still running (it tears the app down when it resolves) or failed
  }

  #teardownApp(): void {
    this.#app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
    this.#removeCanvas();
  }

  #removeCanvas(): void {
    this.#canvas.remove();
    if (this.#restoreContainerPosition !== null) this.#container.style.position = this.#restoreContainerPosition;
  }

  // ------------------------------------------------------------------ project

  #loadProject(project: OpenProject | null): void {
    this.#endStroke();
    this.#scene?.destroy();
    this.#scene = null;
    if (project) {
      this.#scene = new MapScene(
        project.store,
        (id) => getTilesetImage(id)?.bitmap,
        () => this.#requestRender(),
      );
      this.#world.addChild(this.#scene.root);
    }
    this.#world.addChild(this.#preview); // keep the preview above the layers
    this.#preview.texture = Texture.EMPTY;
    this.#pendingFrameMap = true;
    if (this.#viewW > 1 && this.#viewH > 1) this.#frameMap();
    this.#requestRender();
  }

  #onEditorState(s: EditorState, prev: EditorState): void {
    if (s.project !== prev.project) {
      this.#loadProject(s.project);
      return;
    }
    if (
      s.gridVisible !== prev.gridVisible ||
      s.tool !== prev.tool ||
      s.selection !== prev.selection ||
      s.activeLayerId !== prev.activeLayerId
    ) {
      this.#updateCursor();
      this.#requestRender();
    }
  }

  // ------------------------------------------------------------------ sizing

  #observeSize(): void {
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const dpr = window.devicePixelRatio || 1;
      let devW: number;
      let devH: number;
      const dev = entry.devicePixelContentBoxSize?.[0];
      if (dev) {
        devW = dev.inlineSize;
        devH = dev.blockSize;
      } else {
        const box = entry.contentBoxSize?.[0];
        devW = Math.round((box ? box.inlineSize : entry.contentRect.width) * dpr);
        devH = Math.round((box ? box.blockSize : entry.contentRect.height) * dpr);
      }
      this.#resize(devW, devH, dpr);
    });
    try {
      ro.observe(this.#canvas, { box: "device-pixel-content-box" });
    } catch {
      ro.observe(this.#canvas, { box: "content-box" });
    }
    this.#ro = ro;
  }

  /** Sizes the backing store to exactly `devW`×`devH` device pixels. */
  #resize(devW: number, devH: number, resolution: number): void {
    if (devW <= 0 || devH <= 0) return;
    const resChanged = resolution !== this.#resolution;
    this.#resolution = resolution;
    this.#viewW = devW / resolution;
    this.#viewH = devH / resolution;
    this.#app.renderer.resize(this.#viewW, this.#viewH, resolution);
    this.#canvasRect = null;
    if (this.#pendingFrameMap) this.#frameMap();
    else if (resChanged) this.#setZoom(this.#zoomLevel, this.#viewCenter());
    this.#requestRender();
  }

  // ------------------------------------------------------------------ camera

  #tileSize(): { tw: number; th: number } {
    const map = this.#scene?.store.document.map;
    return { tw: map?.tileWidth ?? 32, th: map?.tileHeight ?? 32 };
  }

  #quantize(zoom: number): number {
    return quantizeZoom(zoom, this.#tileSize().tw, this.#resolution);
  }

  #viewCenter(): Point {
    return { x: this.#viewW / 2, y: this.#viewH / 2 };
  }

  /** World point under a screen point for the current (unsnapped) camera. */
  #worldAt(p: Point): Point {
    return { x: (p.x - this.#camera.x) / this.#camera.zoom, y: (p.y - this.#camera.y) / this.#camera.zoom };
  }

  /** Immediately sets the zoom keeping `anchor` fixed. */
  #setZoom(zoom: number, anchor: Point): void {
    this.#anim = null;
    this.#zoomLevel = clampZoom(zoom);
    this.#camera = cameraAnchored(anchor, this.#worldAt(anchor), this.#quantize(this.#zoomLevel));
    this.#requestRender();
  }

  #animateZoomTo(target: number, anchor: Point): void {
    const t = clampZoom(target);
    this.#anim = {
      current: this.#anim?.current ?? this.#zoomLevel,
      target: t,
      anchorScreen: anchor,
      anchorWorld: this.#worldAt(anchor),
    };
    this.#requestRender();
  }

  #zoomStep(dir: 1 | -1): void {
    const from = this.#anim?.target ?? this.#zoomLevel;
    this.#animateZoomTo(nextZoomStep(from, dir), this.#viewCenter());
  }

  #frameMap(): void {
    if (this.#viewW <= 1 || this.#viewH <= 1) {
      this.#pendingFrameMap = true;
      return;
    }
    this.#pendingFrameMap = false;
    this.#anim = null;
    const map = this.#scene?.store.document.map;
    if (!map) {
      this.#zoomLevel = 1;
      this.#camera = { x: 0, y: 0, zoom: 1 };
      this.#requestRender();
      return;
    }
    const mw = map.width * map.tileWidth;
    const mh = map.height * map.tileHeight;
    this.#zoomLevel = fitZoom(this.#viewW, this.#viewH, mw, mh, FRAME_PADDING);
    this.#camera = centeredCamera(this.#viewW, this.#viewH, mw, mh, this.#quantize(this.#zoomLevel));
    this.#requestRender();
  }

  #stepAnimation(dt: number): boolean {
    const a = this.#anim;
    if (!a) return false;
    a.current = easeZoom(a.current, a.target, dt, ZOOM_TAU_MS);
    this.#zoomLevel = a.current;
    this.#camera = cameraAnchored(a.anchorScreen, a.anchorWorld, this.#quantize(a.current));
    if (a.current === a.target) {
      this.#anim = null;
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ rendering

  #requestRender(): void {
    if (this.#raf !== 0 || this.#destroyed || !this.#initialized) return;
    this.#raf = requestAnimationFrame((t) => this.#frame(t));
  }

  #frame(time: number): void {
    this.#raf = 0;
    if (this.#destroyed) return;
    const dt = this.#lastFrameTime > 0 ? Math.min(64, time - this.#lastFrameTime) : 16;
    this.#lastFrameTime = time;
    const animating = this.#stepAnimation(dt);

    this.#scene?.flush();
    const res = this.#resolution;
    const off = snappedOffset(this.#camera, res);
    this.#world.position.set(off.x, off.y);
    this.#world.scale.set(this.#camera.zoom);

    const { tw, th } = this.#tileSize();
    const map = this.#scene?.store.document.map;
    if (map && this.#scene) {
      const r = visibleCells(this.#camera, this.#viewW, this.#viewH, tw, th, map.width, map.height, res);
      this.#scene.updateVisibility(r.x0, r.y0, r.x1, r.y1);
    }
    this.#updateHover();
    this.#drawOverlay();
    this.#app.renderer.render(this.#app.stage);
    this.#reportZoom();

    if (animating) this.#requestRender();
    else this.#lastFrameTime = 0;
  }

  #reportZoom(): void {
    if (this.#camera.zoom === this.#reportedZoom) return;
    this.#reportedZoom = this.#camera.zoom;
    useEditorStore.getState().setZoom(this.#camera.zoom);
  }

  /** Grid, map border and the eraser cursor, all in whole device pixels. */
  #drawOverlay(): void {
    const g = this.#overlay;
    g.clear();
    this.#grid.clear();
    this.#grid.visible = false;
    const map = this.#scene?.store.document.map;
    this.#preview.visible = false;
    if (!map) return;
    const res = this.#resolution;
    const px = 1 / res;
    const state = useEditorStore.getState();
    const grid = gridLayout(this.#camera, res, this.#viewW, this.#viewH, map.tileWidth, map.tileHeight, map.width, map.height);

    if (state.gridVisible && grid.alpha > 0) {
      const h = (grid.bottom - grid.top) * px;
      const w = (grid.right - grid.left) * px;
      const gg = this.#grid;
      for (const x of grid.xs) gg.rect(x * px, grid.top * px, px, h);
      for (const y of grid.ys) gg.rect(grid.left * px, y * px, w, px);
      if (grid.xs.length + grid.ys.length > 0) {
        gg.fill(CANVAS_COLORS.grid);
        this.#gridFilter.alpha = CANVAS_COLORS.gridAlpha * grid.alpha;
        gg.visible = true;
      }
    }

    // Map border: 1 device px just outside the map.
    const ox = Math.round(this.#camera.x * res);
    const oy = Math.round(this.#camera.y * res);
    const cw = map.tileWidth * this.#camera.zoom * res;
    const ch = map.tileHeight * this.#camera.zoom * res;
    const l = ox - 1;
    const t = oy - 1;
    const r = Math.round(ox + map.width * cw);
    const b = Math.round(oy + map.height * ch);
    g.rect(l * px, t * px, (r - l + 1) * px, px)
      .rect(l * px, b * px, (r - l + 1) * px, px)
      .rect(l * px, t * px, px, (b - t + 1) * px)
      .rect(r * px, t * px, px, (b - t + 1) * px)
      .fill(this.#colors.mapBorder);

    // Cursor.
    const cell = this.#cursorCell();
    if (!cell) return;
    if (state.tool === "brush") {
      const sel = state.selection;
      const tex = sel ? this.#scene?.atlas(sel.tilesetId)?.tileTexture(sel.tileId) : undefined;
      if (tex) {
        this.#preview.texture = tex;
        this.#preview.position.set(cell.x * map.tileWidth, cell.y * map.tileHeight);
        this.#preview.width = map.tileWidth;
        this.#preview.height = map.tileHeight;
        this.#preview.visible = true;
      }
    } else {
      const x0 = Math.round(ox + cell.x * cw);
      const y0 = Math.round(oy + cell.y * ch);
      const x1 = Math.round(ox + (cell.x + 1) * cw);
      const y1 = Math.round(oy + (cell.y + 1) * ch);
      const k = Math.max(1, Math.round(res));
      outline(g, x0 - k, y0 - k, x1 + k, y1 + k, k, px);
      g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.6 });
      outline(g, x0, y0, x1, y1, k, px);
      g.fill({ color: CANVAS_COLORS.cursor, alpha: 0.9 });
    }
  }

  /** Cell for the brush/eraser cursor, or null when it should be hidden. */
  #cursorCell(): CellPoint | null {
    if (!this.#pointer || this.#pan || this.#spaceDown) return null;
    const cell = this.#reportedHover;
    if (!cell) return null;
    const s = useEditorStore.getState();
    const layer = s.activeLayerId ? this.#scene?.store.document.getLayer(s.activeLayerId) : undefined;
    if (!layer || !layer.visible || layer.locked) return null;
    return cell;
  }

  #updateHover(): void {
    const map = this.#scene?.store.document.map;
    let cell: CellPoint | null = null;
    if (map && this.#pointer) {
      const c = screenToCell(this.#camera, this.#pointer.x, this.#pointer.y, map.tileWidth, map.tileHeight, this.#resolution);
      if (c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height) cell = c;
    }
    const prev = this.#reportedHover;
    if (prev === cell || (prev && cell && prev.x === cell.x && prev.y === cell.y)) return;
    this.#reportedHover = cell;
    useEditorStore.getState().setHoverCell(cell ? { x: cell.x, y: cell.y } : null);
  }

  // ------------------------------------------------------------------ input

  #addListeners(): void {
    const c = this.#canvas;
    const opts = { signal: this.#abort.signal };
    c.addEventListener("pointerdown", (e) => this.#onPointerDown(e), opts);
    c.addEventListener("pointermove", (e) => this.#onPointerMove(e), opts);
    c.addEventListener("pointerup", (e) => this.#onPointerUp(e), opts);
    c.addEventListener("pointercancel", (e) => this.#onPointerEnd(e), opts);
    c.addEventListener("lostpointercapture", (e) => this.#onPointerEnd(e), opts);
    c.addEventListener("pointerenter", (e) => this.#setPointer(e), opts);
    c.addEventListener("pointerleave", () => {
      if (this.#stroke || this.#pan) return;
      this.#pointer = null;
      this.#requestRender();
    }, opts);
    c.addEventListener("wheel", (e) => this.#onWheel(e), { signal: this.#abort.signal, passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault(), opts);
    // Middle-button autoscroll (Windows) and text selection.
    c.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    }, opts);
    c.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    }, opts);
    window.addEventListener("keydown", (e) => this.#onKey(e, true), opts);
    window.addEventListener("keyup", (e) => this.#onKey(e, false), opts);
    window.addEventListener("blur", () => {
      this.#spaceDown = false;
      this.#updateCursor();
    }, opts);
    window.addEventListener("scroll", () => (this.#canvasRect = null), { signal: this.#abort.signal, capture: true, passive: true });
    this.#updateCursor();
  }

  #rect(): DOMRect {
    return (this.#canvasRect ??= this.#canvas.getBoundingClientRect());
  }

  #toLocal(e: { clientX: number; clientY: number }): Point {
    const r = this.#rect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  #setPointer(e: PointerEvent): void {
    this.#pointer = this.#toLocal(e);
    this.#requestRender();
  }

  #onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code !== "Space") return;
    if (down) {
      if (isEditableTarget(e.target)) return;
      // Only claim Space while the canvas is hovered or focused, so buttons elsewhere keep working.
      if (!this.#pointer && document.activeElement !== this.#canvas && !this.#spaceDown) return;
      e.preventDefault();
      if (this.#spaceDown) return;
      this.#spaceDown = true;
    } else {
      if (!this.#spaceDown) return;
      this.#spaceDown = false;
    }
    this.#updateCursor();
    this.#requestRender();
  }

  #updateCursor(): void {
    let cursor = "default";
    if (this.#pan) cursor = "grabbing";
    else if (this.#spaceDown) cursor = "grab";
    else if (this.#scene) cursor = "crosshair";
    if (this.#canvas.style.cursor !== cursor) this.#canvas.style.cursor = cursor;
  }

  #onPointerDown(e: PointerEvent): void {
    this.#canvasRect = null;
    this.#pointer = this.#toLocal(e);
    if (document.activeElement !== this.#canvas) this.#canvas.focus({ preventScroll: true });
    if (this.#pan || this.#stroke) return;
    if (e.button === 1 || (e.button === 0 && this.#spaceDown)) {
      e.preventDefault();
      this.#pan = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      this.#capture(e.pointerId);
      this.#anim = null;
      this.#updateCursor();
      this.#requestRender();
      return;
    }
    if (e.button === 0) {
      e.preventDefault();
      this.#beginStroke(e);
    }
  }

  #onPointerMove(e: PointerEvent): void {
    this.#pointer = this.#toLocal(e);
    if (this.#pan && e.pointerId === this.#pan.pointerId) {
      const dx = e.clientX - this.#pan.lastX;
      const dy = e.clientY - this.#pan.lastY;
      this.#pan.lastX = e.clientX;
      this.#pan.lastY = e.clientY;
      this.#camera = { ...this.#camera, x: this.#camera.x + dx, y: this.#camera.y + dy };
    } else if (this.#stroke && e.pointerId === this.#stroke.pointerId) {
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      this.#paint(events.length > 0 ? events : [e]);
    }
    this.#requestRender();
  }

  #onPointerUp(e: PointerEvent): void {
    if (this.#pan && e.pointerId === this.#pan.pointerId) {
      this.#endPan();
    } else if (this.#stroke && e.pointerId === this.#stroke.pointerId && e.button === 0) {
      this.#paint([e]);
      this.#endStroke();
    }
    this.#release(e.pointerId);
    this.#requestRender();
  }

  #onPointerEnd(e: PointerEvent): void {
    if (this.#pan && e.pointerId === this.#pan.pointerId) this.#endPan();
    if (this.#stroke && e.pointerId === this.#stroke.pointerId) this.#endStroke();
    this.#requestRender();
  }

  #capture(pointerId: number): void {
    try {
      this.#canvas.setPointerCapture(pointerId);
    } catch {
      // pointer already gone
    }
  }

  #release(pointerId: number): void {
    try {
      if (this.#canvas.hasPointerCapture(pointerId)) this.#canvas.releasePointerCapture(pointerId);
    } catch {
      // ignore
    }
  }

  #endPan(): void {
    this.#pan = null;
    this.#updateCursor();
  }

  #onWheel(e: WheelEvent): void {
    e.preventDefault(); // also blocks the browser's own ctrl+wheel page zoom
    if (this.#pan) return;
    const p = this.#toLocal(e);
    this.#pointer = p;
    const now = performance.now();
    const dx = wheelDeltaPixels(e.deltaX, e.deltaMode);
    const dy = wheelDeltaPixels(e.deltaY, e.deltaMode);
    const action = classifyWheel(
      { deltaX: dx, deltaY: dy, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey },
      now - this.#lastPanWheel < PAN_GESTURE_MS,
    );
    if (action === "pan") {
      this.#lastPanWheel = now;
      this.#anim = null;
      // Shift+wheel on a mouse scrolls horizontally.
      const panX = e.shiftKey && dx === 0 ? dy : dx;
      const panY = e.shiftKey && dx === 0 ? 0 : dy;
      this.#camera = { ...this.#camera, x: this.#camera.x - panX, y: this.#camera.y - panY };
      this.#requestRender();
    } else if (action === "pinch") {
      const base = this.#anim?.target ?? this.#zoomLevel;
      this.#setZoom(base * wheelZoomFactor(dy, true), p);
    } else {
      const base = this.#anim?.target ?? this.#zoomLevel;
      this.#animateZoomTo(base * wheelZoomFactor(dy, false), p);
    }
  }

  // ------------------------------------------------------------------ painting

  #beginStroke(e: PointerEvent): void {
    const state = useEditorStore.getState();
    const store = this.#scene?.store;
    if (!store || !state.activeLayerId) return;
    const doc = store.document;
    const layer = doc.getLayer(state.activeLayerId);
    if (!layer || !layer.visible || layer.locked) return;
    let value: number;
    if (state.tool === "eraser") value = 0;
    else {
      const sel = state.selection;
      if (!sel || !doc.getTileset(sel.tilesetId)) return;
      try {
        value = store.getOrAddPaletteIndex(sel.tilesetId, sel.tileId);
      } catch (error) {
        console.error("[canvas] cannot paint selection", error);
        return;
      }
    }
    store.beginTransaction();
    this.#stroke = { store, layerId: layer.id, value, pointerId: e.pointerId, last: null };
    this.#capture(e.pointerId);
    this.#paint([e]);
  }

  #paint(events: readonly PointerEvent[]): void {
    const s = this.#stroke;
    if (!s) return;
    const doc = s.store.document;
    const layer = doc.getLayer(s.layerId);
    if (!layer) return;
    const { tileWidth, tileHeight, width, height } = doc.map;
    const samples = events.map((ev) => {
      const p = this.#toLocal(ev);
      return screenToCell(this.#camera, p.x, p.y, tileWidth, tileHeight, this.#resolution);
    });
    const cells = strokeCells(s.last, samples);
    s.last = samples[samples.length - 1] ?? s.last;
    const writes = cellWrites(cells, s.value, width, height, (x, y) => layer.getCell(x, y));
    if (writes.length === 0) return;
    const patch = s.store.dispatch({ type: "paintCells", layerId: s.layerId, cells: writes });
    if (patch.cells.length > 0) {
      const st = useEditorStore.getState();
      if (!st.dirty) st.setDirty(true);
    }
  }

  #endStroke(): void {
    const s = this.#stroke;
    if (!s) return;
    this.#stroke = null;
    if (s.store.inTransaction) s.store.commit();
  }
}

/** Adds a `k`-device-px rectangle outline (inside x0..x1, y0..y1) to `g` as four rects. */
function outline(g: Graphics, x0: number, y0: number, x1: number, y1: number, k: number, px: number): void {
  const w = x1 - x0;
  const h = y1 - y0;
  g.rect(x0 * px, y0 * px, w * px, k * px)
    .rect(x0 * px, (y1 - k) * px, w * px, k * px)
    .rect(x0 * px, (y0 + k) * px, k * px, (h - 2 * k) * px)
    .rect((x1 - k) * px, (y0 + k) * px, k * px, (h - 2 * k) * px);
}
