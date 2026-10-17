/**
 * Everything drawn over the map layers: grid lines, map border, selection
 * region, collision outline, tool previews (brush tile, stamp, rectangle,
 * fill highlight, grid-layer footprint) and cell cursors. Screen-space
 * lines are whole device pixels; previews live in world space.
 *
 * Brush / eraser previews show the whole brush footprint (tile ghosts for
 * the brush, an outline for the eraser) and, while Shift is held, the line a
 * Shift + click would paint. A pick flashes its area; a brush size change
 * shows a short size readout next to the pointer.
 */
import {
  COLLISION_PASSABLE,
  EMPTY_CELL,
  cellFlags,
  cellPaletteIndex,
  flipClip,
  floodFill,
  isEntityLayer,
  isGridLayer,
  makeCell,
  terrainErase,
  terrainFill,
  terrainPaint,
  type CellPoint,
  type TerrainBrush,
  type TerrainTileWrite,
  type MapDocument,
  type RandomSet,
  type TileClip,
  type TileLayer,
} from "@smap/core";
import { AlphaFilter, Container, Graphics, Sprite, Text, Texture } from "pixi.js";

import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore, type CellRegion } from "../state/editorStore";
import { strokeCells } from "./brush";
import type { Point } from "./camera";
import type { CameraController } from "./cameraController";
import { cellMaskImage, membershipMask, type CellMaskImage } from "./cellMask";
import type { CellQuad } from "./chunkGeometry";
import { CANVAS_COLORS, type CanvasColors } from "./colors";
import { brushFootprint, cellsBounds, footprintCells } from "./footprint";
import { gridLayout } from "./grid";
import { gridPaintValue } from "./gridPaint";
import { COLL_FORCED_PASSABLE, isSolidCode, solidEdges, type Edge } from "./gridRaster";
import type { GridOverlays } from "./gridOverlays";
import { activeInfo, activeLayer, clipId, mappingFor, savedStamp, savedStampPreviewMapping } from "./layerAccess";
import type { MapScene } from "./mapScene";
import { MaskPreview, TilePreview } from "./preview";
import { activeRandomSet, randomStampOf } from "./randomBrushSource";
import { planRandomPaint, randomPlanKey } from "./randomPaint";
import { activeTerrainBrush, terrainBrushKey } from "./terrainBrushSource";
import { rectGestureRegion, type Gesture } from "./toolController";
import {
  dashSpans,
  dragRegion,
  isEditable,
  movedRegion,
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
/** Most cells a brush footprint / Shift line preview draws. */
const BRUSH_PREVIEW_LIMIT = 20_000;
/** Pick flash duration. */
const FLASH_MS = 450;
/** How long the brush size readout stays after a change. */
const READOUT_MS = 900;
/** How long the "cannot paint here" hint stays next to the pointer. */
const HINT_MS = 1200;
/** Marching ants of the selection: one step per this interval (~8 fps, renders only while a selection exists). */
const ANTS_STEP_MS = 125;
/** Collision outlines are drawn only when a cell is at least this many device pixels wide. */
const OUTLINE_MIN_CELL_DEVICE_PX = 6;
/** ...and at most this many cells are on screen. */
const OUTLINE_MAX_CELLS = 40_000;
/** Reused on the pointer path; the keyline sits immediately outside the colour line. */
const FOOTPRINT_KEYLINE = { color: CANVAS_COLORS.cursorShadow, alpha: 0.6 };

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
  /** Entity under the pointer that the current tool would select / drag, or null. */
  hoverEntityId(): string | null;
  /** Pointer in canvas CSS px, or null when outside. */
  pointer?(): Point | null;
  /** Start of the Shift + click line (Shift held, brush / eraser), or null. */
  lineAnchor?(): CellPoint | null;
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
  /** Grid (terrain / collision) layers of a saved stamp, drawn faintly as their overlays. */
  readonly #stampGridPreview = new Graphics();
  #stampGridKey: string | null = null;
  /** Screen-space brush size readout (shown briefly after `[` / `]`). */
  readonly readout = new Container();
  readonly #readoutBg = new Graphics();
  readonly #readoutText = new Text({
    text: "",
    style: { fontFamily: "Inter Variable, Inter, system-ui, sans-serif", fontSize: 12, fontWeight: "500", fill: CANVAS_COLORS.text },
  });
  readonly #bubbleFill = { color: CANVAS_COLORS.popup, alpha: 0.96 };
  readonly #bubbleBorder = { color: CANVAS_COLORS.lineStrong, width: 1, alignment: 1 };
  #readoutUntil = 0;
  #readoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** Screen-space hint next to the pointer ("Katman kilitli", ...). */
  readonly hint = new Container();
  readonly #hintBg = new Graphics();
  readonly #hintText = new Text({
    text: "",
    style: { fontFamily: "Inter Variable, Inter, system-ui, sans-serif", fontSize: 12, fontWeight: "500", fill: CANVAS_COLORS.text },
  });
  #hintUntil = 0;
  #hintAt: Point | null = null;
  #hintTimer: ReturnType<typeof setTimeout> | null = null;
  #antsTimer: ReturnType<typeof setTimeout> | null = null;
  #flash: { readonly region: CellRegion; readonly start: number } | null = null;
  #fillCache: FillCache | null = null;
  #lastFillAt = -Infinity;
  #fillTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #host: OverlayHost;

  constructor(host: OverlayHost) {
    this.#host = host;
    this.#preview.alpha = CANVAS_COLORS.previewAlpha;
    this.#preview.visible = false;
    this.grid.filters = [this.#gridFilter];
    this.#stampGridPreview.visible = false;
    this.previews.addChild(this.#fillPreview.sprite, this.#tilePreview.root, this.#stampGridPreview, this.#preview);
    this.readout.addChild(this.#readoutBg, this.#readoutText);
    this.readout.visible = false;
    this.hint.addChild(this.#hintBg, this.#hintText);
    this.hint.visible = false;
  }

  /** Shows `text` next to the pointer for {@link HINT_MS} (e.g. why a click did nothing). */
  showHint(text: string): void {
    this.#hintText.text = text;
    this.#hintAt = this.#host.pointer?.() ?? null;
    this.#hintUntil = performance.now() + HINT_MS;
    if (this.#hintTimer !== null) clearTimeout(this.#hintTimer);
    this.#hintTimer = setTimeout(() => {
      this.#hintTimer = null;
      this.#host.requestRender();
    }, HINT_MS + 20);
    this.#host.requestRender();
  }

  /** Shows the brush size readout next to the pointer for a moment. */
  showSizeReadout(): void {
    this.#readoutUntil = performance.now() + READOUT_MS;
    if (this.#readoutTimer !== null) clearTimeout(this.#readoutTimer);
    this.#readoutTimer = setTimeout(() => {
      this.#readoutTimer = null;
      this.#host.requestRender();
    }, READOUT_MS + 20);
    this.#host.requestRender();
  }

  /** Briefly outlines `region` (pick feedback); animates for {@link FLASH_MS}. */
  flash(region: CellRegion): void {
    this.#flash = { region, start: performance.now() };
    this.#host.requestRender();
  }

  /** Applies theme colours read at mount. */
  setColors(colors: CanvasColors): void {
    this.#fillPreview.sprite.tint = colors.accent;
    this.#readoutText.style.fill = colors.text;
    this.#hintText.style.fill = colors.text;
    this.#bubbleFill.color = colors.popup;
    this.#bubbleBorder.color = colors.lineStrong;
  }

  /** Forgets cached previews (project changed). */
  reset(): void {
    this.#fillCache = null;
    this.#fillPreview.set(null, 1, 1);
    this.#tilePreview.invalidate();
    this.#preview.texture = Texture.EMPTY;
    this.#stampGridPreview.clear();
    this.#stampGridKey = null;
  }

  destroy(): void {
    if (this.#fillTimer !== null) clearTimeout(this.#fillTimer);
    if (this.#readoutTimer !== null) clearTimeout(this.#readoutTimer);
    if (this.#hintTimer !== null) clearTimeout(this.#hintTimer);
    if (this.#antsTimer !== null) clearTimeout(this.#antsTimer);
    this.readout.destroy({ children: true });
    this.hint.destroy({ children: true });
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
    this.#stampGridPreview.visible = false;
    this.readout.visible = false;
    this.#drawHint();
    if (!map) return;
    this.#drawReadout();
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
        this.#gridFilter.alpha = grid.alpha;
        gg.visible = true;
      }
    }

    // Map border: 1 device px just outside the map.
    const b = cam.cellBox({ x: 0, y: 0, width: map.width, height: map.height });
    rectOutline(g, b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1, 1, px);
    g.fill(host.colors.mapBorder);

    if (host.showCollision) this.#drawCollisionOutline();

    const gesture = host.gesture;
    if (gesture?.kind === "move") {
      const r = movedRegion(gesture.region, gesture.dx, gesture.dy, map);
      if (r) this.#drawRegion(r);
    } else if (state.region && gesture?.kind !== "select") this.#drawRegion(state.region);
    this.#drawFlash();
    const gridActive = isGridLayer(activeLayer(host.scene?.store));

    switch (gesture?.kind) {
      case "select": {
        const r = dragRegion(gesture.start, gesture.end, map);
        if (r) this.#drawRegion(r);
        return;
      }
      case "rect": {
        const r = rectGestureRegion(gesture, map);
        if (r) {
          if (gridActive) this.#drawGridFootprint(r);
          else if (this.#terrainBrush()) {
            this.#showTerrainRect(r);
            this.#drawAccentOutline(r);
          } else {
            this.#showPatternPreview(r, gesture.start);
            this.#drawAccentOutline(r);
          }
        }
        return;
      }
      case "pick": {
        if (gesture.press === "entityMenu") return;
        const r = dragRegion(gesture.start, gesture.end, map);
        if (r && gesture.press === "eraseRect") this.#drawEraseRect(r);
        else if (r) this.#drawDashed(r);
        return;
      }
      case "move":
        return;
      case "stamp": {
        const at = host.pointerCell() ?? gesture.last ?? gesture.start;
        const mapping = gesture.saved ? savedStampPreviewMapping(host.scene?.store, gesture.clip) : gesture.mapping;
        this.#showStampPreview(gesture.clip, mapping, snapToStampGrid(gesture.start, at, gesture.clip.width, gesture.clip.height));
        return;
      }
      case "paint": {
        // The footprint outline under the pointer while painting.
        const at = host.cursorCell();
        if (at) this.#drawCellsOutline(footprintCells([at], gesture.offsets));
        return;
      }
      case "entity":
        return;
      default:
        break;
    }

    const cell = host.cursorCell();
    if (!cell) return;
    const one = { x: cell.x, y: cell.y, width: 1, height: 1 };
    // A saved stamp maps its own layers: it previews (and places) on any active layer.
    const saved = state.tool === "brush" ? savedStamp(state.stamp) : null;
    if (saved) {
      const mapping = savedStampPreviewMapping(host.scene?.store, saved);
      if (Object.keys(mapping).length > 0) this.#showStampPreview(saved, mapping, cell);
      else this.#drawCellCursor(one);
      return;
    }
    const active = activeLayer(host.scene?.store);
    if (isEntityLayer(active) && (state.tool === "entity" || state.tool === "select")) {
      // Hovering an entity: its own highlight is the cursor.
      if (host.hoverEntityId() === null) this.#drawCellCursor(one);
      return;
    }
    if (gridActive) return this.#drawGridCursor(state.tool, cell, one);
    const editable = isEditable(activeInfo(host.scene?.store));
    const terrain = editable ? this.#terrainBrush() : null;
    if (terrain && (state.tool === "brush" || state.tool === "eraser" || state.tool === "fill" || state.tool === "rect")) {
      return this.#showTerrainPreview(state.tool, cell, terrain);
    }
    switch (state.tool) {
      case "brush": {
        if (state.stamp) {
          const mapping = mappingFor(host.scene?.store, state.stamp);
          if (Object.keys(mapping).length > 0) this.#showStampPreview(state.stamp, mapping, cell);
          else this.#drawCellCursor(one);
          return;
        }
        if (!editable) return this.#drawCellCursor(one);
        // The random brush previews exactly what a click places (tiles, stamps, flips, scatter).
        if (state.brushSize > 1 || host.lineAnchor?.() || this.#random()) return this.#showBrushPreview(cell);
        const sel = state.selection;
        const tex = sel ? host.scene?.atlas(sel.tilesetId)?.tileTexture(sel.tileId) : undefined;
        if (tex) {
          this.#preview.texture = tex;
          this.#preview.position.set(cell.x * map.tileWidth, cell.y * map.tileHeight);
          this.#preview.width = map.tileWidth;
          this.#preview.height = map.tileHeight;
          this.#preview.visible = true;
        }
        // The cell frame stays on top of the ghost: visible on any tile, even the same one.
        this.#drawCellCursor(one);
        return;
      }
      case "eraser":
        if (!editable) return this.#drawCellCursor(one);
        return this.#drawCellsOutline(this.#brushCells(cell));
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

  // ------------------------------------------------------------------ terrain brush

  #terrainBrush(): TerrainBrush | null {
    return activeTerrainBrush(this.#host.scene?.store);
  }

  /**
   * Live preview of the terrain brush: exactly the tiles a click would write
   * (core `terrainPaint` / `terrainErase` / `terrainFill`, neighbours
   * included), as ghosts, with the footprint outlined. Cached per cell, brush
   * and document revision.
   */
  #showTerrainPreview(tool: "brush" | "eraser" | "fill" | "rect", cell: CellPoint, brush: TerrainBrush): void {
    const scene = this.#host.scene;
    const layer = activeLayer(scene?.store);
    if (!scene || !layer) return;
    const doc = scene.store.document;
    const s = useEditorStore.getState();
    const anchor = tool === "brush" || tool === "eraser" ? (this.#host.lineAnchor?.() ?? null) : null;
    const cells = tool === "brush" || tool === "eraser" ? this.#brushCells(cell) : [cell];
    const key = `terrain:${terrainBrushKey(brush)}:${layer.id}:${scene.store.revision}:${tool}:${s.brushSize}${s.brushShape}:${anchor ? `${anchor.x},${anchor.y}>` : ""}${cell.x},${cell.y}`;
    if (this.#tilePreview.key?.startsWith(`${key}|`) === true) this.#tilePreview.root.visible = true;
    else {
      let writes: TerrainTileWrite[] = [];
      try {
        if (tool === "fill") {
          if (doc.map.width * doc.map.height <= FILL_PREVIEW_MAX_AREA) writes = terrainFill(doc, layer.id, cell.x, cell.y, brush);
        } else if (tool === "eraser") writes = terrainErase(doc, layer.id, cells, brush);
        else writes = terrainPaint(doc, layer.id, cells, brush);
      } catch (error) {
        console.warn("[canvas] terrain preview failed", error);
      }
      this.#setTilePreview(key, terrainPreviewCells(writes));
    }
    this.#tilePreview.root.position.set(0, 0);
    if (tool === "fill" || tool === "rect") return this.#drawCellCursor({ x: cell.x, y: cell.y, width: 1, height: 1 });
    this.#drawCellsOutline(cells);
  }

  /** Terrain preview of a rectangle drag (capped like the tile rectangle preview). */
  #showTerrainRect(r: CellRegion): void {
    const scene = this.#host.scene;
    const layer = activeLayer(scene?.store);
    const brush = this.#terrainBrush();
    if (!scene || !layer || !brush || r.width * r.height > RECT_PREVIEW_LIMIT) return;
    const key = `terrainR:${terrainBrushKey(brush)}:${layer.id}:${scene.store.revision}:${r.x},${r.y},${r.width},${r.height}`;
    if (this.#tilePreview.key?.startsWith(`${key}|`) === true) this.#tilePreview.root.visible = true;
    else {
      const cells: CellPoint[] = [];
      for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) cells.push({ x, y });
      let writes: TerrainTileWrite[] = [];
      try {
        writes = terrainPaint(scene.store.document, layer.id, cells, brush);
      } catch (error) {
        console.warn("[canvas] terrain preview failed", error);
      }
      this.#setTilePreview(key, terrainPreviewCells(writes));
    }
    this.#tilePreview.root.position.set(0, 0);
  }

  // ------------------------------------------------------------------ brush footprint

  /**
   * Cells a brush / eraser click at `cell` would paint: the footprint, or
   * with Shift held the footprint along the line from the last painted cell.
   * Capped at {@link BRUSH_PREVIEW_LIMIT}.
   */
  #brushCells(cell: CellPoint): CellPoint[] {
    const s = useEditorStore.getState();
    const offsets = brushFootprint(s.brushSize, s.brushShape);
    const anchor = this.#host.lineAnchor?.() ?? null;
    const centers = anchor ? [anchor, ...strokeCells(anchor, [cell])] : [cell];
    const max = Math.max(1, Math.floor(BRUSH_PREVIEW_LIMIT / offsets.length));
    return footprintCells(centers.length > max ? centers.slice(centers.length - max) : centers, offsets);
  }

  /** Brush ghost over the whole footprint / Shift line: tiles (selection or random set) plus the outline. */
  #showBrushPreview(cell: CellPoint): void {
    const host = this.#host;
    const s = useEditorStore.getState();
    const doc = host.scene?.store.document;
    if (!doc) return;
    const cells = this.#brushCells(cell);
    const random = this.#random();
    const sel = s.selection;
    const anchor = host.lineAnchor?.() ?? null;
    let preview: PreviewCell[] = [];
    let key: string | null = null;
    if (random) {
      key = `brushR:${this.#randomKey(random, doc)}:${s.brushSize}${s.brushShape}:${anchor ? `${anchor.x},${anchor.y}>` : ""}${cell.x},${cell.y}`;
      if (this.#tilePreview.key?.startsWith(`${key}|`) !== true) preview = this.#randomPreviewCells(random, doc, cells);
    } else if (sel && doc.getTileset(sel.tilesetId)) {
      const entry = { tilesetId: sel.tilesetId, tileId: sel.tileId };
      for (const c of cells) if (doc.inBounds(c.x, c.y)) preview.push({ x: c.x, y: c.y, entry, flags: 0 });
      key = `brushS:${sel.tilesetId}/${sel.tileId}:${s.brushSize}${s.brushShape}:${anchor ? `${anchor.x},${anchor.y}>` : ""}${cell.x},${cell.y}`;
    }
    if (key !== null) {
      if (this.#tilePreview.key?.startsWith(`${key}|`) === true) this.#tilePreview.root.visible = true;
      else this.#setTilePreview(key, preview);
      this.#tilePreview.root.position.set(0, 0);
    }
    if (random) this.#drawDice({ x: cell.x, y: cell.y, width: 1, height: 1 });
    if (s.brushSize > 1 || anchor) this.#drawCellsOutline(cells);
    else this.#drawCellCursor({ x: cell.x, y: cell.y, width: 1, height: 1 });
  }

  /** Crisp outline (accent / danger with a dark keyline) around the union of `cells`, clipped to the view. */
  #drawCellsOutline(cells: readonly CellPoint[], fill?: number): void {
    const bounds = cellsBounds(cells);
    if (!bounds) return;
    const v = this.#host.visible;
    const x0 = Math.max(bounds.x, v.x - 1);
    const y0 = Math.max(bounds.y, v.y - 1);
    const x1 = Math.min(bounds.x + bounds.width, v.x + v.width + 1);
    const y1 = Math.min(bounds.y + bounds.height, v.y + v.height + 1);
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0;
    const member = new Uint8Array(w * (y1 - y0));
    for (const c of cells) {
      if (c.x >= x0 && c.y >= y0 && c.x < x1 && c.y < y1) member[(c.y - y0) * w + (c.x - x0)] = 1;
    }
    const inside = (x: number, y: number) => x >= x0 && y >= y0 && x < x1 && y < y1 && member[(y - y0) * w + (x - x0)] === 1;
    const g = this.overlay;
    const cam = this.#host.camera;
    const px = 1 / cam.resolution;
    if (fill !== undefined) {
      for (let y = y0; y < y1; y++) {
        let x = x0;
        while (x < x1) {
          if (!inside(x, y)) {
            x++;
            continue;
          }
          const start = x;
          while (x < x1 && inside(x, y)) x++;
          const b = cam.cellBox({ x: start, y, width: x - start, height: 1 });
          g.rect(b.x0 * px, b.y0 * px, (b.x1 - b.x0) * px, (b.y1 - b.y0) * px);
        }
      }
      g.fill({ color: fill, alpha: CANVAS_COLORS.gridBrushAlpha });
    }
    this.#drawEdges(solidEdges(x0, y0, x1, y1, inside), useEditorStore.getState().tool === "eraser" ? this.#host.colors.danger : this.#host.colors.accent);
  }

  /** Edges of a cell area: dark halo outside, `color` line inside (see `solidEdges`). */
  #drawEdges(edges: readonly Edge[], color: number): void {
    if (edges.length === 0) return;
    const g = this.overlay;
    const cam = this.#host.camera;
    const px = 1 / cam.resolution;
    const k = cam.lineWidth();
    for (let pass = 0; pass < 2; pass++) {
      for (const e of edges) {
        const solidAfter = e.inside === "after";
        const offset = solidAfter === (pass === 1) ? 0 : -k;
        if (e.horizontal) {
          const a = cam.cellBox({ x: e.from, y: e.line, width: e.to - e.from, height: 0 });
          g.rect(a.x0 * px, (a.y0 + offset) * px, (a.x1 - a.x0) * px, k * px);
        } else {
          const a = cam.cellBox({ x: e.line, y: e.from, width: 0, height: e.to - e.from });
          g.rect((a.x0 + offset) * px, a.y0 * px, k * px, (a.y1 - a.y0) * px);
        }
      }
      if (pass === 0) g.fill(FOOTPRINT_KEYLINE);
      else g.fill(color);
    }
  }

  // ------------------------------------------------------------------ feedback

  /** Fading accent outline of the last pick. */
  #drawFlash(): void {
    const f = this.#flash;
    if (!f) return;
    const t = performance.now() - f.start;
    if (t >= FLASH_MS) {
      this.#flash = null;
      return;
    }
    const alpha = 1 - t / FLASH_MS;
    const g = this.overlay;
    const cam = this.#host.camera;
    const px = 1 / cam.resolution;
    const k = cam.lineWidth();
    // Grows a little while it fades, so it reads as "taken from here".
    const grow = Math.round((t / FLASH_MS) * 4 * k) + k;
    const box = cam.cellBox(f.region);
    rectOutline(g, box.x0 - grow - k, box.y0 - grow - k, box.x1 + grow + k, box.y1 + grow + k, k, px);
    g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.5 * alpha });
    rectOutline(g, box.x0 - grow, box.y0 - grow, box.x1 + grow, box.y1 + grow, 2 * k, px);
    g.fill({ color: this.#host.colors.accent, alpha });
    this.#host.requestRender();
  }

  /** The hint label next to where it was asked for (screen space). */
  #drawHint(): void {
    this.hint.visible = false;
    if (performance.now() >= this.#hintUntil) return;
    const p = this.#hintAt ?? this.#host.pointer?.() ?? null;
    if (!p) return;
    const cam = this.#host.camera;
    const res = cam.resolution;
    const text = this.#hintText;
    if (text.resolution !== res) text.resolution = res;
    const padX = 8;
    const padY = 4;
    const w = Math.ceil(text.width) + 2 * padX;
    const h = Math.ceil(text.height) + 2 * padY;
    this.#hintBg.clear().roundRect(0, 0, w, h, 4).fill(this.#bubbleFill);
    this.#hintBg.roundRect(0, 0, w, h, 4).stroke(this.#bubbleBorder);
    text.position.set(padX, padY);
    const x = Math.max(4, Math.min(p.x + 16, cam.viewW - w - 4));
    const y = Math.max(4, Math.min(p.y - h - 10, cam.viewH - h - 4));
    this.hint.position.set(Math.round(x * res) / res, Math.round(y * res) / res);
    this.hint.visible = true;
  }

  /** Brush size readout next to the pointer (screen space). */
  #drawReadout(): void {
    if (performance.now() >= this.#readoutUntil) return;
    const p = this.#host.pointer?.() ?? null;
    if (!p) return;
    const s = useEditorStore.getState();
    const res = this.#host.camera.resolution;
    const label = `${s.brushShape === "circle" ? "●" : "■"} ${s.brushSize}×${s.brushSize}`;
    const text = this.#readoutText;
    if (text.text !== label) text.text = label;
    if (text.resolution !== res) text.resolution = res;
    const padX = 6;
    const padY = 3;
    const w = Math.ceil(text.width) + 2 * padX;
    const h = Math.ceil(text.height) + 2 * padY;
    this.#readoutBg.clear().roundRect(0, 0, w, h, 4).fill(this.#bubbleFill);
    this.#readoutBg.roundRect(0, 0, w, h, 4).stroke(this.#bubbleBorder);
    text.position.set(padX, padY);
    // Below-right of the pointer, kept inside the view; whole device pixels.
    const cam = this.#host.camera;
    const x = Math.min(p.x + 18, cam.viewW - w - 4);
    const y = Math.min(p.y + 20, cam.viewH - h - 4);
    this.readout.position.set(Math.round(x * res) / res, Math.round(y * res) / res);
    this.readout.visible = true;
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
        // A stamp on a grid layer paints the value like the brush (saved stamps were handled before).
        return this.#drawCellsOutline(this.#brushCells(cell), this.#host.colors.accent);
      case "eraser":
        return this.#drawCellsOutline(this.#brushCells(cell));
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

  /** Crisp outlines of the collision overlay (visible cells only): solid areas, and passable exceptions in their colour. */
  #drawCollisionOutline(): void {
    const host = this.#host;
    const overlays = host.gridOverlays;
    const map = host.scene?.store.document.map;
    if (!overlays || !map) return;
    const cam = host.camera;
    const v = host.visible;
    if (v.width <= 0 || v.height <= 0 || v.width * v.height > OUTLINE_MAX_CELLS) return;
    if (map.tileWidth * cam.camera.zoom * cam.resolution < OUTLINE_MIN_CELL_DEVICE_PX) return;
    const x1 = v.x + v.width;
    const y1 = v.y + v.height;
    const solid = solidEdges(v.x, v.y, x1, y1, (x, y) => isSolidCode(overlays.collisionCode(x, y)));
    this.#drawAreaEdges(solid, host.colors.collisionSolid, CANVAS_COLORS.collisionLineAlpha);
    const passable = solidEdges(v.x, v.y, x1, y1, (x, y) => overlays.collisionCode(x, y) === COLL_FORCED_PASSABLE);
    this.#drawAreaEdges(passable, host.colors.collisionPassable, CANVAS_COLORS.collisionLineAlpha);
  }

  /** Area edges: a dark halo on the outer side (readable over any tile), the `color` line on the inner side. */
  #drawAreaEdges(edges: readonly Edge[], color: number, alpha: number): void {
    if (edges.length === 0) return;
    const g = this.overlay;
    const cam = this.#host.camera;
    const px = 1 / cam.resolution;
    const k = cam.lineWidth();
    for (const pass of [0, 1] as const) {
      for (const e of edges) {
        const solidAfter = e.inside === "after";
        const offset = solidAfter === (pass === 1) ? 0 : -k;
        if (e.horizontal) {
          const a = cam.cellBox({ x: e.from, y: e.line, width: e.to - e.from, height: 0 });
          g.rect(a.x0 * px, (a.y0 + offset) * px, (a.x1 - a.x0) * px, k * px);
        } else {
          const a = cam.cellBox({ x: e.line, y: e.from, width: 0, height: e.to - e.from });
          g.rect((a.x0 + offset) * px, a.y0 * px, k * px, (a.y1 - a.y0) * px);
        }
      }
      if (pass === 0) g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.55 });
      else g.fill({ color, alpha });
    }
  }

  // ------------------------------------------------------------------ primitives

  /** Accent outline with a dark halo just outside (rectangle drag, grid footprint). */
  #drawAccentOutline(r: CellRegion, color = this.#host.colors.accent): void {
    const g = this.overlay;
    const px = 1 / this.#host.camera.resolution;
    const box = this.#host.camera.cellBox(r);
    const k = this.#host.camera.lineWidth();
    rectOutline(g, box.x0 - k, box.y0 - k, box.x1 + k, box.y1 + k, k, px);
    g.fill(FOOTPRINT_KEYLINE);
    rectOutline(g, box.x0, box.y0, box.x1, box.y1, k, px);
    g.fill(color);
  }

  /**
   * Selection region / marquee: subtle accent fill and marching ants (white
   * dashes moving along a dark line, readable on any tile). While a region
   * is drawn the ants step at ~8 fps; nothing animates without one.
   */
  #drawRegion(r: CellRegion): void {
    const g = this.overlay;
    const cam = this.#host.camera;
    const px = 1 / cam.resolution;
    const k = cam.lineWidth();
    const b = cam.cellBox(r);
    g.rect(b.x0 * px, b.y0 * px, (b.x1 - b.x0) * px, (b.y1 - b.y0) * px).fill({
      color: this.#host.colors.accent,
      alpha: CANVAS_COLORS.regionFillAlpha,
    });
    // Outer dark halo, then the dark base line the dashes run on.
    rectOutline(g, b.x0 - k, b.y0 - k, b.x1 + k, b.y1 + k, k, px);
    g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.35 });
    rectOutline(g, b.x0, b.y0, b.x1, b.y1, k, px);
    g.fill({ color: CANVAS_COLORS.cursorShadow, alpha: 0.9 });
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const dash = 4 * k;
    const phase = Math.floor(performance.now() / ANTS_STEP_MS) * k;
    for (const [a0, a1] of dashSpans(2 * (w + h), dash, dash, phase)) perimeterSpan(g, b.x0, b.y0, w, h, a0, a1, k, px);
    g.fill({ color: CANVAS_COLORS.cursor, alpha: 0.95 });
    this.#antsTimer ??= setTimeout(() => {
      this.#antsTimer = null;
      this.#host.requestRender();
    }, ANTS_STEP_MS);
  }

  /** Eraser right drag: the area that will be cleared, danger-coloured fill and outline. */
  #drawEraseRect(r: CellRegion): void {
    const g = this.overlay;
    const cam = this.#host.camera;
    const px = 1 / cam.resolution;
    const k = cam.lineWidth();
    const b = cam.cellBox(r);
    const danger = this.#host.colors.danger;
    g.rect(b.x0 * px, b.y0 * px, (b.x1 - b.x0) * px, (b.y1 - b.y0) * px).fill({ color: danger, alpha: 0.16 });
    rectOutline(g, b.x0 - k, b.y0 - k, b.x1 + k, b.y1 + k, k, px);
    g.fill(FOOTPRINT_KEYLINE);
    rectOutline(g, b.x0, b.y0, b.x1, b.y1, k, px);
    g.fill(danger);
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

  /** Cell / stamp footprint with a one-device-pixel colour line and outer keyline. */
  #drawCellCursor(r: CellRegion): void {
    this.#drawAccentOutline(r, useEditorStore.getState().tool === "eraser" ? this.#host.colors.danger : this.#host.colors.accent);
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
    this.#showStampGridPreview(key, clip, mapping, origin);
    // Bounds, so empty / same-looking parts of the stamp are still visible.
    this.#drawCellCursor({ x: origin.x, y: origin.y, width: clip.width, height: clip.height });
  }

  /** Grid layers of a stamp as faint terrain / collision overlay cells. */
  #showStampGridPreview(key: string, clip: TileClip, mapping: Record<string, string>, origin: CellPoint): void {
    const layers = clip.layers.filter((l) => l.grid && mapping[l.layerId] !== undefined);
    if (layers.length === 0) return;
    const map = this.#host.scene!.store.document.map;
    const g = this.#stampGridPreview;
    const colors = this.#host.colors;
    const fullKey = `${key}|${colors.collisionSolid},${colors.collisionPassable},${colors.terrainTint}`;
    if (this.#stampGridKey !== fullKey) {
      this.#stampGridKey = fullKey;
      g.clear();
      const tw = map.tileWidth;
      const th = map.tileHeight;
      for (const layer of layers) {
        const collision = layer.role === "collision";
        // One fill per colour; runs of equal cells in a row are one rect.
        const groups = collision
          ? [
              { color: colors.collisionSolid, match: (v: number) => v !== 0 && v !== COLLISION_PASSABLE },
              { color: colors.collisionPassable, match: (v: number) => v === COLLISION_PASSABLE },
            ]
          : [{ color: colors.terrainTint, match: (v: number) => v !== 0 }];
        for (const { color, match } of groups) {
          let any = false;
          for (let y = 0; y < clip.height; y++) {
            let x = 0;
            while (x < clip.width) {
              if (!match(layer.cells[y * clip.width + x] ?? 0)) {
                x++;
                continue;
              }
              const x0 = x;
              while (x < clip.width && match(layer.cells[y * clip.width + x] ?? 0)) x++;
              g.rect(x0 * tw, y * th, (x - x0) * tw, th);
              any = true;
            }
          }
          if (any) g.fill({ color, alpha: 0.28 });
        }
      }
    }
    g.position.set(origin.x * map.tileWidth, origin.y * map.tileHeight);
    g.visible = true;
  }

  /** The random set the brush / rectangle / fill paint with on the active layer, or null. */
  #random(): RandomSet | null {
    const store = this.#host.scene?.store;
    if (useEditorStore.getState().stamp) return null;
    return activeRandomSet(store?.document, activeLayer(store));
  }

  /** Preview cache key of `set`: its content, the seed and the stamp library. */
  #randomKey(set: RandomSet, doc: MapDocument): string {
    const stamps = set.candidates.some((c) => c.kind === "stamp") ? `:L${libraryId(useProjectLibrary.getState().stamps)}` : "";
    return `${randomPlanKey(set, doc.seed)}${stamps}`;
  }

  /**
   * What the random brush places on `cells` (in-bounds only), as preview
   * tiles: tile candidates with their flips, stamp candidates' visible tile
   * layers at their anchors (flipped like `placeStamp` will), scattered
   * cells left out — the same plan the tool controller paints.
   */
  #randomPreviewCells(set: RandomSet, doc: MapDocument, cells: Iterable<CellPoint>): PreviewCell[] {
    const inside: CellPoint[] = [];
    for (const c of cells) if (doc.inBounds(c.x, c.y)) inside.push(c);
    const plan = planRandomPaint(set, doc.seed, inside);
    const out: PreviewCell[] = plan.tiles.map((t) => ({ x: t.x, y: t.y, entry: { tilesetId: t.tilesetId, tileId: t.tileId }, flags: t.flags }));
    for (const p of plan.stamps) {
      const stamp = randomStampOf(p.stampId);
      if (!stamp) continue;
      let clip: TileClip = stamp;
      if (p.flip.x) clip = flipClip(clip, "x");
      if (p.flip.y) clip = flipClip(clip, "y");
      const mapping = savedStampPreviewMapping(this.#host.scene?.store, clip);
      for (const c of stampPreviewCells(clip, mapping)) out.push({ ...c, x: c.x + p.x, y: c.y + p.y });
    }
    return out;
  }

  /** Small die in the top-right corner of a cell: the brush picks a random tile of the set. */
  #drawDice(r: CellRegion): void {
    const cam = this.#host.camera;
    const box = cam.cellBox(r);
    const k = cam.lineWidth();
    const size = 9 * k;
    if (box.x1 - box.x0 < 2 * size) return;
    const g = this.overlay;
    const px = 1 / cam.resolution;
    const x0 = box.x1 - size - 2 * k;
    const y0 = box.y0 + 2 * k;
    g.roundRect((x0 - k) * px, (y0 - k) * px, (size + 2 * k) * px, (size + 2 * k) * px, 2.5 * k * px).fill({
      color: CANVAS_COLORS.cursorShadow,
      alpha: 0.6,
    });
    g.roundRect(x0 * px, y0 * px, size * px, size * px, 2 * k * px).fill(CANVAS_COLORS.cursor);
    const d = Math.max(1, Math.round(1.5 * k));
    for (const [fx, fy] of [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]] as const) {
      g.rect((x0 + Math.round(size * fx) - d / 2) * px, (y0 + Math.round(size * fy) - d / 2) * px, d * px, d * px);
    }
    g.fill(CANVAS_COLORS.cursorShadow);
  }

  /** Rectangle (or single-cell) preview with the current pattern tiled from `anchor`. */
  #showPatternPreview(r: CellRegion, anchor: CellPoint): void {
    const random = this.#random();
    const doc = this.#host.scene?.store.document;
    if (random && doc) {
      const v = this.#host.visible;
      const x0 = Math.max(r.x, v.x);
      const y0 = Math.max(r.y, v.y);
      const x1 = Math.min(r.x + r.width, v.x + v.width);
      const y1 = Math.min(r.y + r.height, v.y + v.height);
      if (x1 <= x0 || y1 <= y0 || (x1 - x0) * (y1 - y0) > RECT_PREVIEW_LIMIT) return;
      const key = `rectR:${this.#randomKey(random, doc)}:${x0},${y0},${x1},${y1}`;
      if (this.#tilePreview.key?.startsWith(`${key}|`) === true) this.#tilePreview.root.visible = true;
      else {
        const cells: CellPoint[] = [];
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cells.push({ x, y });
        this.#setTilePreview(key, this.#randomPreviewCells(random, doc, cells));
      }
      this.#tilePreview.root.position.set(0, 0);
      return;
    }
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
    const random = gridValue === undefined && this.#random() !== null;
    if (gridValue === undefined && !s.stamp && !s.selection && !random) return;
    const map = scene.store.document.map;
    if (map.width * map.height > FILL_PREVIEW_MAX_AREA) return;
    // Filling cells that already hold the value changes nothing.
    if (gridValue !== undefined) {
      if (layer.getCell(cell.x, cell.y) === gridValue) return;
    } else if (!s.stamp && s.selection && !random) {
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

/**
 * Adds the part `[a0, a1)` of a rectangle outline (`k` device px thick,
 * inside the `w`×`h` box at `x0`, `y0`) to `g`, measured clockwise from the
 * top-left corner along the perimeter `2 * (w + h)`.
 */
function perimeterSpan(g: Graphics, x0: number, y0: number, w: number, h: number, a0: number, a1: number, k: number, px: number): void {
  const edges: [number, number, (from: number, to: number) => void][] = [
    [0, w, (f, t) => g.rect((x0 + f) * px, y0 * px, (t - f) * px, k * px)],
    [w, w + h, (f, t) => g.rect((x0 + w - k) * px, (y0 + f - w) * px, k * px, (t - f) * px)],
    [w + h, 2 * w + h, (f, t) => g.rect((x0 + 2 * w + h - t) * px, (y0 + h - k) * px, (t - f) * px, k * px)],
    [2 * w + h, 2 * (w + h), (f, t) => g.rect(x0 * px, (y0 + 2 * (w + h) - t) * px, k * px, (t - f) * px)],
  ];
  for (const [start, end, draw] of edges) {
    const f = Math.max(a0, start);
    const t = Math.min(a1, end);
    if (t > f) draw(f, t);
  }
}

const libraryIds = new WeakMap<object, number>();
let nextLibraryId = 1;

/** Stable small number per stamp library array (preview cache keys). */
function libraryId(stamps: object): number {
  let id = libraryIds.get(stamps);
  if (id === undefined) libraryIds.set(stamps, (id = nextLibraryId++));
  return id;
}

/** Ghost cells of terrain writes (erased cells show nothing; the outline marks them). */
function terrainPreviewCells(writes: readonly TerrainTileWrite[]): PreviewCell[] {
  const out: PreviewCell[] = [];
  for (const w of writes) if (w.tile) out.push({ x: w.x, y: w.y, entry: { tilesetId: w.tile.tilesetId, tileId: w.tile.tileId }, flags: 0 });
  return out;
}
