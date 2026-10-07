/**
 * Everything drawn over the map layers: grid lines, map border, selection
 * region, collision outline, tool previews (brush tile, stamp, rectangle,
 * fill highlight, grid-layer footprint) and cell cursors. Screen-space
 * lines are whole device pixels; previews live in world space.
 */
import {
  EMPTY_CELL,
  cellFlags,
  cellPaletteIndex,
  floodFill,
  isGridLayer,
  makeCell,
  type CellPoint,
  type TileClip,
  type TileLayer,
} from "@smap/core";
import { AlphaFilter, Container, Graphics, Sprite, Texture } from "pixi.js";

import { useEditorStore, type CellRegion } from "../state/editorStore";
import type { CameraController } from "./cameraController";
import { cellMaskImage, membershipMask, type CellMaskImage } from "./cellMask";
import type { CellQuad } from "./chunkGeometry";
import { CANVAS_COLORS, type CanvasColors } from "./colors";
import { gridLayout } from "./grid";
import { gridPaintValue } from "./gridPaint";
import { isSolidCode, solidEdges } from "./gridRaster";
import type { GridOverlays } from "./gridOverlays";
import { activeInfo, activeLayer, clipId, mappingFor } from "./layerAccess";
import type { MapScene } from "./mapScene";
import { MaskPreview, TilePreview } from "./preview";
import type { Gesture } from "./toolController";
import {
  dragRegion,
  isEditable,
  isGridEditable,
  patternCell,
  patternLayerIndex,
  rectPreviewCells,
  snapToStampGrid,
  stampPreviewCells,
  type PreviewCell,
} from "./tools";

/** Most cells a rectangle preview draws as tiles (beyond that: outline only). */
const RECT_PREVIEW_LIMIT = 20_000;
/** Fill hover preview: minimum time between two flood fills, and the largest map it runs on. */
const FILL_PREVIEW_THROTTLE_MS = 40;
const FILL_PREVIEW_MAX_AREA = 4_000_000;
/** Collision outlines are drawn only when a cell is at least this many device pixels wide. */
const OUTLINE_MIN_CELL_DEVICE_PX = 6;
/** ...and at most this many cells are on screen. */
const OUTLINE_MAX_CELLS = 40_000;

interface FillCache {
  readonly layer: TileLayer;
  readonly revision: number;
  readonly width: number;
  readonly mask: Uint8Array;
  readonly image: CellMaskImage | null;
}

/** What the renderer reads from the canvas each frame. */
export interface OverlayHost {
  readonly scene: MapScene | null;
  readonly gridOverlays: GridOverlays | null;
  readonly camera: CameraController;
  readonly colors: CanvasColors;
  /** Cells on screen. */
  readonly visible: CellRegion;
  readonly gesture: Gesture | null;
  /** Collision overlay shown this frame. */
  readonly showCollision: boolean;
  /** Hovered map cell for cursors, or null while panning / off the map. */
  cursorCell(): CellPoint | null;
  /** Cell under the pointer, also outside the map. */
  pointerCell(): CellPoint | null;
  requestRender(): void;
}

export class OverlayRenderer {
  /** Screen-space: grid lines, drawn opaque; the filter applies the fade as one layer so crossings are not brighter. */
  readonly grid = new Graphics();
  /** Screen-space: border, region, outlines, cursors. */
  readonly overlay = new Graphics();
  /** World-space previews, above the layers. */
  readonly previews = new Container();
  readonly #gridFilter = new AlphaFilter({ alpha: 1, resolution: "inherit" });
  readonly #preview = new Sprite();
  readonly #tilePreview = new TilePreview(CANVAS_COLORS.previewAlpha);
  readonly #fillPreview = new MaskPreview(CANVAS_COLORS.accent, CANVAS_COLORS.fillPreviewAlpha);
  #fillCache: FillCache | null = null;
  #lastFillAt = -Infinity;
  #fillTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #host: OverlayHost;

