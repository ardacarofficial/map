/**
 * The map canvas: Pixi application, scene sync and the frame loop. Input,
 * camera, tools and overlays live in their own modules:
 *
 * - `cameraController.ts` — zoom / pan state, cell ↔ device-pixel mapping
 * - `pointerInput.ts` — DOM events, panning, hover, cursor
 * - `toolController.ts` — gestures → store ops (one undo step per gesture)
 * - `overlayRenderer.ts` — grid, border, region, previews, cursors
 * - `mapScene.ts` / `gridOverlays.ts` — tile layer meshes / grid-layer overlays
 * - `entityRenderer.ts` — entities of the entity layers (screen space)
 * - `mapThumbnail.ts` / `minimap.ts` — one low-res picture of the map: the
 *   minimap shows it, and when a cell is narrower than ~4 device px the map
 *   is drawn from that same picture instead of the chunk meshes (LOD, with
 *   hysteresis, see `minimapMath.ts`)
 *
 * Rendering is on demand: the Pixi ticker never runs. Anything that changes
 * the picture calls `requestRender()`, which schedules one
 * requestAnimationFrame; the frame keeps re-scheduling itself only while a
 * zoom animation is running. An idle editor therefore costs ~0 CPU/GPU, and
 * a brush change is drawn on the very next frame.
 */
import {
  PORTAL_TYPE_ID,
  isEntityLayer,
  isGridLayer,
  portalStatus,
  portalTarget,
  portalTargetPoint,
  type EntityPoint,
  type MapInfo,
} from "@smap/core";
import { Application, CanvasSource, Container, Sprite, Texture, Ticker } from "pixi.js";

import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore, type CellRegion, type EditorState, type OpenProject } from "../state/editorStore";
import { getTilesetImage, onTilesetImage } from "../state/tilesetImages";
import { snappedOffset, type Point } from "./camera";
import { CameraController } from "./cameraController";
import { CANVAS_COLORS, readThemeColors, type CanvasColors } from "./colors";
import type { EntityColors } from "./entityLogic";
import { EntityRenderer } from "./entityRenderer";
import { GridOverlays, type GridOverlayColors } from "./gridOverlays";
import { activeInfo, activeLayer, savedStamp } from "./layerAccess";
import { MapScene } from "./mapScene";
import { MapThumbnail } from "./mapThumbnail";
import { Minimap } from "./minimap";
import { nextLod } from "./minimapMath";
import { OverlayRenderer, type OverlayHost } from "./overlayRenderer";
import { PointerInput } from "./pointerInput";
import { ToolController, type Gesture } from "./toolController";
import { isPaintable } from "./tools";

/** A portal was double-clicked: open level `levelId` and show `point` (map px of that level; null = not set). */
export interface NavigateRequest {
  readonly levelId: string;
  readonly point: EntityPoint | null;
  /** Id of the portal entity that asked. */
  readonly entityId: string;
}

