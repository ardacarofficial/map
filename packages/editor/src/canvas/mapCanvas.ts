/**
 * The map canvas: Pixi application, camera, input, overlays.
 *
 * Rendering is on demand: the Pixi ticker never runs. Anything that changes
 * the picture calls `#requestRender()`, which schedules one
 * requestAnimationFrame; the frame keeps re-scheduling itself only while a
 * zoom animation is running. An idle editor therefore costs ~0 CPU/GPU, and
 * a brush change is drawn on the very next frame.
 */
import {
  EMPTY_CELL,
  cellFlags,
  cellPaletteIndex,
  copyRegion,
  floodFill,
  isGridLayer,
  makeCell,
  pasteClip,
  type CellPoint,
  type CellWrite,
  type MapStore,
  type TileClip,
  type TileLayer,
} from "@smap/core";
import { AlphaFilter, Application, Container, Graphics, Sprite, Texture, Ticker } from "pixi.js";

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
import { cellMaskImage, membershipMask, type CellMaskImage } from "./cellMask";
import type { CellQuad } from "./chunkGeometry";
import { gridLayout } from "./grid";
import { MapScene } from "./mapScene";
import { MaskPreview, TilePreview } from "./preview";
import {
  cursorFor,
  decidePick,
  dragRegion,
  isEditable,
  patternCell,
  patternLayerIndex,
  rectPreviewCells,
  regionContains,
  snapToStampGrid,
  stampMapping,
  stampOrigins,
  stampPreviewCells,
  type LayerInfo,
  type PreviewCell,
} from "./tools";
import type { CellRegion } from "../state/editorStore";

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

/** Most cells a rectangle preview draws as tiles (beyond that: outline only). */
const RECT_PREVIEW_LIMIT = 20_000;
/** Fill hover preview: minimum time between two flood fills, and the largest map it runs on. */
const FILL_PREVIEW_THROTTLE_MS = 40;
const FILL_PREVIEW_MAX_AREA = 4_000_000;

/** A pointer interaction in progress (left or right button). */
type Gesture =
  | {
      readonly kind: "paint";
      readonly pointerId: number;
      readonly store: MapStore;
      readonly layerId: string;
      readonly value: number;
      last: CellPoint | null;
    }
  | {
      readonly kind: "stamp";
      readonly pointerId: number;
      readonly store: MapStore;
      readonly clip: TileClip;
      readonly mapping: Record<string, string>;
      readonly start: CellPoint;
      readonly placed: Set<string>;
      last: CellPoint | null;
    }
  | { readonly kind: "rect"; readonly pointerId: number; readonly start: CellPoint; end: CellPoint }
  | { readonly kind: "select"; readonly pointerId: number; readonly start: CellPoint; end: CellPoint; moved: boolean }
  | { readonly kind: "pick"; readonly pointerId: number; readonly button: number; readonly start: CellPoint; end: CellPoint };

interface FillCache {
  readonly layer: TileLayer;
  readonly revision: number;
  readonly width: number;
  readonly mask: Uint8Array;
  readonly image: CellMaskImage | null;
}

/** `PointerEvent.buttons` bit of a `PointerEvent.button`. */
function buttonBit(button: number): number {
  return button === 1 ? 4 : button === 2 ? 2 : 1 << button;
}

/** True when `e` reports that `button` was just released. */
function released(e: PointerEvent, button: number): boolean {
  return e.button === button && (e.buttons & buttonBit(button)) === 0;
}

function layerInfo(layer: TileLayer): LayerInfo {
  return {
    id: layer.id,
    visible: layer.visible,
    locked: layer.locked,
    grid: isGridLayer(layer),
    getCell: (x, y) => layer.getCell(x, y),
  };
}

