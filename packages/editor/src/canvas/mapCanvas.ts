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
 * - `worldView.ts` — the world map view (v1.2): all levels as thumbnails,
 *   drag to move, click to open, portal links (`setView("world")`)
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
  type ProjectLevel,
} from "@smap/core";
import { Application, CanvasSource, Container, Sprite, Texture, Ticker } from "pixi.js";

import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore, type CellRegion, type EditorState, type OpenProject } from "../state/editorStore";
import { getTilesetImage, onTilesetImage } from "../state/tilesetImages";
import { recallLevelView, rememberLevelView } from "../state/levelViewMemory";
import { t, type MessageKey } from "../i18n";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_PRESETS, snappedOffset, type Camera, type Point } from "./camera";
import { useUiStore } from "../ui/uiStore";
import { CameraController } from "./cameraController";
import type { BlockedAction, BlockedReason, CanvasContextRequest, CanvasPickEvent, StrokeSummary } from "./canvasEvents";
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
import { Rulers } from "./rulers";
import { INITIAL_TOOL_MEMORY, isPaintable, nextToolMemory, regionContains, toolForLayer, usesBrushSize, type ToolMemory } from "./tools";
import { WorldView, type CanvasView, type LevelMovedEvent, type WorldDataSource } from "./worldView";
import { releaseFilterInputs, releaseTexture } from "./releaseTexture";

export type { CanvasView, LevelMovedEvent, WorldDataSource, WorldSourceChange } from "./worldView";
export type { BlockedAction, BlockedReason, CanvasContextRequest, CanvasPickEvent, StrokeSummary, StrokeTool } from "./canvasEvents";

/** i18n key of the on-canvas hint per blocked reason. */
const BLOCKED_HINT: Record<BlockedReason, MessageKey> = {
  locked: "canvas.blockedLocked",
  hidden: "canvas.blockedHidden",
  wrongKind: "canvas.blockedWrongKind",
  noBrush: "toast.blockedNoBrush",
};

/** Zoom limits of the world view: far enough out for big worlds, no closer than 2× (thumbnails). */
const WORLD_MIN_ZOOM = 0.002;
const WORLD_MAX_ZOOM = 2;

/** A portal was double-clicked: open level `levelId` and show `point` (map px of that level; null = not set). */
export interface NavigateRequest {
  readonly levelId: string;
  readonly point: EntityPoint | null;
  /** Id of the portal entity that asked. */
  readonly entityId: string;
}

export interface CanvasHandle {
  destroy(): void;
  /** Next zoom preset up / down (animated, around the view centre). */
  zoomIn(): void;
  zoomOut(): void;
  /** 100 %. */
  zoomReset(): void;
  /**
   * Animates to zoom `zoom` (1 = 100 %, CSS px per map px) around the view
   * centre, e.g. a preset from {@link zoomPresets} or a typed value
   * (clamped to the view's limits, rounded so tiles stay whole device px).
   * The current zoom is the editor store's `zoom`.
   */
  setZoom(zoom: number): void;
  /** The level view's zoom presets (12.5 % … 1600 %) for a zoom dropdown, ascending. */
  readonly zoomPresets: readonly number[];
  /**
   * The zoom {@link setZoom}(`zoom`) actually ends at: clamped and rounded
   * so a tile is whole device px (e.g. the 66,7 % preset is 65,6 % with
   * 32 px tiles). Menus label presets with it, so they match the zoom field.
   */
  effectiveZoom(zoom: number): number;
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

  // ---------------------------------------------------------------- v1.2 world map

  /**
   * Switches between the level view (default) and the world map view. The
   * world view shows every level of the {@link setWorldSource} source and
   * frames them all on entering; returning restores the level camera (or
   * frames the map when another level was opened meanwhile).
   * {@link frameMap} frames all levels while the world view is shown.
   */
  setView(view: CanvasView): void;
  getView(): CanvasView;
  /** `cb` runs after every view change (also from {@link setView}). Returns an unsubscribe. */
  onViewChange(cb: (view: CanvasView) => void): () => void;
  /**
   * Where the world view gets levels and their documents from. Without one
   * it shows the project library's level list with only the active level's
   * picture. Set it again after every mount (the canvas is re-created per
   * project). `null` removes it.
   */
  setWorldSource(source: WorldDataSource | null): void;
  /**
   * A level was dragged to a new world position (already snapped to the
   * tile grid, or whole px with Alt). The UI applies it
   * (`setLevelWorldPosition(project, levelId, { x, y })`, no `snap` option)
   * and reports the new list; the canvas shows the drop position meanwhile.
   */
  onLevelMoved(cb: (event: LevelMovedEvent) => void): () => void;
  /** A level was clicked (not dragged) on the world map: the UI opens it and calls `setView("level")`. */
  onOpenLevel(cb: (levelId: string) => void): () => void;

