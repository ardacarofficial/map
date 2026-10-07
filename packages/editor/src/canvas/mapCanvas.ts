/**
 * The map canvas: Pixi application, scene sync and the frame loop. Input,
 * camera, tools and overlays live in their own modules:
 *
 * - `cameraController.ts` — zoom / pan state, cell ↔ device-pixel mapping
 * - `pointerInput.ts` — DOM events, panning, hover, cursor
 * - `toolController.ts` — gestures → store ops (one undo step per gesture)
 * - `overlayRenderer.ts` — grid, border, region, previews, cursors
 * - `mapScene.ts` / `gridOverlays.ts` — tile layer meshes / grid-layer overlays
 *
 * Rendering is on demand: the Pixi ticker never runs. Anything that changes
 * the picture calls `requestRender()`, which schedules one
 * requestAnimationFrame; the frame keeps re-scheduling itself only while a
 * zoom animation is running. An idle editor therefore costs ~0 CPU/GPU, and
 * a brush change is drawn on the very next frame.
 */
import { isGridLayer, type MapInfo } from "@smap/core";
import { Application, Container, Ticker } from "pixi.js";

import { useEditorStore, type CellRegion, type EditorState, type OpenProject } from "../state/editorStore";
import { getTilesetImage, onTilesetImage } from "../state/tilesetImages";
import { snappedOffset } from "./camera";
import { CameraController } from "./cameraController";
import { CANVAS_COLORS, readThemeColors, type CanvasColors } from "./colors";
import { GridOverlays, type GridOverlayColors } from "./gridOverlays";
import { activeInfo, activeLayer } from "./layerAccess";
import { MapScene } from "./mapScene";
import { OverlayRenderer, type OverlayHost } from "./overlayRenderer";
import { PointerInput } from "./pointerInput";
import { ToolController, type Gesture } from "./toolController";
import { isPaintable } from "./tools";

export interface CanvasHandle {
  destroy(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  /** Center the map in the view (fit if it is larger than the view). */
  frameMap(): void;
}

function gridOverlayColors(c: CanvasColors): GridOverlayColors {
  return {
    terrainTint: c.terrainTint,
    terrainTintAlpha: c.terrainTintAlpha,
    collisionSolid: c.collisionSolid,
    collisionSolidAlpha: c.collisionSolidAlpha,
    collisionPassable: c.collisionPassable,
    collisionPassableAlpha: c.collisionPassableAlpha,
  };
}

export class MapCanvas {
  readonly #container: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #app = new Application();
  readonly #abort = new AbortController();
  #initialized = false;
  #destroyed = false;
  #restoreContainerPosition: string | null = null;
  #colors: CanvasColors = CANVAS_COLORS;

  readonly #world = new Container();
  #scene: MapScene | null = null;
  #gridOverlays: GridOverlays | null = null;
  /** Cells currently on screen (set every frame). */
  #visible: CellRegion = { x: 0, y: 0, width: 0, height: 0 };
  #showCollision = false;

  readonly #camera = new CameraController(
    () => this.#map(),
    () => this.#requestRender(),
  );
  readonly #input: PointerInput;
  readonly #tools: ToolController;
  readonly #overlays: OverlayRenderer;

