/**
 * World map view (v1.2): the canvas' second view, not a separate editor
 * (CLAUDE.md: "mevcut tuvalin ikinci görünümü"). Every level of the project
 * is a thumbnail at its world position; levels are dragged (snapping to the
 * tile grid, Alt = no snap) and opened with a click; portal links are lines
 * with an arrowhead between levels. No neighbour-edge preview, no auto
 * snapping to other levels, no overlap checks (CLAUDE.md v1.2).
 *
 * Pictures: the active level uses the live map thumbnail (the minimap /
 * far-zoom picture); other levels are rendered once from the document the
 * {@link WorldDataSource} loads, kept in a {@link ThumbCache} and re-read
 * only when the source reports that level changed. When the active level
 * changes, the outgoing level's live picture is kept as its snapshot.
 *
 * Drawing: thumbnails are sprites in a world-space container; backgrounds,
 * frames, links, the grid and labels are drawn in screen space (crisp
 * device-pixel lines at every zoom). Rendering stays on demand: nothing here
 * runs unless the canvas draws a frame.
 */
import { MapStore, worldLinks, type MapDocument, type ProjectLevel } from "@smap/core";
import { CanvasSource, CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";

import { screenToWorld, snappedOffset, type Point } from "./camera";
import type { CameraController } from "./cameraController";
import { CANVAS_COLORS, type CanvasColors } from "./colors";
import { entityBox } from "./entityLogic";
import { MapThumbnail, type ThumbImageLookup } from "./mapThumbnail";
import type { Rect } from "./minimapMath";
import { ThumbCache } from "./worldThumbCache";
import {
  arrowHead,
  dragLevelPosition,
  ellipsize,
  exceedsDragThreshold,
  gridSpacing,
  hitTestLevels,
  linkEndpoints,
  worldBounds,
  type LocalLink,
  type WorldLevelBox,
} from "./worldMath";

/** Which picture the canvas shows: the active level, or all levels on the world map. */
export type CanvasView = "level" | "world";

/** What changed in a {@link WorldDataSource}. */
export interface WorldSourceChange {
  /**
   * Levels whose *content* changed (their thumbnails are re-read with
   * `loadThumbnailDoc`); `"all"` = every level. Omitted = only the level
   * list changed (names, order, world positions, added / removed levels).
   */
  readonly levels?: readonly string[] | "all";
}

/**
 * Where the world view gets the project's levels from (implemented by the
 * UI on top of its level session cache).
 */
export interface WorldDataSource {
  /** Ordered level list with ids, names and world positions. Read on every frame; keep it cheap. */
  levels(): readonly ProjectLevel[];
  /**
   * The document of a level that is not the active one, for its thumbnail
   * and portal links (the in-memory copy when the level has unsaved edits,
   * otherwise its file). The canvas never mutates it.
   */
  loadThumbnailDoc(levelId: string): Promise<MapDocument>;
  /** Calls `cb` when the list or a level's content changes. Returns an unsubscribe. */
  onChange(cb: (change: WorldSourceChange) => void): () => void;
}

/** A level was dropped at a new world position (already snapped, whole px). */
export interface LevelMovedEvent {
  readonly levelId: string;
  readonly x: number;
  readonly y: number;
}

export interface WorldViewHost {
  readonly camera: CameraController;
  readonly colors: CanvasColors;
  /** Store of the active (open) level, or null. */
  activeStore(): MapStore | null;
  /** Id of the active level, or null. */
  activeLevelId(): string | null;
  /** Live thumbnail texture of the active level, or null while it is not built yet. */
  activeTexture(): Texture | null;
  /** Fallback level list when no data source is set. */
  fallbackLevels(): readonly ProjectLevel[];
  readonly images: ThumbImageLookup;
  /** Pointer position (canvas CSS px) for hover, or null. */
  pointer(): Point | null;
  /** True while the pointer input pans (no hover). */
  panning(): boolean;
  capture(pointerId: number): void;
  release(pointerId: number): void;
  /** Emits the move; returns true when someone listens (the move is then shown until the list catches up). */
  levelMoved(event: LevelMovedEvent): boolean;
  openLevel(levelId: string): void;
  /** Destroys a texture after the next render (a batch may still reference it). */
  retire(texture: Texture): void;
  requestRender(): void;
}

/** Longest side of a non-active level's thumbnail, px. */
const WORLD_THUMB_MAX_PX = 1024;
/** Thumbnail redraw budget per frame, ms. */
const THUMB_BUDGET_MS = 6;
/** Label strip above a level (CSS px): counts for hit testing. */
const LABEL_STRIP_PX = 18;
/** Size of a level whose document is not loaded yet (map px) when nothing better is known. */
const PLACEHOLDER_SIZE = { width: 1024, height: 768 };

const LABEL_STYLE = new TextStyle({
  fontFamily: "Inter Variable, Inter, system-ui, sans-serif",
  fontSize: 12,
  fontWeight: "500",
  fill: 0xffffff,
});

/** Cached picture of a level that is not the active one. */
interface LevelThumb {
  readonly doc: MapDocument;
  /** Renders the picture (null for a snapshot of a former live picture). */
  readonly thumb: MapThumbnail | null;
  readonly canvas: HTMLCanvasElement;
  texture: Texture | null;
  sizeVersion: number;
}

interface Press {
  readonly pointerId: number;
  readonly levelId: string;
  readonly downScreen: Point;
  readonly downWorld: Point;
  readonly origin: Point;
  dragging: boolean;
  position: Point;
  alt: boolean;
}

interface LabelItem {
  readonly text: Text;
  key: string;
}

export class WorldView {
  /** Screen-space root (the camera transform is applied to the sprite layer inside). */
  readonly root = new Container();
  readonly #under = new Graphics();
  readonly #sprites = new Container();
  readonly #over = new Graphics();
  readonly #labels = new Container();
  readonly #spritePool = new Map<string, Sprite>();
  readonly #labelPool = new Map<string, LabelItem>();
  readonly #host: WorldViewHost;
  readonly #cache = new ThumbCache<LevelThumb>((t) => this.#disposeThumb(t));
  /** Last known map px size per level (placeholders keep their size while reloading). */
  readonly #sizes = new Map<string, { width: number; height: number }>();
  /** Positions dropped but not yet reported back by the level list. */
  readonly #pendingMoves = new Map<string, Point>();
  #source: WorldDataSource | null = null;
  #unsubSource: (() => void) | null = null;
  #unsubStore: (() => void) | null = null;
  #store: MapStore | null = null;
  #active = false;
  #press: Press | null = null;
  #hover: string | null = null;
  #links: LocalLink[] | null = null;
  #boxes: WorldLevelBox[] = [];
  #destroyed = false;
  /** Bumped by every finished load (frame-all waits for the first batch). */
  loadVersion = 0;

  constructor(host: WorldViewHost) {
    this.#host = host;
    this.root.visible = false;
    this.root.addChild(this.#under, this.#sprites, this.#over, this.#labels);
  }

  get active(): boolean {
    return this.#active;
  }

  /** True while any level document is being loaded. */
  get loading(): boolean {
    return this.#cache.loading;
  }

  /** True while a level is pressed / dragged. */
  get busy(): boolean {
    return this.#press !== null;
  }

  enter(): void {
    this.#active = true;
    this.root.visible = true;
    this.#links = null;
    this.#hover = null;
    this.#watchStore();
    this.#host.requestRender();
  }

  exit(): void {
    this.cancel();
    this.#active = false;
    this.root.visible = false;
    this.#pendingMoves.clear();
    this.#unsubStore?.();
    this.#unsubStore = null;
    this.#store = null;
  }

  setSource(source: WorldDataSource | null): void {
    if (source === this.#source) return;
    this.#unsubSource?.();
    this.#unsubSource = null;
    this.#source = source;
    this.#cache.clear();
    this.#links = null;
    if (source) this.#unsubSource = source.onChange((c) => this.#sourceChanged(c));
    this.#host.requestRender();
  }

  /** The project's level list (data source, else the fallback). */
  levels(): readonly ProjectLevel[] {
    const list = this.#source?.levels() ?? this.#host.fallbackLevels();
    if (list.length > 0) return list;
    const store = this.#host.activeStore();
    if (!store) return [];
    const id = this.#host.activeLevelId() ?? "";
    return [{ id, name: "", path: "", world: { x: 0, y: 0 } }];
  }

  /** The level list changed outside a source notification (e.g. the project library). */
  listChanged(): void {
    this.#pendingMoves.clear();
    this.#links = null;
    if (this.#active) this.#host.requestRender();
  }

  /** A tileset image (re)arrived: thumbnails that use it are redrawn. */
  imageChanged(tilesetId: string): void {
    const snapshots: string[] = [];
    for (const level of this.levels()) {
      const t = this.#cache.get(level.id);
      if (!t) continue;
      if (t.thumb) t.thumb.imageChanged(tilesetId);
      else snapshots.push(level.id);
    }
    if (snapshots.length > 0) this.#cache.invalidate(snapshots);
    if (this.#active) this.#host.requestRender();
  }

  /**
   * The active level is about to change: keep its live picture as the
   * level's thumbnail (scaled down), so the world view does not reload it.
   */
  snapshotActive(levelId: string, store: MapStore, live: HTMLCanvasElement, complete: boolean): void {
    if (this.#destroyed || live.width <= 0 || live.height <= 0) return;
    const scale = Math.min(1, WORLD_THUMB_MAX_PX / Math.max(live.width, live.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(live.width * scale));
    canvas.height = Math.max(1, Math.round(live.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(live, 0, 0, canvas.width, canvas.height);
    const map = store.document.map;
    this.#sizes.set(levelId, { width: map.width * map.tileWidth, height: map.height * map.tileHeight });
    this.#cache.set(levelId, { doc: store.document, thumb: null, canvas, texture: null, sizeVersion: 0 });
    if (!complete) this.#cache.invalidate([levelId]);
    this.#links = null;
  }

  /** The active level's store changed (another level opened). */
  activeChanged(): void {
    this.#links = null;
    if (this.#active) this.#watchStore();
  }

  /** World rectangle of all levels (for frame-all), or null. */
  bounds(): Rect | null {
    return worldBounds(this.#computeBoxes());
  }

  /** Level boxes as last drawn (world px), in draw order. */
  get boxes(): readonly WorldLevelBox[] {
    return this.#boxes;
  }

  destroy(): void {
    this.#destroyed = true;
    this.exit();
    this.#unsubSource?.();
    this.#unsubSource = null;
    this.#cache.clear();
    this.root.destroy({ children: true });
    this.#spritePool.clear();
    this.#labelPool.clear();
  }

  // ------------------------------------------------------------------ input

  /** Left press at canvas point `p`. Returns false when no level is there (the caller pans). */
  pointerDown(e: PointerEvent, p: Point): boolean {
    if (this.#press || e.button !== 0) return this.#press !== null;
    const cam = this.#host.camera;
    const w = screenToWorld(cam.camera, p.x, p.y, cam.resolution);
    const hit = hitTestLevels(this.#computeBoxes(), w, LABEL_STRIP_PX / cam.camera.zoom);
    if (!hit) return false;
    const origin = { x: hit.x, y: hit.y };
    this.#press = { pointerId: e.pointerId, levelId: hit.id, downScreen: p, downWorld: w, origin, dragging: false, position: origin, alt: e.altKey };
    this.#host.capture(e.pointerId);
    this.#host.requestRender();
    return true;
  }

  pointerMove(e: PointerEvent, p: Point): void {
    const press = this.#press;
    if (!press || e.pointerId !== press.pointerId) return;
    press.alt = e.altKey;
    if (!press.dragging && !exceedsDragThreshold(press.downScreen, p)) return;
    press.dragging = true;
    this.#dragTo(p);
  }

  pointerUp(e: PointerEvent, p: Point): void {
    const press = this.#press;
    if (!press || e.pointerId !== press.pointerId) return;
    this.#press = null;
    this.#host.release(e.pointerId);
    if (!press.dragging) {
      this.#host.openLevel(press.levelId);
    } else {
      press.alt = e.altKey;
      this.#dragTo(p, press);
      const { x, y } = press.position;
      if (x !== press.origin.x || y !== press.origin.y) {
        // Shown at the drop position until the level list reports it (the UI applies it).
        this.#pendingMoves.set(press.levelId, { x, y });
        if (!this.#host.levelMoved({ levelId: press.levelId, x, y })) this.#pendingMoves.delete(press.levelId);
      }
    }
    this.#host.requestRender();
  }

  /** Alt pressed / released during a drag: re-snap at the current pointer. */
  altChanged(alt: boolean): void {
    const press = this.#press;
    if (!press?.dragging || press.alt === alt) return;
    press.alt = alt;
    const p = this.#host.pointer();
    if (p) this.#dragTo(p);
  }

  /** Cancels a press / drag (Esc, right button, lost capture): the level goes back. */
  cancel(): void {
    const press = this.#press;
    if (!press) return;
    this.#press = null;
    this.#host.release(press.pointerId);
    this.#host.requestRender();
  }

  /** CSS cursor for the world view (null = default). */
  cursor(): string | null {
    if (this.#press?.dragging) return "grabbing";
    if (this.#press || this.#hover) return "pointer";
    return null;
  }

  #dragTo(p: Point, press = this.#press): void {
    if (!press) return;
    const cam = this.#host.camera;
    const w = screenToWorld(cam.camera, p.x, p.y, cam.resolution);
    const map = this.#host.activeStore()?.document.map;
    const snapX = map?.tileWidth ?? 32;
    const snapY = map?.tileHeight ?? 32;
    press.position = dragLevelPosition(press.origin, press.downWorld, w, snapX, snapY, !press.alt);
    this.#host.requestRender();
  }

  // ------------------------------------------------------------------ data

  #sourceChanged(change: WorldSourceChange): void {
    this.#pendingMoves.clear();
    this.#links = null;
    if (change.levels === "all") this.#cache.invalidate("all");
    else if (change.levels) this.#cache.invalidate(change.levels);
    if (this.#active) this.#host.requestRender();
  }

  #watchStore(): void {
    const store = this.#host.activeStore();
    if (store === this.#store) return;
    this.#unsubStore?.();
    this.#unsubStore = null;
    this.#store = store;
    if (store) {
      this.#unsubStore = store.subscribe((e) => {
        if (e.structure.some((s) => s === "entities" || s === "layers" || s === "map")) {
          this.#links = null;
          this.#host.requestRender();
        }
      });
    }
  }

  /**
   * Starts loads of levels whose thumbnail is missing or stale and redraws
   * pending thumbnail chunks within the frame budget. Returns true while
   * more work is left (the caller schedules another frame).
   */
  update(): boolean {
    if (!this.#active) return false;
    const levels = this.levels();
    const ids = new Set(levels.map((l) => l.id));
    this.#cache.retain(ids);
    this.prune(ids);
    for (const id of [...this.#sizes.keys()]) if (!ids.has(id)) this.#sizes.delete(id);
    const source = this.#source;
    if (source) {
      for (const id of this.#cache.needsLoad(ids, this.#host.activeLevelId())) this.#load(source, id);
    }
    const t0 = performance.now();
    let more = false;
    const activeId = this.#host.activeLevelId();
    for (const level of levels) {
      if (level.id === activeId) continue;
      const t = this.#cache.get(level.id);
      if (!t) continue;
      if (t.thumb?.pending) {
        if (performance.now() - t0 > THUMB_BUDGET_MS) {
          more = true;
          continue;
        }
        t.thumb.update(THUMB_BUDGET_MS);
        this.#upload(t);
        if (t.thumb.pending) more = true;
      } else if (!t.texture) {
        this.#upload(t);
      }
    }
    return more;
  }

  #load(source: WorldDataSource, id: string): void {
    const token = this.#cache.begin(id);
    let promise: Promise<MapDocument>;
    try {
      promise = source.loadThumbnailDoc(id);
    } catch (error) {
      promise = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    promise.then(
      (doc) => {
        if (this.#destroyed || this.#source !== source) return;
        let thumb: MapThumbnail;
        try {
          thumb = new MapThumbnail(new MapStore(doc), this.#host.images, () => this.#host.requestRender(), WORLD_THUMB_MAX_PX);
        } catch (error) {
          console.error(`[canvas] world view: cannot draw level "${id}"`, error);
          this.#cache.fail(id, token);
          return;
        }
        const value: LevelThumb = { doc, thumb, canvas: thumb.canvas, texture: null, sizeVersion: -1 };
        if (!this.#cache.complete(id, token, value)) return;
        const map = doc.map;
        this.#sizes.set(id, { width: map.width * map.tileWidth, height: map.height * map.tileHeight });
        this.#links = null;
        this.loadVersion++;
        this.#host.requestRender();
      },
      (error: unknown) => {
        if (this.#destroyed) return;
        console.error(`[canvas] world view: cannot load level "${id}"`, error);
        if (this.#cache.fail(id, token)) {
          this.loadVersion++;
          this.#host.requestRender();
        }
      },
    );
  }

  #disposeThumb(t: LevelThumb): void {
    t.thumb?.destroy();
    this.#destroyTexture(t.texture);
    t.texture = null;
    t.canvas.width = 0;
    t.canvas.height = 0;
  }

  /** Unbinds a texture from the sprites and retires it (destroyed after the next render). */
  #destroyTexture(texture: Texture | null): void {
    if (!texture) return;
    this.unbind(texture);
    this.#host.retire(texture);
  }

  /** Detaches `texture` from every level sprite (it is about to be destroyed). */
  unbind(texture: Texture): void {
    for (const sprite of this.#spritePool.values()) if (sprite.texture === texture) sprite.texture = Texture.EMPTY;
  }

  /** Uploads a level's picture to its texture (created on first use / resize). */
  #upload(t: LevelThumb): void {
    const sizeVersion = t.thumb?.sizeVersion ?? 0;
    if (!t.texture || t.sizeVersion !== sizeVersion) {
      this.#destroyTexture(t.texture);
      t.texture = new Texture({
        source: new CanvasSource({ resource: t.canvas, scaleMode: "linear", autoGenerateMipmaps: true, antialias: false }),
      });
      t.sizeVersion = sizeVersion;
    } else {
      t.texture.source.update();
    }
  }

  #sizeOf(id: string, activeId: string | null): { width: number; height: number } {
    if (id === activeId) {
      const map = this.#host.activeStore()?.document.map;
      if (map) return { width: map.width * map.tileWidth, height: map.height * map.tileHeight };
    }
    const doc = this.#cache.get(id)?.doc;
    if (doc) return { width: doc.map.width * doc.map.tileWidth, height: doc.map.height * doc.map.tileHeight };
    const known = this.#sizes.get(id);
    if (known) return known;
    const map = this.#host.activeStore()?.document.map;
    return map ? { width: map.width * map.tileWidth, height: map.height * map.tileHeight } : PLACEHOLDER_SIZE;
  }

  /** Level boxes in draw order (the dragged level last, on top). */
  #computeBoxes(): WorldLevelBox[] {
    const activeId = this.#host.activeLevelId();
    const press = this.#press;
    const out: WorldLevelBox[] = [];
    let dragged: WorldLevelBox | null = null;
    for (const level of this.levels()) {
      let pos: Point = level.world;
      const pending = this.#pendingMoves.get(level.id);
      if (pending) {
        if (pending.x === level.world.x && pending.y === level.world.y) this.#pendingMoves.delete(level.id);
        else pos = pending;
      }
      if (press?.dragging && press.levelId === level.id) pos = press.position;
      const size = this.#sizeOf(level.id, activeId);
      const box = { id: level.id, x: pos.x, y: pos.y, width: size.width, height: size.height };
      if (press?.dragging && press.levelId === level.id) dragged = box;
      else out.push(box);
    }
    if (dragged) out.push(dragged);
    return out;
  }

  #localLinks(levels: readonly ProjectLevel[]): LocalLink[] {
    if (this.#links) return this.#links;
    const docs = new Map<string, MapDocument>();
    const activeId = this.#host.activeLevelId();
    const store = this.#host.activeStore();
    for (const level of levels) {
      if (level.id === activeId && store) docs.set(level.id, store.document);
      else {
        const doc = this.#cache.get(level.id)?.doc;
        if (doc) docs.set(level.id, doc);
      }
    }
    const out: LocalLink[] = [];
    for (const link of worldLinks({ name: "", levels, tilesets: [] }, docs)) {
      const doc = docs.get(link.fromLevelId);
      const entity = doc?.findEntity(link.fromEntityId)?.entity;
      if (!doc || !entity) continue;
      const b = entityBox(entity, doc.map);
      out.push({
        fromLevelId: link.fromLevelId,
        from: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
        toLevelId: link.toLevelId,
        to: link.toPoint ? { x: link.toPoint.x, y: link.toPoint.y } : null,
      });
    }
    this.#links = out;
    return out;
  }

  // ------------------------------------------------------------------ drawing

  /** Lays the world view out for the current camera. */
  draw(): void {
    const under = this.#under;
    const over = this.#over;
    under.clear();
    over.clear();
    for (const t of this.#labels.children) t.visible = false;
    for (const s of this.#sprites.children) s.visible = false;
    if (!this.#active) return;

    const host = this.#host;
    const cam = host.camera;
    const colors = host.colors;
    const res = cam.resolution;
    const px = 1 / res;
    const k = cam.lineWidth();
    const zoom = cam.camera.zoom;
    const off = snappedOffset(cam.camera, res);
    const ox = Math.round(off.x * res);
    const oy = Math.round(off.y * res);
    const z = zoom * res;
    const vw = cam.viewW * res;
    const vh = cam.viewH * res;

    const levels = this.levels();
    const boxes = this.#computeBoxes();
    this.#boxes = boxes;
    const activeId = host.activeLevelId();
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const names = new Map(levels.map((l) => [l.id, l.name]));

    // Hover (not while panning or pressing).
    const p = host.pointer();
    this.#hover = null;
    if (p && !this.#press && !host.panning()) {
      const w = screenToWorld(cam.camera, p.x, p.y, res);
      this.#hover = hitTestLevels(boxes, w, LABEL_STRIP_PX / zoom)?.id ?? null;
    }

    // Background grid (the snap grid, coarsened when zoomed out).
    const map = host.activeStore()?.document.map;
    const step = gridSpacing(map?.tileWidth ?? 32, zoom, 24);
    const stepY = step * ((map?.tileHeight ?? 32) / (map?.tileWidth ?? 32));
    const x0w = (0 - off.x) / zoom;
    const y0w = (0 - off.y) / zoom;
    const x1w = (cam.viewW - off.x) / zoom;
    const y1w = (cam.viewH - off.y) / zoom;
    for (let gx = Math.floor(x0w / step) * step; gx <= x1w; gx += step) {
      const sx = Math.round(ox + gx * z);
      under.rect(sx * px, 0, k * px, vh * px);
    }
    for (let gy = Math.floor(y0w / stepY) * stepY; gy <= y1w; gy += stepY) {
      const sy = Math.round(oy + gy * z);
      under.rect(0, sy * px, vw * px, k * px);
    }
    under.fill({ color: CANVAS_COLORS.grid, alpha: 0.035 });

    // Sprites live in world space.
    this.#sprites.position.set(off.x, off.y);
    this.#sprites.scale.set(zoom);

    type Placed = { box: WorldLevelBox; x0: number; y0: number; x1: number; y1: number };
    const placed: Placed[] = [];
    for (const box of boxes) {
      const x0 = Math.round(ox + box.x * z);
      const y0 = Math.round(oy + box.y * z);
      const x1 = Math.max(x0 + k, Math.round(ox + (box.x + box.width) * z));
      const y1 = Math.max(y0 + k, Math.round(oy + (box.y + box.height) * z));
      placed.push({ box, x0, y0, x1, y1 });
      const onScreen = !(x1 < 0 || y1 < -LABEL_STRIP_PX * res || x0 > vw || y0 > vh);
      // Level area (shows empty maps and levels still loading).
      if (onScreen) under.rect(x0 * px, y0 * px, (x1 - x0) * px, (y1 - y0) * px).fill(colors.mapBackground);
      const texture = box.id === activeId ? (host.activeTexture() ?? this.#cache.get(box.id)?.texture ?? null) : (this.#cache.get(box.id)?.texture ?? null);
      const sprite = this.#sprite(box.id);
      if (!texture || !onScreen) continue;
      if (sprite.texture !== texture) sprite.texture = texture;
      sprite.visible = true;
      sprite.position.set(box.x, box.y);
      sprite.width = box.width;
      sprite.height = box.height;
      sprite.alpha = this.#press?.dragging && this.#press.levelId === box.id ? 0.85 : 1;
      // Draw order follows the box order (dragged level on top).
      this.#sprites.addChild(sprite);
    }

    // Frames.
    const pressId = this.#press?.levelId ?? null;
    for (const q of placed) {
      const id = q.box.id;
      const failed = id !== activeId && this.#cache.status(id) === "failed";
      // Plain frames go under the pictures (an overlapping level covers them);
      // the active / dragged / hovered highlight stays on top.
      if (id === activeId || (pressId === id && this.#press?.dragging)) {
        frame(over, q.x0 - 2 * k, q.y0 - 2 * k, q.x1 + 2 * k, q.y1 + 2 * k, 2 * k, px);
        over.fill(colors.accent);
      } else if (failed) {
        frame(over, q.x0 - k, q.y0 - k, q.x1 + k, q.y1 + k, k, px);
        over.fill(colors.danger);
      } else {
        frame(under, q.x0 - k, q.y0 - k, q.x1 + k, q.y1 + k, k, px);
        under.fill({ color: colors.mapBorder, alpha: 1 });
      }
      if (id === this.#hover && id !== activeId) {
        frame(over, q.x0 - 2 * k, q.y0 - 2 * k, q.x1 + 2 * k, q.y1 + 2 * k, k, px);
        over.fill({ color: 0xffffff, alpha: 0.7 });
      }
    }

    // Portal links (a dark halo under the accent line keeps them readable on any picture).
    const lineW = 1.5 * k;
    for (const link of this.#localLinks(levels)) {
      const ends = linkEndpoints(link, byId);
      if (!ends) continue;
      const a = { x: (ox + ends.from.x * z) * px, y: (oy + ends.from.y * z) * px };
      const b = { x: (ox + ends.to.x * z) * px, y: (oy + ends.to.y * z) * px };
      const head = arrowHead(a, b, 10 * k * px, 5 * k * px);
      if (!head) continue;
      const [, l, r] = head;
      const base = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
      over.moveTo(a.x, a.y).lineTo(base.x, base.y).stroke({ color: 0x000000, width: (lineW + 2 * k) * px, alpha: 0.35, cap: "round" });
      over.moveTo(a.x, a.y).lineTo(base.x, base.y).stroke({ color: colors.accent, width: lineW * px, alpha: 0.85, cap: "round" });
      over.circle(a.x, a.y, 3 * k * px).fill({ color: 0x000000, alpha: 0.35 });
      over.circle(a.x, a.y, 2.25 * k * px).fill({ color: colors.accent, alpha: 0.95 });
      over.poly([head[0].x, head[0].y, l.x, l.y, r.x, r.y]).fill({ color: colors.accent, alpha: 0.95 });
    }

    // Labels above the boxes, cut to the box width.
    for (const q of placed) {
      if (q.x1 < 0 || q.x0 > vw || q.y1 < 0 || q.y0 - LABEL_STRIP_PX * res > vh) continue;
      const name = names.get(q.box.id) ?? "";
      if (!name) continue;
      const maxW = Math.max(0, (q.x1 - q.x0) * px);
      const item = this.#label(q.box.id);
      const key = `${name}\u0000${Math.floor(maxW / 4)}`;
      if (item.key !== key) {
        item.key = key;
        item.text.text = ellipsize(name, Math.max(0, Math.floor(maxW / 4) * 4), (s) => CanvasTextMetrics.measureText(s, LABEL_STYLE).width);
      }
      if (!item.text.text) continue;
      if (item.text.resolution !== res) item.text.resolution = res;
      const isActive = q.box.id === activeId;
      item.text.tint = isActive ? colors.accent : q.box.id === this.#hover ? 0xffffff : 0xb4b4bc;
      item.text.visible = true;
      item.text.position.set(q.x0 * px, (q.y0 - (isActive ? 3 : 2) * k) * px - 3);
    }
  }

  #sprite(id: string): Sprite {
    let s = this.#spritePool.get(id);
    if (!s) {
      s = new Sprite();
      s.visible = false;
      this.#spritePool.set(id, s);
      this.#sprites.addChild(s);
    }
    return s;
  }

  #label(id: string): LabelItem {
    let item = this.#labelPool.get(id);
    if (!item) {
      const text = new Text({ text: "", style: LABEL_STYLE, resolution: this.#host.camera.resolution });
      text.anchor.set(0, 1);
      item = { text, key: "" };
      this.#labelPool.set(id, item);
      this.#labels.addChild(text);
    }
    return item;
  }

  /** Drops pooled sprites / labels of levels that are gone. */
  prune(ids: ReadonlySet<string>): void {
    for (const [id, s] of this.#spritePool) {
      if (ids.has(id)) continue;
      s.destroy();
      this.#spritePool.delete(id);
    }
    for (const [id, item] of this.#labelPool) {
      if (ids.has(id)) continue;
      item.text.destroy();
      this.#labelPool.delete(id);
    }
  }
}

/** `k`-device-px frame just inside x0..x1, y0..y1 (`px` converts to stage units). */
function frame(g: Graphics, x0: number, y0: number, x1: number, y1: number, k: number, px: number): void {
  const w = x1 - x0;
  const h = y1 - y0;
  g.rect(x0 * px, y0 * px, w * px, k * px)
    .rect(x0 * px, (y1 - k) * px, w * px, k * px)
    .rect(x0 * px, (y0 + k) * px, k * px, (h - 2 * k) * px)
    .rect((x1 - k) * px, (y0 + k) * px, k * px, (h - 2 * k) * px);
}