  // ---------------------------------------------------------------- comfort round

  /**
   * Something was picked from the map (right click, right drag, eyedropper,
   * Alt + click): a tile (the tileset panel can scroll to it), an area /
   * flipped cell as a clip, or a grid layer value. The store selection is
   * already updated and a tile is already in `recentTiles`. Returns an unsubscribe.
   */
  onPick(cb: (event: CanvasPickEvent) => void): () => void;
  /**
   * An edit gesture finished as one undo step (brush / eraser stroke, stamp
   * drag, fill, rectangle) and changed `cells` cells (> 0), e.g. for an
   * undo toast. Returns an unsubscribe.
   */
  onStrokeCommitted(cb: (summary: StrokeSummary) => void): () => void;
  /**
   * Where cells (`region`) are on screen right now: CSS px relative to the
   * canvas' top-left corner. `null` in the world view or without a map.
   * Read it per frame (it follows pan / zoom, no event).
   */
  cellRectToScreen(region: { x: number; y: number; width: number; height: number }): ScreenRect | null;
  /** Size of the bottom-right box the minimap takes (margin included), or null when it is hidden. */
  minimapCorner(): { width: number; height: number } | null;
  /**
   * Fills `region` on the active layer with the current brush (tile, stamp
   * pattern, random set or terrain / collision value) as one undo step,
   * reported by {@link onStrokeCommitted} as "fill". No-op mid-gesture.
   */
  fillRegion(region: { x: number; y: number; width: number; height: number }): void;

  // ---------------------------------------------------------------- round 3

  /**
   * A left press on the map could not do anything because of the active
   * layer (locked, hidden, wrong kind for the tool).
   * The canvas also shows a short hint next to the pointer; the UI may add
   * a toast. Returns an unsubscribe.
   */
  onBlockedAction(cb: (action: BlockedAction) => void): () => void;
  /**
   * A right click asks for a context menu instead of picking tiles: on an
   * entity of the active entity layer, or (select tool) inside the
   * selection without a drag. `x` / `y` are client coordinates. Returns an
   * unsubscribe.
   */
  onContextRequest(cb: (request: CanvasContextRequest) => void): () => void;

  // ---------------------------------------------------------------- round 4

  /**
   * Shows `text` briefly next to the pointer (the same hint a blocked press
   * shows), e.g. why a command did nothing ("Kare olmayan tile döndürülemez").
   */
  showHint(text: string): void;
  /**
   * Shows / hides the tile-coordinate rulers (20 px, top and left edge of
   * the canvas; the map view shrinks by that much). Visible by default.
   * Screen positions from {@link cellRectToScreen} include the offset.
   */
  setRulersVisible(visible: boolean): void;
  areRulersVisible(): boolean;
  /**
   * Select tool with a selection: turns its content 90° in place on the
   * active layer (one undo step) and resizes the selection. False when there
   * is no selection to turn (the brush turns instead).
   */
  rotateSelection(dir: "cw" | "ccw"): boolean;
}

/** A rectangle in CSS pixels relative to the canvas' top-left corner. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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
const THUMB_LOD_BUDGET_MS = 10;

/** Idle chunk prebuild slice without a real idle period (no `requestIdleCallback` in WebKitGTK, or its timeout). */
const PREBUILD_FALLBACK_MS = 4;

/** Dev-only `window.__smap` hooks of the live canvases, oldest first. */
const debugHooks: unknown[] = [];

/**
 * `window.__smap` exists in dev and in the perf harness build
 * (`VITE_SMAP_DEBUG=1`, see `e2e/perf`); the normal production build has none.
 */
const DEBUG_HOOK = import.meta.env.DEV || import.meta.env.VITE_SMAP_DEBUG === "1";

/** Perf harness frame log (`window.__smapPerf`, debug builds only). */
interface PerfLog {
  frames: { start: number; end: number; revision: number; scene: boolean; lod: boolean; thumbPending: boolean }[];
}