  #raf = 0;
  #lastFrameTime = 0;
  #ro: ResizeObserver | null = null;
  #reportedZoom = NaN;
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

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.#tools = new ToolController({
      get scene() {
        return self.#scene;
      },
      camera: this.#camera,
      toLocal: (e) => this.#input.toLocal(e),
      pointerCell: () => this.#input.pointerCell(),
      capture: (id) => this.#input.capture(id),
      release: (id) => this.#input.release(id),
      requestRender: () => this.#requestRender(),
    });
    this.#input = new PointerInput(canvas, {
      camera: this.#camera,
      tools: this.#tools,
      map: () => this.#map(),
      paintable: () => isPaintable(activeInfo(this.#scene?.store)),
      requestRender: () => this.#requestRender(),
    });
    const overlayHost: OverlayHost = {
      get scene() {
        return self.#scene;
      },
      get gridOverlays() {
        return self.#gridOverlays;
      },
      camera: this.#camera,
      get colors() {
        return self.#colors;
      },
      get visible() {
        return self.#visible;
      },
      get gesture(): Gesture | null {
        return self.#tools.gesture;
      },
      get showCollision() {
        return self.#showCollision;
      },
      cursorCell: () => this.#input.cursorCell(),
      pointerCell: () => this.#input.pointerCell(),
      requestRender: () => this.#requestRender(),
    };
    this.#overlays = new OverlayRenderer(overlayHost);
  }

  async init(): Promise<void> {
    if (getComputedStyle(this.#container).position === "static") {
      this.#restoreContainerPosition = this.#container.style.position;
      this.#container.style.position = "relative";
    }
    this.#container.appendChild(this.#canvas);
    this.#colors = readThemeColors(this.#container);
    const rect = this.#canvas.getBoundingClientRect();
    const cam = this.#camera;
    cam.resolution = window.devicePixelRatio || 1;
    cam.viewW = Math.max(1, rect.width);
    cam.viewH = Math.max(1, rect.height);
    await this.#app.init({
      canvas: this.#canvas,
      width: cam.viewW,
      height: cam.viewH,
      resolution: cam.resolution,
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
    this.#overlays.setColors(this.#colors);
    this.#app.stage.addChild(this.#world, this.#overlays.grid, this.#overlays.overlay);

    this.#observeSize();
    this.#input.attach(this.#abort.signal);
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
        const map = this.#map();
        if (!map) return null;
        const r = this.#input.rect();
        const c = this.#camera.camera;
        return {
          x: r.left + c.x + (x + 0.5) * map.tileWidth * c.zoom,
          y: r.top + c.y + (y + 0.5) * map.tileHeight * c.zoom,
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
    zoomIn: () => this.#camera.zoomStep(1),
    zoomOut: () => this.#camera.zoomStep(-1),
    zoomReset: () => this.#camera.animateZoomTo(1, this.#camera.viewCenter()),
    frameMap: () => this.#camera.frameMap(),
  };

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#tools.end();
    this.#abort.abort();
    this.#ro?.disconnect();
    this.#ro = null;
    cancelAnimationFrame(this.#raf);
    for (const u of this.#unsubs) u();
    this.#unsubs = [];
    this.#destroySceneObjects();
    this.#overlays.destroy();
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

  #map(): MapInfo | undefined {
    return this.#scene?.store.document.map;
  }

  // ------------------------------------------------------------------ project

  #destroySceneObjects(): void {
    this.#gridOverlays?.destroy();
    this.#gridOverlays = null;
    this.#scene?.destroy();
    this.#scene = null;
  }

  #loadProject(project: OpenProject | null): void {
    this.#tools.end();
    this.#overlays.reset();
    this.#destroySceneObjects();
    if (project) {
      this.#scene = new MapScene(
        project.store,
        (id) => getTilesetImage(id)?.bitmap,
        () => this.#requestRender(),
      );
      this.#gridOverlays = new GridOverlays(project.store, gridOverlayColors(this.#colors), () => this.#requestRender());
      this.#world.addChild(this.#scene.root, this.#gridOverlays.root);
    }
    // Previews above the layers.
    this.#world.addChild(this.#overlays.previews);
    this.#camera.requestFrameMap();
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
      s.stamp !== prev.stamp ||
      s.gridValue !== prev.gridValue ||
      s.collisionOverlay !== prev.collisionOverlay
    ) {
      this.#input.updateCursor();
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
    const viewW = devW / resolution;
    const viewH = devH / resolution;
    this.#app.renderer.resize(viewW, viewH, resolution);
    this.#input.invalidateRect();
    this.#camera.resize(viewW, viewH, resolution);
    this.#requestRender();
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
    const cam = this.#camera;
    const animating = cam.step(dt);

    this.#scene?.flush();
    const off = snappedOffset(cam.camera, cam.resolution);
    this.#world.position.set(off.x, off.y);
    this.#world.scale.set(cam.camera.zoom);

    const visible = cam.visibleRegion();
    if (visible && this.#scene) {
      this.#scene.updateVisibility(visible.x, visible.y, visible.x + visible.width, visible.y + visible.height);
      this.#visible = visible;
    }
    this.#updateGridOverlays();
    this.#input.updateHover();
    this.#input.updateCursor(); // layer lock/visibility may have changed
    this.#overlays.draw();
    this.#app.renderer.render(this.#app.stage);
    Ticker.system.update(time);
    this.#reportZoom();

    if (animating) this.#requestRender();
    else this.#lastFrameTime = 0;
  }

  /** Terrain tint of the active terrain layer; collision overlay when toggled or a collision layer is active. */
  #updateGridOverlays(): void {
    const overlays = this.#gridOverlays;
    const s = useEditorStore.getState();
    const layer = activeLayer(this.#scene?.store);
    const grid = isGridLayer(layer) ? layer : null;
    this.#showCollision = !!overlays && (s.collisionOverlay || grid?.role === "collision");
    if (!overlays) return;
    overlays.update({
      visible: this.#visible,
      showCollision: this.#showCollision,
      terrainLayer: grid?.role === "terrain" ? grid : null,
    });
  }

  #reportZoom(): void {
    const zoom = this.#camera.camera.zoom;
    if (zoom === this.#reportedZoom) return;
    this.#reportedZoom = zoom;
    useEditorStore.getState().setZoom(zoom);
  }
}