  constructor(host: OverlayHost) {
    this.#host = host;
    this.#preview.alpha = CANVAS_COLORS.previewAlpha;
    this.#preview.visible = false;
    this.grid.filters = [this.#gridFilter];
    this.previews.addChild(this.#fillPreview.sprite, this.#tilePreview.root, this.#preview);
  }

  /** Applies theme colours read at mount. */
  setColors(colors: CanvasColors): void {
    this.#fillPreview.sprite.tint = colors.accent;
  }

  /** Forgets cached previews (project changed). */
  reset(): void {
    this.#fillCache = null;
    this.#fillPreview.set(null, 1, 1);
    this.#tilePreview.invalidate();
    this.#preview.texture = Texture.EMPTY;
  }

  destroy(): void {
    if (this.#fillTimer !== null) clearTimeout(this.#fillTimer);
    this.#tilePreview.destroy();
    this.#fillPreview.destroy();
  }

  /** Redraws all overlays for the current state. */
  draw(): void {
    const host = this.#host;
    const g = this.overlay;
    g.clear();
    this.grid.clear();
    this.grid.visible = false;
    const map = host.scene?.store.document.map;
    this.#preview.visible = false;
    this.#tilePreview.root.visible = false;
    this.#fillPreview.sprite.visible = false;
    if (!map) return;
    const cam = host.camera;
    const res = cam.resolution;
    const px = 1 / res;
    const state = useEditorStore.getState();
    const grid = gridLayout(cam.camera, res, cam.viewW, cam.viewH, map.tileWidth, map.tileHeight, map.width, map.height);

    if (state.gridVisible && grid.alpha > 0) {
      const h = (grid.bottom - grid.top) * px;
      const w = (grid.right - grid.left) * px;
      const gg = this.grid;
      for (const x of grid.xs) gg.rect(x * px, grid.top * px, px, h);
      for (const y of grid.ys) gg.rect(grid.left * px, y * px, w, px);
      if (grid.xs.length + grid.ys.length > 0) {
        gg.fill(CANVAS_COLORS.grid);
        this.#gridFilter.alpha = CANVAS_COLORS.gridAlpha * grid.alpha;
        gg.visible = true;
      }
    }

    // Map border: 1 device px just outside the map.
    const b = cam.cellBox({ x: 0, y: 0, width: map.width, height: map.height });
    rectOutline(g, b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1, 1, px);
    g.fill(host.colors.mapBorder);

    if (host.showCollision) this.#drawCollisionOutline();

    const gesture = host.gesture;
    if (state.region && gesture?.kind !== "select") this.#drawRegion(state.region);
    const gridActive = isGridLayer(activeLayer(host.scene?.store));

    switch (gesture?.kind) {
      case "select": {
        const r = dragRegion(gesture.start, gesture.end, map);
        if (r) this.#drawRegion(r);
        return;
      }
      case "rect": {
        const r = dragRegion(gesture.start, gesture.end, map);
        if (r) {
          if (gridActive) this.#drawGridFootprint(r);
          else {
            this.#showPatternPreview(r, gesture.start);
            this.#drawAccentOutline(r);
          }
        }
        return;
      }
      case "pick": {
        const r = dragRegion(gesture.start, gesture.end, map);
        if (r) this.#drawDashed(r);
        return;
      }
      case "stamp": {
        const at = host.pointerCell() ?? gesture.last ?? gesture.start;
        this.#showStampPreview(gesture.clip, gesture.mapping, snapToStampGrid(gesture.start, at, gesture.clip.width, gesture.clip.height));
        return;
      }
      default:
        break;
    }

    const cell = host.cursorCell();
    if (!cell) return;
    const one = { x: cell.x, y: cell.y, width: 1, height: 1 };
    if (gridActive) return this.#drawGridCursor(state.tool, cell, one);
    const editable = isEditable(activeInfo(host.scene?.store));
    switch (state.tool) {
      case "brush": {
        if (state.stamp) {
          const mapping = mappingFor(host.scene?.store, state.stamp);
          if (Object.keys(mapping).length > 0) this.#showStampPreview(state.stamp, mapping, cell);
          else this.#drawCellCursor(one);
          return;
        }
        if (!editable) return this.#drawCellCursor(one);
        const sel = state.selection;
        const tex = sel ? host.scene?.atlas(sel.tilesetId)?.tileTexture(sel.tileId) : undefined;
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

  // ------------------------------------------------------------------ grid layers

  /** Cursor / preview when the active layer is a grid layer. */
  #drawGridCursor(tool: string, cell: CellPoint, one: CellRegion): void {
    const s = useEditorStore.getState();
    const store = this.#host.scene?.store;
    const layer = activeLayer(store);
    if (!isGridLayer(layer) || !isGridEditable(activeInfo(store))) return this.#drawCellCursor(one);
    const value = gridPaintValue(s.tool, s.gridValue, layer.maxValue);
    if (value === null) return this.#drawCellCursor(one);
    switch (tool) {
      case "brush":
      case "rect":
        return this.#drawGridFootprint(one);
      case "fill":
        this.#showFillPreview(cell, value);
        return this.#drawCellCursor(one);
      default:
        return this.#drawCellCursor(one);
    }
  }

  /** Accent cell highlight: what a grid brush / rectangle will paint. */
  #drawGridFootprint(r: CellRegion): void {
    const g = this.overlay;
    const px = 1 / this.#host.camera.resolution;
    const b = this.#host.camera.cellBox(r);
    g.rect(b.x0 * px, b.y0 * px, (b.x1 - b.x0) * px, (b.y1 - b.y0) * px).fill({
      color: this.#host.colors.accent,
      alpha: CANVAS_COLORS.gridBrushAlpha,
    });
    this.#drawAccentOutline(r);
  }

  /** Crisp outline of the solid areas of the collision overlay (visible cells only). */
  #drawCollisionOutline(): void {
    const host = this.#host;
    const overlays = host.gridOverlays;
    const map = host.scene?.store.document.map;
    if (!overlays || !map) return;
    const cam = host.camera;
    const v = host.visible;
    if (v.width <= 0 || v.height <= 0 || v.width * v.height > OUTLINE_MAX_CELLS) return;
    if (map.tileWidth * cam.camera.zoom * cam.resolution < OUTLINE_MIN_CELL_DEVICE_PX) return;
    const edges = solidEdges(v.x, v.y, v.x + v.width, v.y + v.height, (x, y) => isSolidCode(overlays.collisionCode(x, y)));
    if (edges.length === 0) return;
    const g = this.overlay;
    const px = 1 / cam.resolution;
    const k = cam.lineWidth();
    for (const e of edges) {
      if (e.horizontal) {
        const a = cam.cellBox({ x: e.from, y: e.line, width: e.to - e.from, height: 0 });
        const y = e.inside === "after" ? a.y0 : a.y0 - k;
        g.rect(a.x0 * px, y * px, (a.x1 - a.x0) * px, k * px);
      } else {
        const a = cam.cellBox({ x: e.line, y: e.from, width: 0, height: e.to - e.from });
        const x = e.inside === "after" ? a.x0 : a.x0 - k;
        g.rect(x * px, a.y0 * px, k * px, (a.y1 - a.y0) * px);
      }
    }
    g.fill({ color: host.colors.collisionSolid, alpha: CANVAS_COLORS.collisionLineAlpha });
  }

  // ------------------------------------------------------------------ primitives

  /** Accent outline with a dark halo just outside (rectangle drag, grid footprint). */
  #drawAccentOutline(r: CellRegion): void {
    const g = this.overlay;
    const px = 1 / this.#host.camera.resolution;
    const box = this.#host.camera.cellBox(r);
    const k = this.#host.camera.lineWidth();
    rectOutline(g, box.x0 - k, box.y0 - k, box.x1 + k, box.y1 + k, k, px);
    g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.45 });
    rectOutline(g, box.x0, box.y0, box.x1, box.y1, k, px);
    g.fill(this.#host.colors.accent);
  }

  /** Region / marquee: subtle accent fill plus a crisp accent outline. */
  #drawRegion(r: CellRegion): void {
    const g = this.overlay;
    const px = 1 / this.#host.camera.resolution;
    const b = this.#host.camera.cellBox(r);
    g.rect(b.x0 * px, b.y0 * px, (b.x1 - b.x0) * px, (b.y1 - b.y0) * px).fill({
      color: this.#host.colors.accent,
      alpha: CANVAS_COLORS.regionFillAlpha,
    });
    // Dark halo just outside keeps the accent line readable on any tile.
    this.#drawAccentOutline(r);
  }