function perfLog(): PerfLog | null {
  if (!DEBUG_HOOK) return null;
  return (window as unknown as { __smapPerf?: PerfLog }).__smapPerf ?? null;
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
  readonly #entities: EntityRenderer;
  #hoverEntity: string | null = null;
  #thumb: MapThumbnail | null = null;
  #thumbTexture: Texture | null = null;
  #thumbSizeVersion = -1;
  /** The thumbnail canvas changed since its texture was last uploaded. */
  #thumbTextureStale = false;
  #thumbTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #lodSprite = new Sprite();
  #lod = false;
  #minimap: Minimap | null = null;
  #minimapVisible = true;
  readonly #navigateListeners = new Set<(request: NavigateRequest) => void>();
  readonly #viewListeners = new Set<(view: CanvasView) => void>();
  readonly #movedListeners = new Set<(event: LevelMovedEvent) => void>();
  readonly #openListeners = new Set<(levelId: string) => void>();
  readonly #pickListeners = new Set<(event: CanvasPickEvent) => void>();
  readonly #strokeListeners = new Set<(summary: StrokeSummary) => void>();
  readonly #blockedListeners = new Set<(action: BlockedAction) => void>();
  readonly #contextListeners = new Set<(request: CanvasContextRequest) => void>();
  #view: CanvasView = "level";
  readonly #worldView: WorldView;
  /** Level-view camera saved when the world view opens. */
  #levelCamera: { camera: Camera; zoomLevel: number } | null = null;
  /** Another level was opened while the world view was shown: frame it on return. */
  #frameOnLevelView = false;
  /** Level id the current scene was loaded for. */
  #loadedLevelId: string | null = null;
  /** Destroy calls to run after the next render. */
  #retired: (() => void)[] = [];
  /** Camera right after the world view framed itself (re-framed once loads finish if unchanged). */
  #worldFramedCamera: Camera | null = null;
  #worldFramedLoads = -1;

  readonly #camera = new CameraController(
    () => this.#map(),
    () => this.#requestRender(),
  );
  readonly #input: PointerInput;
  readonly #tools: ToolController;
  readonly #overlays: OverlayRenderer;

  #raf = 0;
  #prebuildPending = false;
  #lastFrameTime = 0;
  #ro: ResizeObserver | null = null;
  /** Screen x of the canvas' left edge at the last resize (null before the first). */
  #reportedZoom = NaN;
  #unsubs: (() => void)[] = [];
  readonly #rulers: Rulers;
  /** Last tile tool (back after an entity layer) and the tool before the eyedropper. */
  #toolMemory: ToolMemory = INITIAL_TOOL_MEMORY;

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
    this.#rulers = new Rulers(container);

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
      springActive: () => this.#input.springActive,
      toolBeforeEyedropper: () => this.#toolMemory.beforeEyedropper,
      picked: (event) => void this.#emit(this.#pickListeners, event, "pick"),
      strokeCommitted: (summary) => void this.#emit(this.#strokeListeners, summary, "stroke"),
      flash: (region) => this.#overlays.flash(region),
      blocked: (action) => {
        this.#overlays.showHint(t(BLOCKED_HINT[action.reason]));
        this.#emit(this.#blockedListeners, action, "blocked action");
      },
      contextRequest: (request) => void this.#emit(this.#contextListeners, request, "context request"),
    });
    this.#worldView = new WorldView({
      camera: this.#camera,
      get colors() {
        return self.#colors;
      },
      activeStore: () => this.#scene?.store ?? null,
      activeLevelId: () => this.#activeLevelId(),
      activeTexture: () => (this.#thumb ? this.#uploadedThumbTexture() : null),
      fallbackLevels: () => useProjectLibrary.getState().levels,
      images: (id) => getTilesetImage(id)?.bitmap,
      pointer: () => this.#input.pointer,
      panning: () => this.#input.panning,
      capture: (id) => this.#input.capture(id),
      release: (id) => this.#input.release(id),
      levelMoved: (event) => this.#emit(this.#movedListeners, event, "level moved"),
      openLevel: (levelId) => void this.#emit(this.#openListeners, levelId, "open level"),
      retire: (texture) => this.#retire(texture),
      requestRender: () => this.#requestRender(),
    });
    this.#input = new PointerInput(canvas, {
      world: () => (this.#view === "world" ? this.#worldView : null),
      camera: this.#camera,
      tools: this.#tools,
      map: () => this.#map(),
      paintable: () => {
        const s = useEditorStore.getState();
        return isPaintable(activeInfo(this.#scene?.store)) || (s.tool === "brush" && savedStamp(s.stamp) !== null);
      },
      entityCursor: () => this.#entityCursor(),
      regionCursor: () => this.#regionCursor(),
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
      pointer: () => this.#input.pointer,
      lineAnchor: () => (this.#input.shiftDown && this.#input.cursorCell() ? this.#tools.lineAnchor() : null),
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
    this.#rulers.mount();
    this.#applyRulers(true);
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
    this.#app.stage.addChild(this.#world, this.#entities.root, this.#overlays.grid, this.#overlays.overlay, this.#worldView.root, this.#overlays.readout, this.#overlays.hint);
    this.#minimap = new Minimap(
      this.#container,
      {
        thumbnail: () => this.#thumb,
        mapSize: () => {
          const m = this.#map();
          return m ? { width: m.width * m.tileWidth, height: m.height * m.tileHeight } : null;
        },
        camera: () => ({ camera: this.#camera.camera, viewW: this.#camera.viewW, viewH: this.#camera.viewH }),
        centerOnWorld: (x, y) => this.#camera.centerOnWorld(x, y),
        colors: () => ({ accent: this.#colors.accent, background: this.#colors.mapBackground }),
        wheel: (e) => {
          if (this.#view === "level") this.#input.wheel(e, this.#camera.viewCenter());
        },
      },
      this.#abort.signal,
    );
    this.#minimap.setVisible(this.#minimapVisible);
    // "Fit map" needs no room for the minimap: it hides itself while the whole map is in view.

    this.#observeSize();
    this.#input.attach(this.#abort.signal);
    window.addEventListener("pointerdown", () => this.#camera.keepView(), { capture: true, signal: this.#abort.signal });
    this.#unsubs.push(useUiStore.subscribe((s, prev) => {
      if (s.panelsHidden !== prev.panelsHidden) this.#camera.keepView();
    }));
    this.#unsubs.push(useEditorStore.subscribe((s, prev) => this.#onEditorState(s, prev)));
    this.#unsubs.push(
      onTilesetImage((id) => {
        this.#scene?.imageChanged(id);
        this.#thumb?.imageChanged(id);
        this.#worldView.imageChanged(id);
        this.#requestRender();
      }),
    );
    this.#unsubs.push(
      useProjectLibrary.subscribe((s, prev) => {
        if (s.levels !== prev.levels) this.#worldView.listChanged();
      }),
    );
    this.#loadProject(useEditorStore.getState().project);
    if (DEBUG_HOOK) this.#installDebugHook();
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
        this.#camera.place(x, y, zoom);
      },
      handle: this.handle,
      /** World view: level boxes as last drawn, in client (page) px. */
      worldBoxes: () => {
        const r = this.#input.rect();
        const c = this.#camera.camera;
        const off = snappedOffset(c, this.#camera.resolution);
        return this.#worldView.boxes.map((b) => ({
          id: b.id,
          x: r.left + off.x + b.x * c.zoom,
          y: r.top + off.y + b.y * c.zoom,
          width: b.width * c.zoom,
          height: b.height * c.zoom,
          world: { x: b.x, y: b.y },
        }));
      },
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
    setZoom: (zoom) => {
      if (!Number.isFinite(zoom) || zoom <= 0 || this.#destroyed) return;
      this.#camera.animateZoomTo(zoom, this.#camera.viewCenter());
    },
    zoomPresets: ZOOM_PRESETS,
    effectiveZoom: (zoom) => this.#camera.effectiveZoom(zoom),
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
    setView: (view) => this.#setView(view),
    getView: () => this.#view,
    onViewChange: (cb) => {
      this.#viewListeners.add(cb);
      return () => this.#viewListeners.delete(cb);
    },
    setWorldSource: (source) => this.#worldView.setSource(source),
    onLevelMoved: (cb) => {
      this.#movedListeners.add(cb);
      return () => this.#movedListeners.delete(cb);
    },
    onOpenLevel: (cb) => {
      this.#openListeners.add(cb);
      return () => this.#openListeners.delete(cb);
    },
    onPick: (cb) => {
      this.#pickListeners.add(cb);
      return () => this.#pickListeners.delete(cb);
    },
    onStrokeCommitted: (cb) => {
      this.#strokeListeners.add(cb);
      return () => this.#strokeListeners.delete(cb);
    },
    cellRectToScreen: (region) => {
      const map = this.#map();
      if (!map || this.#view !== "level" || this.#destroyed) return null;
      const c = this.#camera.camera;
      const tw = map.tileWidth * c.zoom;
      const th = map.tileHeight * c.zoom;
      const inset = this.#rulers.inset;
      return { x: inset + c.x + region.x * tw, y: inset + c.y + region.y * th, width: region.width * tw, height: region.height * th };
    },
    minimapCorner: () => (this.#view === "level" && this.#minimap?.visible ? this.#minimap.footprint() : null),
    fillRegion: (region) => {
      if (this.#view !== "level" || this.#destroyed) return;
      this.#tools.fillRegion({ x: region.x, y: region.y, width: region.width, height: region.height });
    },
    onBlockedAction: (cb) => {
      this.#blockedListeners.add(cb);
      return () => this.#blockedListeners.delete(cb);
    },
    onContextRequest: (cb) => {
      this.#contextListeners.add(cb);
      return () => this.#contextListeners.delete(cb);
    },
    showHint: (text) => {
      if (!this.#destroyed) this.#overlays.showHint(text);
    },
    setRulersVisible: (visible) => {
      if (!this.#destroyed) this.#applyRulers(visible);
    },
    areRulersVisible: () => this.#rulers.visible,
    rotateSelection: (dir) => !this.#destroyed && this.#tools.rotateSelection(dir),
  };

  /** Shows / hides the rulers and insets the map canvas by their size (the resize observer re-sizes the view). */
  #applyRulers(visible: boolean): void {
    this.#rulers.setVisible(visible);
    // A canvas is a replaced element: left / right do not stretch it, so size it explicitly.
    const inset = this.#rulers.inset;
    Object.assign(this.#canvas.style, {
      top: `${inset}px`,
      left: `${inset}px`,
      right: "",
      bottom: "",
      width: inset > 0 ? `calc(100% - ${inset}px)` : "100%",
      height: inset > 0 ? `calc(100% - ${inset}px)` : "100%",
    } satisfies Partial<CSSStyleDeclaration>);
    this.#input.invalidateRect();
    this.#requestRender();
  }

  /** Calls every listener (errors are logged, not thrown). Returns true when there was one. */
  #emit<T>(listeners: Set<(value: T) => void>, value: T, what: string): boolean {
    for (const cb of [...listeners]) {
      try {
        cb(value);
      } catch (error) {
        console.error(`[canvas] ${what} listener failed`, error);
      }
    }
    return listeners.size > 0;
  }

  #activeLevelId(): string | null {
    const project = useEditorStore.getState().project;
    if (!project) return null;
    if (project.levelId) return project.levelId;
    const levels: readonly ProjectLevel[] = useProjectLibrary.getState().levels;
    return levels.find((l) => l.path === project.levelPath)?.id ?? levels[0]?.id ?? "";
  }

  // ------------------------------------------------------------------ views (v1.2)

  #setView(view: CanvasView): void {
    if (view === this.#view || this.#destroyed) return;
    const cam = this.#camera;
    this.#tools.end();
    this.#view = view;
    const world = view === "world";
    this.#world.visible = !world;
    this.#entities.root.visible = !world;
    this.#overlays.grid.visible = !world;
    this.#overlays.overlay.visible = !world;
    this.#minimap?.setVisible(this.#minimapVisible && !world);
    this.#hoverEntity = null;
    if (world) {
      this.#levelCamera = { camera: cam.camera, zoomLevel: cam.zoomLevel };
      this.#frameOnLevelView = false;
      cam.snapSteps = false;
      cam.setZoomLimits(WORLD_MIN_ZOOM, WORLD_MAX_ZOOM);
      cam.frameBounds = () => this.#worldView.bounds();
      this.#worldView.enter();
      this.#worldView.update(); // starts the loads
      cam.frameMap();
      this.#worldFramedCamera = cam.camera;
      this.#worldFramedLoads = -1;
    } else {
      this.#worldView.exit();
      cam.frameBounds = null;
      cam.snapSteps = true;
      cam.setZoomLimits(MIN_ZOOM, MAX_ZOOM);
      const saved = this.#levelCamera;
      this.#levelCamera = null;
      if (this.#frameOnLevelView || !saved) cam.requestInitialView();
      else {
        cam.place(saved.camera.x, saved.camera.y, saved.camera.zoom);
        cam.zoomLevel = saved.zoomLevel;
      }
      this.#frameOnLevelView = false;
    }
    this.#input.updateHover();
    this.#input.updateCursor();
    this.#requestRender();
    this.#emit(this.#viewListeners, view, "view change");
  }

  /** World view: frame all again once the first loads settle, unless the user moved the camera. */
  #reframeWorldAfterLoads(): void {
    const wv = this.#worldView;
    if (this.#worldFramedCamera === null || wv.loading) return;
    if (this.#camera.camera !== this.#worldFramedCamera) {
      this.#worldFramedCamera = null;
      return;
    }
    if (wv.loadVersion === this.#worldFramedLoads) return;
    this.#worldFramedLoads = wv.loadVersion;
    this.#camera.frameMap();
    this.#worldFramedCamera = this.#camera.camera;
  }

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
    this.#pickListeners.clear();
    this.#strokeListeners.clear();
    this.#blockedListeners.clear();
    this.#contextListeners.clear();
    this.#camera.dispose();
    this.#viewListeners.clear();
    this.#movedListeners.clear();
    this.#openListeners.clear();
    this.#worldView.destroy();
    this.#rulers.destroy();
    const s = useEditorStore.getState();
    if (s.hoverCell) s.setHoverCell(null);
    this.#flushRetired();
    if (this.#initialized) this.#teardownApp();
    else this.#removeCanvas(); // init still running (it tears the app down when it resolves) or failed
  }

  #teardownApp(): void {
    releaseFilterInputs(this.#app.renderer);
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
    this.#lodSprite.texture = Texture.EMPTY;
    if (this.#thumbTexture) {
      this.#worldView.unbind(this.#thumbTexture);
      this.#retire(this.#thumbTexture);
    }
    this.#thumbTexture = null;
    this.#thumbTextureStale = false;
    this.#thumbSizeVersion = -1;
    this.#lodSprite.removeFromParent();
    this.#lod = false;
    // Meshes and atlas pages go after the next render: the last frame's
    // batches may still reference their textures (Pixi warns otherwise).
    const gridOverlays = this.#gridOverlays;
    const scene = this.#scene;
    gridOverlays?.root.removeFromParent();
    scene?.root.removeFromParent();
    this.#gridOverlays = null;
    this.#scene = null;
    if (gridOverlays || scene) {
      this.#afterRender(() => {
        gridOverlays?.destroy();
        scene?.destroy();
      });
    }
  }

  #loadProject(project: OpenProject | null): void {
    this.#tools.end();
    this.#overlays.reset();
    // Keep the outgoing level's picture for the world view (no reload needed there).
    const outgoing = this.#scene?.store;
    const outgoingId = this.#loadedLevelId;
    if (outgoing && this.#thumb && outgoingId !== null && outgoingId !== (project?.levelId ?? null) && this.#thumbTexture) {
      this.#worldView.snapshotActive(outgoingId, outgoing, this.#thumb.canvas, !this.#thumb.pending);
    }
    // Remember where the outgoing level was viewed (this session).
    if (outgoing && outgoingId !== null) {
      if (this.#view === "level") rememberLevelView(outgoingId, this.#camera.savedView());
      else if (!this.#frameOnLevelView && this.#levelCamera) rememberLevelView(outgoingId, this.#camera.savedView(this.#levelCamera.camera));
    }
    this.#destroySceneObjects();
    this.#loadedLevelId = project ? this.#activeLevelId() : null;
    if (project) {
      this.#scene = new MapScene(
        project.store,
        (id) => getTilesetImage(id)?.bitmap,
        () => this.#requestRender(),
        this.#colors.mapBackground,
      );
      this.#gridOverlays = new GridOverlays(project.store, gridOverlayColors(this.#colors), () => this.#requestRender());
      this.#thumb = new MapThumbnail(project.store, (id) => getTilesetImage(id)?.bitmap, () => this.#scheduleThumbnail());
      this.#thumb.publishSnapshot(project, project.levelId ?? project.levelPath);
      this.#world.addChild(this.#scene.root, this.#lodSprite, this.#gridOverlays.root);
    }
    this.#entities.setStore(project?.store ?? null);
    this.#hoverEntity = null;
    // Previews above the layers.
    this.#world.addChild(this.#overlays.previews);
    this.#worldView.activeChanged();
    // A level seen before this session comes back where it was left; a new
    // one opens centred. The world view keeps its camera; the level view
    // shows the new level when it returns.
    const remembered = this.#loadedLevelId !== null ? recallLevelView(this.#loadedLevelId) : null;
    if (this.#view === "world") {
      this.#frameOnLevelView = remembered === null;
      if (remembered) this.#levelCamera = { camera: this.#camera.cameraFor(remembered), zoomLevel: remembered.zoom };
    } else if (remembered) this.#camera.restoreView(remembered);
    else this.#camera.requestInitialView();
    this.#requestRender();
  }

  #onEditorState(s: EditorState, prev: EditorState): void {
    if (s.project !== prev.project) {
      this.#loadProject(s.project);
      return;
    }
    if (s.tool !== prev.tool) this.#toolMemory = nextToolMemory(this.#toolMemory, prev.tool, s.tool);
    if (s.activeLayerId !== prev.activeLayerId) this.#matchToolToLayer(s);
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
      s.selectedEntityId !== prev.selectedEntityId ||
      s.brushSize !== prev.brushSize ||
      s.brushShape !== prev.brushShape ||
      s.terrain !== prev.terrain ||
      s.terrainActive !== prev.terrainActive
    ) {
      const sized = s.brushSize !== prev.brushSize || s.brushShape !== prev.brushShape;
      if (sized && this.#view === "level" && usesBrushSize(s.tool)) this.#overlays.showSizeReadout();
      this.#input.updateCursor();
      this.#requestRender();
    }
  }

  /**
   * Keeps the tool usable on a newly active layer: an entity layer swaps a
   * tile tool (brush, eraser, fill, rectangle) for the entity tool; a tile /
   * grid layer swaps the entity tool back to the last tile tool used.
   * Select, eyedropper and hand work everywhere and stay.
   */
  #matchToolToLayer(s: EditorState): void {
    const layer = activeLayer(this.#scene?.store);
    if (!layer) return;
    const next = toolForLayer(s.tool, isEntityLayer(layer), this.#toolMemory.lastTileTool);
    if (next !== s.tool) s.setTool(next);
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
    releaseFilterInputs(this.#app.renderer);
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
    const log = perfLog();
    const start = log ? performance.now() : 0;
    this.#frameBody(time);
    if (log) {
      log.frames.push({ start, end: performance.now(), revision: this.#scene?.store.revision ?? -1, scene: this.#scene !== null, lod: this.#lod, thumbPending: this.#thumb?.pending ?? false });
    }
  }

  #frameBody(time: number): void {
    const dt = this.#lastFrameTime > 0 ? Math.min(64, time - this.#lastFrameTime) : 16;
    this.#lastFrameTime = time;
    const cam = this.#camera;
    const animating = cam.step(dt);

    if (this.#view === "world") {
      this.#worldFrame(time, animating);
      return;
    }

    const off = snappedOffset(cam.camera, cam.resolution);
    this.#world.position.set(off.x, off.y);
    this.#world.scale.set(cam.camera.zoom);

    const visible = cam.visibleRegion();
    if (visible && this.#scene) {
      this.#scene.updateVisibility(visible.x, visible.y, visible.x + visible.width, visible.y + visible.height);
      this.#visible = visible;
    }
    this.#updateLod();
    // After visibility and LOD: builds only the dirty chunks that are on screen.
    this.#scene?.flush();
    this.#updateGridOverlays();
    this.#input.updateHover();
    this.#updateHoverEntity();
    this.#input.updateCursor(); // layer lock/visibility may have changed
    this.#overlays.draw();
    this.#entities.draw();
    this.#drawRulers();
    this.#updateMinimapAutoHide();
    this.#minimap?.draw();
    this.#app.renderer.render(this.#app.stage);
    this.#flushRetired();
    Ticker.system.update(time);
    this.#reportZoom();
    this.#schedulePrebuild();

    if (animating) this.#requestRender();
    else this.#lastFrameTime = 0;
  }

  /** Rulers for the current camera and hovered cell (no-op when hidden or unchanged). */
  #drawRulers(): void {
    const map = this.#map();
    if (!map) {
      this.#rulers.draw(null);
      return;
    }
    const cam = this.#camera;
    const off = snappedOffset(cam.camera, cam.resolution);
    this.#rulers.draw({
      originX: off.x,
      originY: off.y,
      cellW: map.tileWidth * cam.camera.zoom,
      cellH: map.tileHeight * cam.camera.zoom,
      cols: map.width,
      rows: map.height,
      viewW: cam.viewW,
      viewH: cam.viewH,
      resolution: cam.resolution,
      hover: this.#input.hover,
    });
  }

  /** The minimap hides itself while the whole map fits in the view (it would show nothing new). */
  #updateMinimapAutoHide(): void {
    const map = this.#map();
    const minimap = this.#minimap;
    if (!map || !minimap) return;
    const cam = this.#camera;
    const z = cam.camera.zoom;
    minimap.setAutoHidden(map.width * map.tileWidth * z <= cam.viewW + 0.5 && map.height * map.tileHeight * z <= cam.viewH + 0.5);
  }

  /** Meshes of the chunks just outside the view are built in idle time, so panning finds them ready. */
  #schedulePrebuild(): void {
    if (this.#prebuildPending || !this.#scene?.hasPrebuildWork) return;
    this.#prebuildPending = true;
    const run = (timeLeft: () => number) => {
      this.#prebuildPending = false;
      if (this.#destroyed || this.#view !== "level") return;
      if (this.#scene?.prebuild(timeLeft)) this.#schedulePrebuild();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(
        (deadline) => {
          const end = performance.now() + PREBUILD_FALLBACK_MS;
          run(deadline.didTimeout ? () => end - performance.now() : () => deadline.timeRemaining());
        },
        { timeout: 500 },
      );
    } else {
      setTimeout(() => {
        const end = performance.now() + PREBUILD_FALLBACK_MS;
        run(() => end - performance.now());
      }, 50);
    }
  }

  /** One frame of the world view: level pictures, links, labels. */
  #worldFrame(time: number, animating: boolean): void {
    // The live picture of the active level (edits by shortcut, e.g. undo, still show).
    let more = false;
    if (this.#thumb?.pending && this.#thumbTimer === null) {
      this.#pumpThumbnail(THUMB_LOD_BUDGET_MS);
      more = this.#thumb.pending;
    }
    more = this.#worldView.update() || more;
    this.#reframeWorldAfterLoads();
    this.#worldView.draw();
    this.#rulers.draw(null);
    this.#input.updateCursor();
    this.#app.renderer.render(this.#app.stage);
    this.#flushRetired();
    Ticker.system.update(time);
    this.#reportZoom();
    if (animating || more) this.#requestRender();
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
      if (old) {
        this.#worldView.unbind(old);
        this.#retire(old);
      }
      this.#thumbTextureStale = false;
    } else {
      // Uploaded only when shown (LOD sprite, world view): a big map's picture is
      // 4096² px, and re-uploading it after every slice while editing at normal
      // zoom (where nothing shows it) kept the GPU busy and delayed frames by seconds.
      this.#thumbTextureStale = true;
    }
    this.#requestRender();
  }

  /** The thumbnail texture, re-uploaded first if the picture changed since. */
  #uploadedThumbTexture(): Texture | null {
    const texture = this.#thumbTexture;
    if (texture && this.#thumbTextureStale) {
      this.#thumbTextureStale = false;
      texture.source.update();
    }
    return texture;
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
    if (lod) this.#uploadedThumbTexture();
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

  /** Select tool: over the selection (a drag moves its content), or moving it. */
  #regionCursor(): "over" | "moving" | null {
    if (this.#tools.gesture?.kind === "move") return "moving";
    const s = useEditorStore.getState();
    if (s.tool !== "select" || !s.region || this.#tools.gesture || this.#hoverEntity) return null;
    const cell = this.#input.cursorCell();
    return cell && regionContains(s.region, cell) ? "over" : null;
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

  /**
   * Destroys `texture` after the next render: the last frame's batches may
   * still reference it (Pixi warns when a bound source is destroyed).
   */
  #retire(texture: Texture): void {
    this.#afterRender(() => releaseTexture(texture));
  }

  /** Runs `fn` after the next render (right away when nothing renders any more). */
  #afterRender(fn: () => void): void {
    this.#retired.push(fn);
    if (this.#destroyed || !this.#initialized) this.#flushRetired();
    else this.#requestRender();
  }

  #flushRetired(): void {
    const list = this.#retired;
    this.#retired = [];
    for (const fn of list) {
      try {
        fn();
      } catch (error) {
        console.error("[canvas] deferred destroy failed", error);
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