export interface CanvasHandle {
  destroy(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  /** Center the map in the view (fit if it is larger than the view). */
  frameMap(): void;
  /**
   * v1.1 portals: `cb` runs when a portal whose target level exists is
   * double-clicked. The canvas does not switch levels itself; the UI opens
   * the level, then calls {@link centerOn}. Returns an unsubscribe function.
   */
  onNavigate(cb: (request: NavigateRequest) => void): () => void;
  /** Moves the camera (zoom unchanged) so the centre of cell (`cellX`, `cellY`) is in the middle of the view. */
  centerOn(cellX: number, cellY: number): void;
  /** Shows / hides the minimap (bottom-right of the canvas). Visible by default. */
  setMinimapVisible(visible: boolean): void;
  isMinimapVisible(): boolean;
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

/** Thumbnail redraws while editing: at most one pass per this interval... */
const THUMB_THROTTLE_MS = 150;
/** ...of at most this long (more passes follow when chunks are left). */
const THUMB_IDLE_BUDGET_MS = 8;
/** Per frame while the map is drawn from the thumbnail. */
const THUMB_LOD_BUDGET_MS = 6;

/** Dev-only `window.__smap` hooks of the live canvases, oldest first. */
const debugHooks: unknown[] = [];

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
  readonly #entities: EntityRenderer;
  #hoverEntity: string | null = null;
  #thumb: MapThumbnail | null = null;
  #thumbTexture: Texture | null = null;
  #thumbSizeVersion = -1;
  #thumbTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #lodSprite = new Sprite();
  #lod = false;
  #minimap: Minimap | null = null;
  #minimapVisible = true;
  readonly #navigateListeners = new Set<(request: NavigateRequest) => void>();

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
    this.#entities = new EntityRenderer({
      camera: this.#camera,
      get colors() {
        return self.#colors;
      },
      get entityColors(): EntityColors {
        const c = self.#colors;
        return { spawn: c.entitySpawn, portal: c.entityPortal, danger: c.danger, unknown: c.accent };
      },
      hoverId: () => this.#hoverEntity,
      requestRender: () => this.#requestRender(),
    });
    this.#lodSprite.visible = false;
    this.#tools = new ToolController({
      get scene() {
        return self.#scene;
      },
      entities: this.#entities,
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
      paintable: () => {
        const s = useEditorStore.getState();
        return isPaintable(activeInfo(this.#scene?.store)) || (s.tool === "brush" && savedStamp(s.stamp) !== null);
      },
      entityCursor: () => this.#entityCursor(),
      doubleClick: (p) => this.#doubleClick(p),
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
      hoverEntityId: () => this.#hoverEntity,
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
    this.#app.stage.addChild(this.#world, this.#entities.root, this.#overlays.grid, this.#overlays.overlay);
    this.#minimap = new Minimap(
      this.#container,
      {
        thumbnail: () => (this.#thumb ? { canvas: this.#thumb.canvas, version: this.#thumb.version } : null),
        mapSize: () => {
          const m = this.#map();
          return m ? { width: m.width * m.tileWidth, height: m.height * m.tileHeight } : null;
        },
        camera: () => ({ camera: this.#camera.camera, viewW: this.#camera.viewW, viewH: this.#camera.viewH }),
        centerOnWorld: (x, y) => this.#camera.centerOnWorld(x, y),
        colors: () => ({ accent: this.#colors.accent, background: CANVAS_COLORS.mapBackground }),
      },
      this.#abort.signal,
    );
    this.#minimap.setVisible(this.#minimapVisible);

    this.#observeSize();
    this.#input.attach(this.#abort.signal);
    this.#unsubs.push(useEditorStore.subscribe((s, prev) => this.#onEditorState(s, prev)));
    this.#unsubs.push(
      onTilesetImage((id) => {
        this.#scene?.imageChanged(id);
        this.#thumb?.imageChanged(id);
        this.#requestRender();
      }),
    );
    this.#loadProject(useEditorStore.getState().project);
    if (import.meta.env.DEV) this.#installDebugHook();
  }

  /** Dev-only `window.__smap` for e2e scripts and the console. */
  #installDebugHook(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
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
      /** Collision overlay code of a cell as last rasterized (0 when not built). */
      collisionCode: (x: number, y: number) => this.#gridOverlays?.collisionCode(x, y) ?? 0,
      /** True while the map is drawn from the thumbnail (far-zoom LOD). */
      get lod() {
        return self.#lod;
      },
      /** The map thumbnail canvas (minimap / LOD picture). */
      get thumbnail() {
        return self.#thumb?.canvas ?? null;
      },
      /** Sets the camera directly (zoom = CSS px per map px). */
      setCamera: (x: number, y: number, zoom: number) => {
        this.#camera.stopAnimation();
        this.#camera.zoomLevel = zoom;
        this.#camera.camera = { x, y, zoom };
        this.#requestRender();
      },
      handle: this.handle,
    };
    // StrictMode mounts two canvases whose async inits may resolve in either order; the
    // hook always points at the newest canvas still alive.
    const w = window as unknown as { __smap?: unknown };
    debugHooks.push(hook);
    w.__smap = hook;
    this.#unsubs.push(() => {
      const i = debugHooks.indexOf(hook);
      if (i >= 0) debugHooks.splice(i, 1);
      if (w.__smap !== hook) return;
      if (debugHooks.length > 0) w.__smap = debugHooks[debugHooks.length - 1];
      else delete w.__smap;
    });
  }

  readonly handle: CanvasHandle = {
    destroy: () => this.destroy(),
    zoomIn: () => this.#camera.zoomStep(1),
    zoomOut: () => this.#camera.zoomStep(-1),
    zoomReset: () => this.#camera.animateZoomTo(1, this.#camera.viewCenter()),
    frameMap: () => this.#camera.frameMap(),
    onNavigate: (cb) => {
      this.#navigateListeners.add(cb);
      return () => this.#navigateListeners.delete(cb);
    },
    centerOn: (cellX, cellY) => {
      const map = this.#map();
      if (!map) return;
      this.#camera.centerOnWorld((cellX + 0.5) * map.tileWidth, (cellY + 0.5) * map.tileHeight);
    },
    setMinimapVisible: (visible) => {
      this.#minimapVisible = visible;
      this.#minimap?.setVisible(visible);
    },
    isMinimapVisible: () => this.#minimapVisible,
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
    this.#entities.destroy();
    this.#lodSprite.destroy();
    this.#navigateListeners.clear();
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
    if (this.#thumbTimer !== null) clearTimeout(this.#thumbTimer);
    this.#thumbTimer = null;
    this.#thumb?.destroy();
    this.#thumb = null;
    this.#thumbTexture?.destroy(true);
    this.#thumbTexture = null;
    this.#thumbSizeVersion = -1;
    this.#lodSprite.texture = Texture.EMPTY;
    this.#lodSprite.removeFromParent();
    this.#lod = false;
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
      this.#thumb = new MapThumbnail(project.store, (id) => getTilesetImage(id)?.bitmap, () => this.#scheduleThumbnail());
      this.#world.addChild(this.#scene.root, this.#lodSprite, this.#gridOverlays.root);
    }
    this.#entities.setStore(project?.store ?? null);
    this.#hoverEntity = null;
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
      s.collisionOverlay !== prev.collisionOverlay ||
      s.randomSet !== prev.randomSet ||
      s.entityTypeId !== prev.entityTypeId ||
      s.selectedEntityId !== prev.selectedEntityId
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
    this.#updateLod();
    this.#updateGridOverlays();
    this.#input.updateHover();
    this.#updateHoverEntity();
    this.#input.updateCursor(); // layer lock/visibility may have changed
    this.#overlays.draw();
    this.#entities.draw();
    this.#minimap?.draw();
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

  // ------------------------------------------------------------------ thumbnail, LOD

  /** Thumbnail changes are batched: at most one redraw pass per interval while editing. */
  #scheduleThumbnail(delay = this.#thumbSizeVersion >= 0 ? THUMB_THROTTLE_MS : 0): void {
    if (this.#thumbTimer !== null || this.#destroyed) return;
    // While the map is drawn from the thumbnail, the frame updates it right away.
    if (this.#lod) {
      this.#requestRender();
      return;
    }
    this.#thumbTimer = setTimeout(() => {
      this.#thumbTimer = null;
      this.#pumpThumbnail(THUMB_IDLE_BUDGET_MS);
      // A big rebuild continues in short slices.
      if (this.#thumb?.pending) this.#scheduleThumbnail(16);
    }, delay);
  }

  /** Redraws dirty thumbnail chunks within `budgetMs` and uploads the result. */
  #pumpThumbnail(budgetMs: number): void {
    const thumb = this.#thumb;
    if (!thumb || !thumb.update(budgetMs)) return;
    if (thumb.sizeVersion !== this.#thumbSizeVersion || !this.#thumbTexture) {
      this.#thumbSizeVersion = thumb.sizeVersion;
      const old = this.#thumbTexture;
      this.#thumbTexture = new Texture({
        source: new CanvasSource({ resource: thumb.canvas, scaleMode: "linear", autoGenerateMipmaps: true, antialias: false }),
      });
      this.#lodSprite.texture = this.#thumbTexture;
      old?.destroy(true);
    } else {
      this.#thumbTexture.source.update();
    }
    this.#requestRender();
  }

  /** Switches between chunk meshes and the thumbnail (far zoom), with hysteresis. */
  #updateLod(): void {
    const map = this.#map();
    const scene = this.#scene;
    const thumb = this.#thumb;
    if (!map || !scene || !thumb) return;
    const cam = this.#camera;
    const cellDevicePx = Math.min(map.tileWidth, map.tileHeight) * cam.camera.zoom * cam.resolution;
    const lod = nextLod(this.#lod, cellDevicePx);
    if (lod) {
      // Keep the picture current while it is on screen (edits show on the next frame).
      if (thumb.pending) {
        this.#pumpThumbnail(THUMB_LOD_BUDGET_MS);
        if (thumb.pending) this.#requestRender();
      }
      if (!this.#thumbTexture) return; // nothing to show yet: keep the meshes
    }
    else if (thumb.pending && this.#thumbTimer === null) this.#scheduleThumbnail(16);
    this.#lod = lod;
    scene.setTilesVisible(!lod);
    const sprite = this.#lodSprite;
    sprite.visible = lod;
    if (lod) {
      const s = thumb.scale;
      sprite.position.set(0, 0);
      sprite.width = (thumb.canvas.width / s) * map.tileWidth;
      sprite.height = (thumb.canvas.height / s) * map.tileHeight;
    }
  }

  // ------------------------------------------------------------------ entities

  /** Entity under the pointer that a click would select (entity / select tool on an entity layer). */
  #updateHoverEntity(): void {
    const g = this.#tools.gesture;
    let id: string | null = null;
    if (g?.kind === "entity") id = g.entityId;
    else if (!g && this.#input.cursorCell()) {
      const s = useEditorStore.getState();
      const layer = activeLayer(this.#scene?.store);
      if ((s.tool === "entity" || s.tool === "select") && isEntityLayer(layer) && layer.visible && this.#input.pointer) {
        id = this.#entities.hitTest(layer, this.#input.pointer)?.id ?? null;
      }
    }
    this.#hoverEntity = id;
  }

  #entityCursor(): "over" | "drag" | "blocked" | null {
    const g = this.#tools.gesture;
    if (g?.kind === "entity") return g.movable ? "drag" : null;
    const s = useEditorStore.getState();
    if (s.tool !== "entity" && s.tool !== "select") return null;
    const layer = activeLayer(this.#scene?.store);
    if (this.#hoverEntity) return isEntityLayer(layer) && !layer.locked ? "over" : null;
    if (s.tool === "select") return null;
    const ok = isEntityLayer(layer) && layer.visible && !layer.locked && !!s.entityTypeId;
    return ok ? null : "blocked";
  }

  /** Double click: a portal of a visible entity layer asks to open its target level. */
  #doubleClick(p: Point): void {
    const entity = this.#entities.hitTestVisible(p);
    if (!entity || entity.typeId !== PORTAL_TYPE_ID) return;
    const levelId = portalTarget(entity);
    const project = { name: "", levels: useProjectLibrary.getState().levels, tilesets: [] };
    if (levelId === null || portalStatus(project, entity) !== "ok") return;
    const request: NavigateRequest = { levelId, point: portalTargetPoint(entity), entityId: entity.id };
    for (const cb of [...this.#navigateListeners]) {
      try {
        cb(request);
      } catch (error) {
        console.error("[canvas] navigate listener failed", error);
      }
    }
  }

  #reportZoom(): void {
    const zoom = this.#camera.camera.zoom;
    if (zoom === this.#reportedZoom) return;
    this.#reportedZoom = zoom;
    useEditorStore.getState().setZoom(zoom);
  }
}