  /** Pick area: static black line with white dashes. */
  #drawDashed(r: CellRegion): void {
    const g = this.overlay;
    const px = 1 / this.#host.camera.resolution;
    const k = this.#host.camera.lineWidth();
    const b = this.#host.camera.cellBox(r);
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
    const g = this.overlay;
    const px = 1 / this.#host.camera.resolution;
    const k = this.#host.camera.lineWidth();
    const { x0, y0, x1, y1 } = this.#host.camera.cellBox(r);
    rectOutline(g, x0 - k, y0 - k, x1 + k, y1 + k, k, px);
    g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.6 });
    rectOutline(g, x0, y0, x1, y1, k, px);
    g.fill({ color: CANVAS_COLORS.cursor, alpha: 0.9 });
  }

  // ------------------------------------------------------------------ tile previews

  /** Builds `cells` into the tile preview unless its key is unchanged. */
  #setTilePreview(key: string, cells: readonly PreviewCell[]): void {
    const scene = this.#host.scene;
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
    const map = this.#host.scene!.store.document.map;
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
    const v = this.#host.visible;
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
      const li = patternLayerIndex(clip, mappingFor(this.#host.scene?.store, clip), s.activeLayerId);
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

  /**
   * Highlights the region a click would fill (throttled, cached while inside
   * the same region). `gridValue` is the value a grid-layer fill writes
   * (undefined on tile layers).
   */
  #showFillPreview(cell: CellPoint, gridValue?: number): void {
    const host = this.#host;
    const scene = host.scene;
    const s = useEditorStore.getState();
    const layer = activeLayer(scene?.store);
    if (!scene || !layer) return;
    if (gridValue === undefined && !s.stamp && !s.selection) return;
    const map = scene.store.document.map;
    if (map.width * map.height > FILL_PREVIEW_MAX_AREA) return;
    // Filling cells that already hold the value changes nothing.
    if (gridValue !== undefined) {
      if (layer.getCell(cell.x, cell.y) === gridValue) return;
    } else if (!s.stamp && s.selection) {
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
          host.requestRender();
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
}

/** Adds a `k`-device-px rectangle outline (inside x0..x1, y0..y1) to `g` as four rects. */
export function rectOutline(g: Graphics, x0: number, y0: number, x1: number, y1: number, k: number, px: number): void {
  const w = x1 - x0;
  const h = y1 - y0;
  g.rect(x0 * px, y0 * px, w * px, k * px)
    .rect(x0 * px, (y1 - k) * px, w * px, k * px)
    .rect(x0 * px, (y0 + k) * px, k * px, (h - 2 * k) * px)
    .rect((x1 - k) * px, (y0 + k) * px, k * px, (h - 2 * k) * px);
}