const clipIds = new WeakMap<TileClip, number>();
let nextClipId = 1;
function clipId(clip: TileClip): number {
  let id = clipIds.get(clip);
  if (id === undefined) clipIds.set(clip, (id = nextClipId++));
  return id;
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
  readonly #tilePreview = new TilePreview(CANVAS_COLORS.previewAlpha);
  readonly #fillPreview = new MaskPreview(CANVAS_COLORS.accent, CANVAS_COLORS.fillPreviewAlpha);
  #scene: MapScene | null = null;
  /** Cells currently on screen (set every frame). */
  #visible: CellRegion = { x: 0, y: 0, width: 0, height: 0 };
  #fillCache: FillCache | null = null;
  #lastFillAt = -Infinity;
  #fillTimer: ReturnType<typeof setTimeout> | null = null;

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
  #gesture: Gesture | null = null;
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
    // Pixi's global system ticker (texture GC scheduler, pointer-move emulation) would request an
    // animation frame forever. Stop it and advance it from our own on-demand frames instead.
    Ticker.system.autoStart = false;
    Ticker.system.stop();
    this.#app.stage.eventMode = "none";
    this.#preview.alpha = CANVAS_COLORS.previewAlpha;
    this.#fillPreview.sprite.tint = this.#colors.accent;
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
    if (import.meta.env.DEV) this.#installDebugHook();
  }

  /** Dev-only `window.__smap` for e2e scripts and the console. */
  #installDebugHook(): void {
    const hook = {
      editor: useEditorStore,
      get store() {
        return useEditorStore.getState().project?.store ?? null;
      },
      /** Client (page) coordinates of the centre of cell (x, y). */
      cellCenter: (x: number, y: number) => {
        const map = this.#scene?.store.document.map;
        if (!map) return null;
        const r = this.#rect();
        const z = this.#camera.zoom;
        return {
          x: r.left + this.#camera.x + (x + 0.5) * map.tileWidth * z,
          y: r.top + this.#camera.y + (y + 0.5) * map.tileHeight * z,
        };
      },
      handle: this.handle,
    };
    (window as unknown as { __smap?: unknown }).__smap = hook;
    this.#unsubs.push(() => {
      const w = window as unknown as { __smap?: unknown };
      if (w.__smap === hook) delete w.__smap;
    });
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
    this.#endGesture();
    if (this.#fillTimer !== null) clearTimeout(this.#fillTimer);
    this.#abort.abort();
    this.#ro?.disconnect();
    this.#ro = null;
    cancelAnimationFrame(this.#raf);
    for (const u of this.#unsubs) u();
    this.#unsubs = [];
    this.#scene?.destroy();
    this.#scene = null;
    this.#tilePreview.destroy();
    this.#fillPreview.destroy();
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
    this.#endGesture();
    this.#fillCache = null;
    this.#fillPreview.set(null, 1, 1);
    this.#tilePreview.invalidate();
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
    // Previews above the layers.
    this.#world.addChild(this.#fillPreview.sprite, this.#tilePreview.root, this.#preview);
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
      s.activeLayerId !== prev.activeLayerId ||
      s.region !== prev.region ||
      s.stamp !== prev.stamp
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
      const css = entry.contentBoxSize?.[0];
      const cssW = css ? css.inlineSize : entry.contentRect.width;
      // Trust the device box unless it disagrees with css × dpr by more than snapping can explain
      // (seen with emulated device scale factors).
      if (dev && Math.abs(dev.inlineSize - cssW * dpr) <= 2) {
        devW = dev.inlineSize;
        devH = dev.blockSize;
      } else {
        devW = Math.round(cssW * dpr);
        devH = Math.round((css ? css.blockSize : entry.contentRect.height) * dpr);
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
      this.#visible = { x: r.x0, y: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 };
    }
    this.#updateHover();
    this.#updateCursor(); // layer lock/visibility may have changed
    this.#drawOverlay();
    this.#app.renderer.render(this.#app.stage);
    Ticker.system.update(time);
    this.#reportZoom();

    if (animating) this.#requestRender();
    else this.#lastFrameTime = 0;
  }

  #reportZoom(): void {
    if (this.#camera.zoom === this.#reportedZoom) return;
    this.#reportedZoom = this.#camera.zoom;
    useEditorStore.getState().setZoom(this.#camera.zoom);
  }

  /** Grid, map border, region, tool previews and cursors, all in whole device pixels. */
  #drawOverlay(): void {
    const g = this.#overlay;
    g.clear();
    this.#grid.clear();
    this.#grid.visible = false;
    const map = this.#scene?.store.document.map;
    this.#preview.visible = false;
    this.#tilePreview.root.visible = false;
    this.#fillPreview.sprite.visible = false;
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
    const b = this.#cellBox({ x: 0, y: 0, width: map.width, height: map.height });
    rectOutline(g, b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1, 1, px);
    g.fill(this.#colors.mapBorder);

    const gesture = this.#gesture;
    if (state.region && gesture?.kind !== "select") this.#drawRegion(state.region);

    switch (gesture?.kind) {
      case "select": {
        const r = dragRegion(gesture.start, gesture.end, map);
        if (r) this.#drawRegion(r);
        return;
      }
      case "rect": {
        const r = dragRegion(gesture.start, gesture.end, map);
        if (r) {
          this.#showPatternPreview(r, gesture.start);
          const box = this.#cellBox(r);
          const k = this.#lineWidth();
          rectOutline(g, box.x0 - k, box.y0 - k, box.x1 + k, box.y1 + k, k, px);
          g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.45 });
          rectOutline(g, box.x0, box.y0, box.x1, box.y1, k, px);
          g.fill(this.#colors.accent);
        }
        return;
      }
      case "pick": {
        const r = dragRegion(gesture.start, gesture.end, map);
        if (r) this.#drawDashed(r);
        return;
      }
      case "stamp": {
        const at = this.#pointerCell() ?? gesture.last ?? gesture.start;
        this.#showStampPreview(gesture.clip, gesture.mapping, snapToStampGrid(gesture.start, at, gesture.clip.width, gesture.clip.height));
        return;
      }
      default:
        break;
    }

    const cell = this.#cursorCell();
    if (!cell) return;
    const editable = isEditable(this.#activeInfo());
    const one = { x: cell.x, y: cell.y, width: 1, height: 1 };
    switch (state.tool) {
      case "brush": {
        if (state.stamp) {
          const mapping = this.#mappingFor(state.stamp);
          if (Object.keys(mapping).length > 0) this.#showStampPreview(state.stamp, mapping, cell);
          else this.#drawCellCursor(one);
          return;
        }
        if (!editable) return this.#drawCellCursor(one);
        const sel = state.selection;
        const tex = sel ? this.#scene?.atlas(sel.tilesetId)?.tileTexture(sel.tileId) : undefined;
        if (tex) {
          this.#preview.texture = tex;
          this.#preview.position.set(cell.x * map.tileWidth, cell.y * map.tileHeight);
          this.#preview.width = map.tileWidth;
          this.#preview.height = map.tileHeight;
          this.#preview.visible = true;
        } else this.#drawCellCursor(one);
        return;
      }
      case "fill":
        if (editable) this.#showFillPreview(cell);
        return this.#drawCellCursor(one);
      case "rect":
        if (editable) this.#showPatternPreview(one, cell);
        return this.#drawCellCursor(one);
      default:
        return this.#drawCellCursor(one);
    }
  }

  /** Device-pixel box of a cell rectangle (x1/y1 exclusive), matching the snapped world transform. */
  #cellBox(r: CellRegion): { x0: number; y0: number; x1: number; y1: number } {
    const map = this.#scene!.store.document.map;
    const res = this.#resolution;
    const off = snappedOffset(this.#camera, res);
    const ox = Math.round(off.x * res);
    const oy = Math.round(off.y * res);
    const cw = map.tileWidth * this.#camera.zoom * res;
    const ch = map.tileHeight * this.#camera.zoom * res;
    return {
      x0: Math.round(ox + r.x * cw),
      y0: Math.round(oy + r.y * ch),
      x1: Math.round(ox + (r.x + r.width) * cw),
      y1: Math.round(oy + (r.y + r.height) * ch),
    };
  }

  /** Outline thickness in device pixels: one CSS pixel, at least one device pixel. */
  #lineWidth(): number {
    return Math.max(1, Math.round(this.#resolution));
  }

  /** Region / marquee: subtle accent fill plus a crisp accent outline. */
  #drawRegion(r: CellRegion): void {
    const g = this.#overlay;
    const px = 1 / this.#resolution;
    const b = this.#cellBox(r);
    g.rect(b.x0 * px, b.y0 * px, (b.x1 - b.x0) * px, (b.y1 - b.y0) * px).fill({
      color: this.#colors.accent,
      alpha: CANVAS_COLORS.regionFillAlpha,
    });
    const k = this.#lineWidth();
    // Dark halo just outside keeps the accent line readable on any tile.
    rectOutline(g, b.x0 - k, b.y0 - k, b.x1 + k, b.y1 + k, k, px);
    g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.45 });
    rectOutline(g, b.x0, b.y0, b.x1, b.y1, k, px);
    g.fill(this.#colors.accent);
  }

  /** Pick area: static black line with white dashes. */
  #drawDashed(r: CellRegion): void {
    const g = this.#overlay;
    const px = 1 / this.#resolution;
    const k = this.#lineWidth();
    const b = this.#cellBox(r);
    rectOutline(g, b.x0, b.y0, b.x1, b.y1, k, px);
    g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.85 });
    const dash = 4 * k;
    const step = 7 * k;
    for (let x = b.x0; x < b.x1; x += step) {
      const w = Math.min(dash, b.x1 - x);
      g.rect(x * px, b.y0 * px, w * px, k * px).rect(x * px, (b.y1 - k) * px, w * px, k * px);
    }
    for (let y = b.y0; y < b.y1; y += step) {
      const h = Math.min(dash, b.y1 - y);
      g.rect(b.x0 * px, y * px, k * px, h * px).rect((b.x1 - k) * px, y * px, k * px, h * px);
    }
    g.fill(CANVAS_COLORS.cursor);
  }

  /** White cell outline with a dark halo (eraser, fill, select, pick cursors). */
  #drawCellCursor(r: CellRegion): void {
    const g = this.#overlay;
    const px = 1 / this.#resolution;
    const k = this.#lineWidth();
    const { x0, y0, x1, y1 } = this.#cellBox(r);
    rectOutline(g, x0 - k, y0 - k, x1 + k, y1 + k, k, px);
    g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.6 });
    rectOutline(g, x0, y0, x1, y1, k, px);
    g.fill({ color: CANVAS_COLORS.cursor, alpha: 0.9 });
  }

  /** Builds `cells` into the tile preview unless its key is unchanged. */
  #setTilePreview(key: string, cells: readonly PreviewCell[]): void {
    const scene = this.#scene;
    if (!scene) return;
    const fullKey = `${key}|${scene.atlasVersion}`;
    if (this.#tilePreview.key !== fullKey) {
      const quads: CellQuad[] = [];
      for (const c of cells) {
        const src = scene.quadSource(c.entry.tilesetId, c.entry.tileId);
        if (src) quads.push({ x: c.x, y: c.y, flags: c.flags, src });
      }
      const map = scene.store.document.map;
      this.#tilePreview.set(fullKey, quads, map.tileWidth, map.tileHeight, (gr) => scene.groupTexture(gr));
    }
    this.#tilePreview.root.visible = true;
  }

  #showStampPreview(clip: TileClip, mapping: Record<string, string>, origin: CellPoint): void {
    const map = this.#scene!.store.document.map;
    const key = `stamp:${clipId(clip)}:${Object.entries(mapping).flat().join(",")}`;
    if (this.#tilePreview.key?.startsWith(`${key}|`) !== true) this.#setTilePreview(key, stampPreviewCells(clip, mapping));
    else this.#tilePreview.root.visible = true;
    this.#tilePreview.root.position.set(origin.x * map.tileWidth, origin.y * map.tileHeight);
    // Bounds, so empty / same-looking parts of the stamp are still visible.
    this.#drawCellCursor({ x: origin.x, y: origin.y, width: clip.width, height: clip.height });
  }

  /** Rectangle (or single-cell) preview with the current pattern tiled from `anchor`. */
  #showPatternPreview(r: CellRegion, anchor: CellPoint): void {
    const pattern = this.#previewPattern(anchor);
    if (!pattern) return;
    const v = this.#visible;
    const x0 = Math.max(r.x, v.x);
    const y0 = Math.max(r.y, v.y);
    const x1 = Math.min(r.x + r.width, v.x + v.width);
    const y1 = Math.min(r.y + r.height, v.y + v.height);
    const key = `rect:${pattern.key}:${anchor.x},${anchor.y}:${x0},${y0},${x1},${y1}`;
    if (this.#tilePreview.key?.startsWith(`${key}|`) === true) {
      this.#tilePreview.root.visible = true;
    } else {
      const cells = rectPreviewCells(r, v, RECT_PREVIEW_LIMIT, pattern.at);
      if (!cells) return;
      this.#setTilePreview(key, cells);
    }
    this.#tilePreview.root.position.set(0, 0);
  }

  /** What the fill/rectangle tools would draw at a cell, without touching the document. */
  #previewPattern(anchor: CellPoint): { key: string; at: Parameters<typeof rectPreviewCells>[3] } | null {
    const s = useEditorStore.getState();
    if (s.stamp) {
      const clip = s.stamp;
      const li = patternLayerIndex(clip, this.#mappingFor(clip), s.activeLayerId);
      if (li < 0) return null;
      return {
        key: `c${clipId(clip)}/${li}`,
        at: (x, y) => {
          const cell = patternCell(clip, li, x, y, anchor.x, anchor.y);
          const entry = cell === EMPTY_CELL ? undefined : clip.palette[cellPaletteIndex(cell) - 1];
          return entry ? { entry, flags: cellFlags(cell) } : null;
        },
      };
    }
    const sel = s.selection;
    if (!sel) return null;
    const entry = { tilesetId: sel.tilesetId, tileId: sel.tileId };
    return { key: `s${sel.tilesetId}/${sel.tileId}`, at: () => ({ entry, flags: 0 }) };
  }

  /** Highlights the region a click would fill (throttled, cached while inside the same region). */
  #showFillPreview(cell: CellPoint): void {
    const scene = this.#scene;
    const s = useEditorStore.getState();
    const layer = this.#activeLayer();
    if (!scene || !layer || (!s.stamp && !s.selection)) return;
    const map = scene.store.document.map;
    if (map.width * map.height > FILL_PREVIEW_MAX_AREA) return;
    // A single tile over cells that already hold it changes nothing.
    if (!s.stamp && s.selection) {
      const index = scene.store.document.palette.indexOf(s.selection.tilesetId, s.selection.tileId);
      if (index > 0 && layer.getCell(cell.x, cell.y) === makeCell(index)) return;
    }
    let c = this.#fillCache;
    const fresh = c && c.layer === layer && c.revision === scene.store.revision && c.width === map.width;
    if (!fresh || c!.mask[cell.y * map.width + cell.x] !== 1) {
      const now = performance.now();
      const wait = this.#lastFillAt + FILL_PREVIEW_THROTTLE_MS - now;
      if (wait > 0) {
        this.#fillTimer ??= setTimeout(() => {
          this.#fillTimer = null;
          this.#requestRender();
        }, wait);
        return;
      }
      this.#lastFillAt = now;
      const points = floodFill(layer, cell.x, cell.y, -1, map);
      c = this.#fillCache = {
        layer,
        revision: scene.store.revision,
        width: map.width,
        mask: membershipMask(points, map.width, map.height),
        image: cellMaskImage(points),
      };
    }
    this.#fillPreview.set(c!.image, map.tileWidth, map.tileHeight);
    this.#fillPreview.sprite.visible = c!.image !== null;
  }

  /** Hovered map cell for cursors and previews, or null while panning / off the map. */
  #cursorCell(): CellPoint | null {
    if (!this.#pointer || this.#pan || this.#spaceDown) return null;
    return this.#reportedHover;
  }

  /** Cell under the pointer, also outside the map (drags), or null without a pointer. */
  #pointerCell(): CellPoint | null {
    const map = this.#scene?.store.document.map;
    if (!map || !this.#pointer) return null;
    return screenToCell(this.#camera, this.#pointer.x, this.#pointer.y, map.tileWidth, map.tileHeight, this.#resolution);
  }

  #activeLayer(): TileLayer | undefined {
    const id = useEditorStore.getState().activeLayerId;
    return id ? this.#scene?.store.document.getLayer(id) : undefined;
  }

  #activeInfo(): LayerInfo | undefined {
    const layer = this.#activeLayer();
    return layer ? layerInfo(layer) : undefined;
  }

  #mappingFor(clip: TileClip): Record<string, string> {
    const doc = this.#scene?.store.document;
    if (!doc) return {};
    return stampMapping(clip, useEditorStore.getState().activeLayerId, (id) => {
      const l = doc.getLayer(id);
      return l ? layerInfo(l) : undefined;
    });
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
      if (this.#gesture || this.#pan) return;
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
    // Capture phase: runs before the global shortcut handler, which skips prevented events.
    window.addEventListener("keydown", (e) => this.#onEscape(e), { signal: this.#abort.signal, capture: true });
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
    const cursor = cursorFor({
      tool: useEditorStore.getState().tool,
      panning: this.#pan !== null,
      spaceDown: this.#spaceDown,
      hasMap: this.#scene !== null,
      overMap: this.#reportedHover !== null,
      editable: isEditable(this.#activeInfo()),
    });
    if (this.#canvas.style.cursor !== cursor) this.#canvas.style.cursor = cursor;
  }

  /** Esc cancels the gesture in progress (and is then not a "deselect"). */
  #onEscape(e: KeyboardEvent): void {
    if (e.key !== "Escape" || !this.#gesture) return;
    e.preventDefault();
    this.#cancelGesture();
  }

  #onPointerDown(e: PointerEvent): void {
    this.#canvasRect = null;
    this.#pointer = this.#toLocal(e);
    if (document.activeElement !== this.#canvas) this.#canvas.focus({ preventScroll: true });
    if (e.button === 2 && this.#isCancelable()) {
      this.#cancelGesture();
      return;
    }
    if (this.#pan || this.#gesture) return;
    if (e.button === 1 || (e.button === 0 && this.#spaceDown)) {
      e.preventDefault();
      this.#pan = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      this.#capture(e.pointerId);
      this.#anim = null;
      this.#updateCursor();
      this.#requestRender();
      return;
    }
    const cell = this.#pointerCell();
    if (!cell) return;
    if (e.button === 2) {
      e.preventDefault();
      this.#startGesture({ kind: "pick", pointerId: e.pointerId, button: 2, start: cell, end: cell });
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    const s = useEditorStore.getState();
    switch (s.tool) {
      case "brush":
        if (s.stamp) this.#beginStamp(e, s.stamp, cell);
        else this.#beginPaint(e);
        break;
      case "eraser":
        this.#beginPaint(e);
        break;
      case "fill":
        this.#fillAt(cell);
        break;
      case "rect":
        if (isEditable(this.#activeInfo()) && (s.stamp || s.selection)) {
          this.#startGesture({ kind: "rect", pointerId: e.pointerId, start: cell, end: cell });
        }
        break;
      case "select":
        this.#startGesture({ kind: "select", pointerId: e.pointerId, start: cell, end: cell, moved: false });
        break;
      case "eyedropper":
        this.#startGesture({ kind: "pick", pointerId: e.pointerId, button: 0, start: cell, end: cell });
        break;
    }
    this.#requestRender();
  }

  #onPointerMove(e: PointerEvent): void {
    this.#pointer = this.#toLocal(e);
    const g = this.#gesture;
    if (this.#pan && e.pointerId === this.#pan.pointerId) {
      const dx = e.clientX - this.#pan.lastX;
      const dy = e.clientY - this.#pan.lastY;
      this.#pan.lastX = e.clientX;
      this.#pan.lastY = e.clientY;
      this.#camera = { ...this.#camera, x: this.#camera.x + dx, y: this.#camera.y + dy };
    } else if (g && e.pointerId === g.pointerId) {
      // A second button pressed or released mid-drag arrives as a move ("chorded" buttons).
      if (e.button === 2 && (e.buttons & 2) !== 0 && this.#isCancelable()) {
        this.#cancelGesture();
      } else if (g.kind === "pick" && released(e, g.button)) {
        this.#finishGesture();
      } else if (g.kind === "paint" || g.kind === "stamp") {
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        this.#paint(events.length > 0 ? events : [e]);
      } else {
        const cell = this.#pointerCell();
        if (cell) {
          if (g.kind === "select" && (cell.x !== g.start.x || cell.y !== g.start.y)) g.moved = true;
          g.end = cell;
        }
      }
    }
    this.#requestRender();
  }

  #onPointerUp(e: PointerEvent): void {
    const g = this.#gesture;
    if (this.#pan && e.pointerId === this.#pan.pointerId) {
      this.#endPan();
    } else if (g && e.pointerId === g.pointerId) {
      const button = g.kind === "pick" ? g.button : 0;
      if (released(e, button)) {
        if (g.kind === "paint" || g.kind === "stamp") this.#paint([e]);
        else {
          const cell = this.#pointerCell();
          if (cell) g.end = cell;
        }
        this.#finishGesture();
      }
    }
    this.#release(e.pointerId);
    this.#requestRender();
  }

  #onPointerEnd(e: PointerEvent): void {
    if (this.#pan && e.pointerId === this.#pan.pointerId) this.#endPan();
    if (this.#gesture && e.pointerId === this.#gesture.pointerId) this.#endGesture();
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

  // ------------------------------------------------------------------ gestures

  #startGesture(g: Gesture): void {
    this.#gesture = g;
    this.#capture(g.pointerId);
    this.#requestRender();
  }

  /** Rectangle, marquee and pick drags can be cancelled (Esc, right click); strokes only by Esc. */
  #isCancelable(): boolean {
    const g = this.#gesture;
    return !!g && (g.kind === "rect" || g.kind === "select" || (g.kind === "pick" && g.button === 0));
  }

  /** Completes the gesture normally (pointer released). */
  #finishGesture(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    switch (g.kind) {
      case "paint":
      case "stamp":
        if (g.store.inTransaction) g.store.commit();
        break;
      case "rect":
        this.#commitRect(g.start, g.end);
        break;
      case "select":
        this.#finishSelect(g.start, g.end, g.moved);
        break;
      case "pick":
        this.#finishPick(g.start, g.end);
        break;
    }
    this.#release(g.pointerId);
    this.#requestRender();
  }

  /** Ends without applying drags; keeps what a stroke already painted (lost capture, project change). */
  #endGesture(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    if ((g.kind === "paint" || g.kind === "stamp") && g.store.inTransaction) g.store.commit();
    this.#release(g.pointerId);
    this.#requestRender();
  }

  /** Cancels the gesture; a stroke is rolled back. */
  #cancelGesture(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    if ((g.kind === "paint" || g.kind === "stamp") && g.store.inTransaction) g.store.rollback();
    this.#release(g.pointerId);
    this.#requestRender();
  }

  #markDirty(): void {
    const st = useEditorStore.getState();
    if (!st.dirty) st.setDirty(true);
  }

  /** Runs `fn` as one undo step; rolls back if it throws. */
  #transact(store: MapStore, fn: () => boolean): void {
    store.beginTransaction();
    let changed: boolean;
    try {
      changed = fn();
    } catch (error) {
      store.rollback();
      console.error("[canvas] edit failed", error);
      return;
    }
    store.commit();
    if (changed) this.#markDirty();
  }

  /** Active layer when tile tools may write to it. */
  #editTarget(): { store: MapStore; layer: TileLayer } | null {
    const store = this.#scene?.store;
    const layer = this.#activeLayer();
    if (!store || !layer || !isEditable(layerInfo(layer))) return null;
    return { store, layer };
  }

  /**
   * Document cell the fill/rectangle tools write at (x, y): the selected tile,
   * or the stamp tiled from `anchor` (`EMPTY_CELL` = leave the cell alone).
   * Adds palette entries as needed, so call it inside the transaction.
   */
  #writePattern(store: MapStore, anchor: CellPoint): ((x: number, y: number) => number) | null {
    const s = useEditorStore.getState();
    if (s.stamp) {
      const clip = s.stamp;
      const li = patternLayerIndex(clip, this.#mappingFor(clip), s.activeLayerId);
      if (li < 0) return null;
      const remap = new Map<number, number>();
      return (x, y) => {
        const cell = patternCell(clip, li, x, y, anchor.x, anchor.y);
        if (cell === EMPTY_CELL) return EMPTY_CELL;
        const local = cellPaletteIndex(cell);
        let index = remap.get(local);
        if (index === undefined) {
          const entry = clip.palette[local - 1];
          if (!entry) return EMPTY_CELL;
          index = store.getOrAddPaletteIndex(entry.tilesetId, entry.tileId);
          remap.set(local, index);
        }
        return makeCell(index, cellFlags(cell));
      };
    }
    const sel = s.selection;
    if (!sel || !store.document.getTileset(sel.tilesetId)) return null;
    const value = makeCell(store.getOrAddPaletteIndex(sel.tilesetId, sel.tileId));
    return () => value;
  }

  #fillAt(cell: CellPoint): void {
    const t = this.#editTarget();
    if (!t) return;
    const { store, layer } = t;
    const map = store.document.map;
    if (!store.document.inBounds(cell.x, cell.y)) return;
    // The sentinel never equals a cell, so this is the whole same-valued region.
    const points = floodFill(layer, cell.x, cell.y, -1, map);
    this.#transact(store, () => {
      const at = this.#writePattern(store, { x: 0, y: 0 });
      if (!at) return false;
      const cells: CellWrite[] = [];
      for (const p of points) {
        const v = at(p.x, p.y);
        if (v === EMPTY_CELL || layer.getCell(p.x, p.y) === v) continue;
        cells.push({ x: p.x, y: p.y, cell: v });
      }
      if (cells.length === 0) return false;
      return store.dispatch({ type: "paintCells", layerId: layer.id, cells }).cells.length > 0;
    });
  }

  #commitRect(start: CellPoint, end: CellPoint): void {
    const t = this.#editTarget();
    if (!t) return;
    const { store, layer } = t;
    const r = dragRegion(start, end, store.document.map);
    if (!r) return;
    this.#transact(store, () => {
      const at = this.#writePattern(store, start);
      if (!at) return false;
      const cells: CellWrite[] = [];
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) {
          const v = at(x, y);
          if (v === EMPTY_CELL || layer.getCell(x, y) === v) continue;
          cells.push({ x, y, cell: v });
        }
      }
      if (cells.length === 0) return false;
      return store.dispatch({ type: "paintCells", layerId: layer.id, cells }).cells.length > 0;
    });
  }

  #finishSelect(start: CellPoint, end: CellPoint, moved: boolean): void {
    const map = this.#scene?.store.document.map;
    if (!map) return;
    const s = useEditorStore.getState();
    if (!moved) {
      // A click: keeps the region when inside it, clears it otherwise.
      if (!regionContains(s.region, start)) s.setRegion(null);
      return;
    }
    s.setRegion(dragRegion(start, end, map));
  }

  #finishPick(start: CellPoint, end: CellPoint): void {
    const doc = this.#scene?.store.document;
    if (!doc) return;
    const r = dragRegion(start, end, doc.map);
    if (!r) return;
    const s = useEditorStore.getState();
    const result = decidePick(doc.layers.map(layerInfo), s.activeLayerId, r, (i) => doc.palette.get(i));
    if (result.kind === "none") return;
    if (result.kind === "tile") {
      s.setStamp(null);
      s.setSelection(result.entry);
    } else {
      let clip: TileClip;
      try {
        clip = copyRegion(doc, [result.layerId], result.region);
      } catch (error) {
        console.error("[canvas] pick failed", error);
        return;
      }
      s.setSelection(null);
      s.setStamp(clip);
    }
    // Fill and rectangle use the picked tile too; tools that cannot place it switch to the brush.
    if (s.tool === "eraser" || s.tool === "select" || s.tool === "eyedropper") s.setTool("brush");
  }

  // ------------------------------------------------------------------ painting

  #beginPaint(e: PointerEvent): void {
    const state = useEditorStore.getState();
    const t = this.#editTarget();
    if (!t) return;
    const { store, layer } = t;
    let value: number;
    if (state.tool === "eraser") value = EMPTY_CELL;
    else {
      const sel = state.selection;
      if (!sel || !store.document.getTileset(sel.tilesetId)) return;
      try {
        value = makeCell(store.getOrAddPaletteIndex(sel.tilesetId, sel.tileId));
      } catch (error) {
        console.error("[canvas] cannot paint selection", error);
        return;
      }
    }
    store.beginTransaction();
    this.#startGesture({ kind: "paint", pointerId: e.pointerId, store, layerId: layer.id, value, last: null });
    this.#paint([e]);
  }

  #beginStamp(e: PointerEvent, clip: TileClip, start: CellPoint): void {
    const store = this.#scene?.store;
    if (!store) return;
    const mapping = this.#mappingFor(clip);
    if (Object.keys(mapping).length === 0) return;
    store.beginTransaction();
    this.#startGesture({ kind: "stamp", pointerId: e.pointerId, store, clip, mapping, start, placed: new Set(), last: null });
    this.#paint([e]);
  }

  #paint(events: readonly PointerEvent[]): void {
    const g = this.#gesture;
    if (!g || (g.kind !== "paint" && g.kind !== "stamp")) return;
    const doc = g.store.document;
    const { tileWidth, tileHeight, width, height } = doc.map;
    const samples = events.map((ev) => {
      const p = this.#toLocal(ev);
      return screenToCell(this.#camera, p.x, p.y, tileWidth, tileHeight, this.#resolution);
    });
    const cells = strokeCells(g.last, samples);
    g.last = samples[samples.length - 1] ?? g.last;

    if (g.kind === "stamp") {
      let changed = false;
      try {
        for (const o of stampOrigins(g.start, cells, g.clip.width, g.clip.height, g.placed)) {
          if (pasteClip(g.store, g.clip, g.mapping, o.x, o.y).length > 0) changed = true;
        }
      } catch (error) {
        console.error("[canvas] stamp failed", error);
        this.#cancelGesture();
        return;
      }
      if (changed) this.#markDirty();
      return;
    }

    const layer = doc.getLayer(g.layerId);
    if (!layer) return;
    const writes = cellWrites(cells, g.value, width, height, (x, y) => layer.getCell(x, y));
    if (writes.length === 0) return;
    const patch = g.store.dispatch({ type: "paintCells", layerId: g.layerId, cells: writes });
    if (patch.cells.length > 0) this.#markDirty();
  }
}

/** Adds a `k`-device-px rectangle outline (inside x0..x1, y0..y1) to `g` as four rects. */
function rectOutline(g: Graphics, x0: number, y0: number, x1: number, y1: number, k: number, px: number): void {
  const w = x1 - x0;
  const h = y1 - y0;
  g.rect(x0 * px, y0 * px, w * px, k * px)
    .rect(x0 * px, (y1 - k) * px, w * px, k * px)
    .rect(x0 * px, (y0 + k) * px, k * px, (h - 2 * k) * px)
    .rect((x1 - k) * px, (y0 + k) * px, k * px, (h - 2 * k) * px);
}
