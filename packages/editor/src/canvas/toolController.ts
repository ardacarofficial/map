/**
 * Pointer tools on the map: brush / eraser strokes, stamps, rectangle,
 * fill, marquee selection and pick. Owns the gesture in progress and turns
 * it into store ops — one transaction (= one undo step) per gesture.
 *
 * On a grid layer (terrain / collision) brush, eraser, rectangle and fill
 * write grid values with `paintTerrain` (which re-derives terrain tiles in
 * the same undo step); stamps do not apply there, and a single-cell pick
 * takes the grid value.
 *
 * v0.6: a saved library stamp (it has an `id`) is placed with core
 * `placeStamp` (layers matched by name / role, missing ones created in the
 * same undo step) on any active layer; a random brush set (2+ tiles) makes
 * brush / rectangle / fill pick a tile per cell (`pickRandomTile` with the
 * document seed); on an entity layer the entity tool (and the select tool)
 * adds, selects and drags entities (a drag = one undo step).
 *
 * Comfort round: brush / eraser (also on grid layers) paint the store's
 * brush footprint (size × size square or circle) along the stroke; Shift +
 * click draws a straight line from the last painted cell; Shift / Alt shape
 * a rectangle (square / from the centre). Picks and finished strokes are
 * reported to the host (handle events, recent tiles, a flash on the map).
 */
import {
  EMPTY_CELL,
  cellFlags,
  cellPaletteIndex,
  copyRegion,
  floodFill,
  isEntityLayer,
  isGridLayer,
  isTileLayer,
  makeCell,
  pasteClip,
  patchCellCount,
  placeStamp,
  type CellPoint,
  type CellWrite,
  type GridLayer,
  type GridWrite,
  type MapStore,
  type TileClip,
  type TileLayer,
} from "@smap/core";

import { moveEntityToCell, placeEntity } from "../commands/entityActions";
import { useEditorStore, type CellRegion, type TileSelection } from "../state/editorStore";
import { cellWrites, strokeCells } from "./brush";
import type { Point } from "./camera";
import { gridPickEvent, pickEvent, recentTileOf, strokeSummary, type CanvasPickEvent, type StrokeSummary, type StrokeTool } from "./canvasEvents";
import type { CameraController } from "./cameraController";
import { dragPosition, type WorldPoint } from "./entityLogic";
import type { EntityRenderer } from "./entityRenderer";
import { brushFootprint, constrainRect, footprintCells, type RectModifiers } from "./footprint";
import { gridFillWrites, gridPaintValue, gridRectWrites, gridWrites } from "./gridPaint";
import { activeLayer, layerInfo, mappingFor, savedStamp } from "./layerAccess";
import type { MapScene } from "./mapScene";
import { isRandomBrush, randomCellPicker } from "./randomPaint";
import { decidePick, dragRegion, isEditable, isGridEditable, isPaintable, patternCell, patternLayerIndex, regionContains, stampOrigins } from "./tools";

/** A pointer interaction in progress (left or right button). */
export type Gesture =
  | {
      readonly kind: "paint";
      readonly pointerId: number;
      readonly store: MapStore;
      readonly layerId: string;
      /** Cell (tile layer) or grid value (grid layer) the stroke writes. */
      readonly value: number;
      readonly grid: boolean;
      /** Random brush: cell per position (overrides `value`), or null. */
      readonly pick: ((x: number, y: number) => number) | null;
      readonly tool: StrokeTool;
      /** Brush footprint offsets around each stroke cell. */
      readonly offsets: readonly CellPoint[];
      /** Cells the stroke already covered ("x,y"). */
      readonly seen: Set<string>;
      /** Cells changed so far. */
      count: number;
      last: CellPoint | null;
    }
  | {
      readonly kind: "stamp";
      readonly pointerId: number;
      readonly store: MapStore;
      readonly clip: TileClip;
      readonly mapping: Record<string, string>;
      /** Saved library stamp: placed with `placeStamp` (`mapping` unused). */
      readonly saved: boolean;
      readonly start: CellPoint;
      readonly placed: Set<string>;
      count: number;
      last: CellPoint | null;
    }
  | {
      readonly kind: "rect";
      readonly pointerId: number;
      readonly start: CellPoint;
      end: CellPoint;
      /** Shift: square. */
      square: boolean;
      /** Alt: `start` is the centre. */
      fromCenter: boolean;
    }
  | { readonly kind: "select"; readonly pointerId: number; readonly start: CellPoint; end: CellPoint; moved: boolean }
  | { readonly kind: "pick"; readonly pointerId: number; readonly button: number; readonly start: CellPoint; end: CellPoint }
  | {
      readonly kind: "entity";
      readonly pointerId: number;
      readonly store: MapStore;
      readonly entityId: string;
      /** Entity position when the drag started (map px). */
      readonly start: WorldPoint;
      /** Cell under the pointer when the drag started. */
      readonly grab: CellPoint;
      /** False on a locked layer: the click selects, the drag does nothing. */
      readonly movable: boolean;
    };

/** What the controller needs from the canvas. */
export interface ToolHost {
  readonly scene: MapScene | null;
  readonly entities: EntityRenderer;
  readonly camera: CameraController;
  toLocal(e: { clientX: number; clientY: number }): Point;
  /** Cell under the pointer, also outside the map. */
  pointerCell(): CellPoint | null;
  capture(pointerId: number): void;
  release(pointerId: number): void;
  requestRender(): void;
  /** True while Alt holds the temporary eyedropper (picks do not switch tools). */
  springActive?(): boolean;
  /** Something was picked from the map. */
  picked?(event: CanvasPickEvent): void;
  /** An edit gesture finished as one undo step. */
  strokeCommitted?(summary: StrokeSummary): void;
  /** Briefly outline `region` (pick feedback). */
  flash?(region: CellRegion): void;
}

/** Map region of a rectangle gesture (modifiers applied), clipped to the map. */
export function rectGestureRegion(
  g: { readonly start: CellPoint; readonly end: CellPoint; readonly square: boolean; readonly fromCenter: boolean },
  bounds: { readonly width: number; readonly height: number },
): CellRegion | null {
  const mods: RectModifiers = { square: g.square, fromCenter: g.fromCenter };
  const { a, b } = constrainRect(g.start, g.end, mods);
  return dragRegion(a, b, bounds);
}

/** Last painted cell of a stroke: Shift + click draws a line from it. */
interface LastPaint {
  readonly store: MapStore;
  readonly layerId: string;
  readonly cell: CellPoint;
}

/** `PointerEvent.buttons` bit of a `PointerEvent.button`. */
function buttonBit(button: number): number {
  return button === 1 ? 4 : button === 2 ? 2 : 1 << button;
}

/** True when `e` reports that `button` was just released. */
export function released(e: PointerEvent, button: number): boolean {
  return e.button === button && (e.buttons & buttonBit(button)) === 0;
}

export class ToolController {
  #gesture: Gesture | null = null;
  #lastPaint: LastPaint | null = null;
  readonly #host: ToolHost;

  constructor(host: ToolHost) {
    this.#host = host;
  }

  get gesture(): Gesture | null {
    return this.#gesture;
  }

  /**
   * Where a Shift + click line would start: the last painted cell when the
   * current tool paints with a brush footprint on the same layer, else null.
   */
  lineAnchor(): CellPoint | null {
    const lp = this.#lastPaint;
    if (!lp || this.#gesture) return null;
    const store = this.#host.scene?.store;
    const s = useEditorStore.getState();
    if (!store || store !== lp.store || s.activeLayerId !== lp.layerId) return null;
    if (!this.#footprintTool()) return null;
    return lp.cell;
  }

  /** Shift / Alt changed (keys or pointer events): reshapes a rectangle drag. */
  setModifiers(shift: boolean, alt: boolean): void {
    const g = this.#gesture;
    if (g?.kind !== "rect" || (g.square === shift && g.fromCenter === alt)) return;
    g.square = shift;
    g.fromCenter = alt;
    this.#host.requestRender();
  }

  /** True when the current tool paints the brush footprint (brush without stamp, eraser) on a paintable layer. */
  #footprintTool(): boolean {
    const s = useEditorStore.getState();
    const grid = isGridLayer(this.#activeLayer());
    if (s.tool === "eraser") return true;
    return s.tool === "brush" && !(s.stamp && (savedStamp(s.stamp) || !grid));
  }

  /** Left / right button down on a map cell (pan already handled). */
  pointerDown(e: PointerEvent, cell: CellPoint): void {
    if (e.button === 2) {
      e.preventDefault();
      this.#start({ kind: "pick", pointerId: e.pointerId, button: 2, start: cell, end: cell });
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    const s = useEditorStore.getState();
    const active = this.#activeLayer();
    const grid = isGridLayer(active);
    if ((s.tool === "entity" || s.tool === "select") && isEntityLayer(active)) {
      if (this.#entityDown(e, cell) || s.tool === "entity") {
        this.#host.requestRender();
        return;
      }
    }
    switch (s.tool) {
      case "brush":
        if (s.stamp && (savedStamp(s.stamp) || !grid)) this.#beginStamp(e, s.stamp, cell);
        else this.#beginPaint(e, e.shiftKey ? this.lineAnchor() : null);
        break;
      case "eraser":
        this.#beginPaint(e, e.shiftKey ? this.lineAnchor() : null);
        break;
      case "fill":
        this.#fillAt(cell);
        break;
      case "rect": {
        const info = this.#activeInfo();
        if (grid ? isGridEditable(info) : isEditable(info) && (s.stamp || s.selection || isRandomBrush(s.randomSet))) {
          this.#start({ kind: "rect", pointerId: e.pointerId, start: cell, end: cell, square: e.shiftKey, fromCenter: e.altKey });
        }
        break;
      }
      case "select":
        this.#start({ kind: "select", pointerId: e.pointerId, start: cell, end: cell, moved: false });
        break;
      case "eyedropper":
        this.#start({ kind: "pick", pointerId: e.pointerId, button: 0, start: cell, end: cell });
        break;
    }
    this.#host.requestRender();
  }

  /** Pointer move of the gesture's pointer. */
  pointerMove(e: PointerEvent): void {
    const g = this.#gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    // A second button pressed or released mid-drag arrives as a move ("chorded" buttons).
    if (e.button === 2 && (e.buttons & 2) !== 0 && this.isCancelable()) {
      this.cancel();
    } else if (g.kind === "pick" && released(e, g.button)) {
      this.#finish();
    } else if (g.kind === "paint" || g.kind === "stamp") {
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      this.#paint(events.length > 0 ? events : [e]);
    } else if (g.kind === "entity") {
      this.#dragEntity(g);
    } else {
      if (g.kind === "rect") this.setModifiers(e.shiftKey, e.altKey);
      const cell = this.#host.pointerCell();
      if (cell) {
        if (g.kind === "select" && (cell.x !== g.start.x || cell.y !== g.start.y)) g.moved = true;
        g.end = cell;
      }
    }
  }

  /** Pointer up of the gesture's pointer. */
  pointerUp(e: PointerEvent): void {
    const g = this.#gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    const button = g.kind === "pick" ? g.button : 0;
    if (!released(e, button)) return;
    if (g.kind === "paint" || g.kind === "stamp") this.#paint([e]);
    else if (g.kind === "entity") this.#dragEntity(g);
    else {
      if (g.kind === "rect") this.setModifiers(e.shiftKey, e.altKey);
      const cell = this.#host.pointerCell();
      if (cell) g.end = cell;
    }
    this.#finish();
  }

  /** Rectangle, marquee and pick drags can be cancelled (Esc, right click); strokes only by Esc. */
  isCancelable(): boolean {
    const g = this.#gesture;
    return !!g && (g.kind === "rect" || g.kind === "select" || g.kind === "entity" || (g.kind === "pick" && g.button === 0));
  }

  /** Ends without applying drags; keeps what a stroke already painted (lost capture, project change). */
  end(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    if ((g.kind === "paint" || g.kind === "stamp" || g.kind === "entity") && g.store.inTransaction) {
      g.store.commit();
      if (g.kind !== "entity") this.#strokeDone(g);
    }
    this.#host.release(g.pointerId);
    this.#host.requestRender();
  }

  /** Cancels the gesture; a stroke is rolled back. */
  cancel(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    if ((g.kind === "paint" || g.kind === "stamp" || g.kind === "entity") && g.store.inTransaction) g.store.rollback();
    this.#host.release(g.pointerId);
    this.#host.requestRender();
  }

  // ------------------------------------------------------------------ gesture lifecycle

  #start(g: Gesture): void {
    this.#gesture = g;
    this.#host.capture(g.pointerId);
    this.#host.requestRender();
  }

  /** Completes the gesture normally (pointer released). */
  #finish(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    switch (g.kind) {
      case "paint":
      case "stamp":
        if (g.store.inTransaction) {
          g.store.commit();
          this.#strokeDone(g);
        }
        break;
      case "entity":
        if (g.store.inTransaction) g.store.commit();
        break;
      case "rect": {
        const map = this.#host.scene?.store.document.map;
        const r = map ? rectGestureRegion(g, map) : null;
        if (r) this.#commitRect(r, g.start);
        break;
      }
      case "select":
        this.#finishSelect(g.start, g.end, g.moved);
        break;
      case "pick":
        this.#finishPick(g.start, g.end);
        break;
    }
    this.#host.release(g.pointerId);
    this.#host.requestRender();
  }

  /** After a stroke's commit: remembers the line anchor and reports the edit. */
  #strokeDone(g: Extract<Gesture, { kind: "paint" | "stamp" }>): void {
    if (g.kind === "paint" && g.last) this.#lastPaint = { store: g.store, layerId: g.layerId, cell: g.last };
    this.#report(g.kind === "stamp" ? "stamp" : g.tool, g.count);
  }

  #report(tool: StrokeTool, cells: number): void {
    const summary = strokeSummary(tool, cells);
    if (summary) this.#host.strokeCommitted?.(summary);
  }

  /** Adds a painted single tile to the recent-tiles strip (skips a repeat of the newest). */
  #pushRecent(tile: TileSelection): void {
    const s = useEditorStore.getState();
    const head = s.recentTiles[0];
    if (head && head.tilesetId === tile.tilesetId && head.tileId === tile.tileId) return;
    s.pushRecentTile({ tilesetId: tile.tilesetId, tileId: tile.tileId });
  }

  /** The selected single tile when the fill / rectangle tools paint it (no stamp, no random set). */
  #singleTile(): TileSelection | null {
    const s = useEditorStore.getState();
    if (s.stamp || isRandomBrush(s.randomSet) || !s.selection) return null;
    return s.selection;
  }

  // ------------------------------------------------------------------ helpers

  #activeLayer(): TileLayer | undefined {
    return activeLayer(this.#host.scene?.store);
  }

  #activeInfo() {
    const layer = this.#activeLayer();
    return layer ? layerInfo(layer, this.#host.scene?.store.document) : undefined;
  }

  #markDirty(): void {
    const st = useEditorStore.getState();
    if (!st.dirty) st.setDirty(true);
  }

  /** Runs `fn` (returns the changed cell count) as one undo step reported as `tool`; rolls back if it throws. */
  #transact(store: MapStore, tool: StrokeTool, fn: () => number): void {
    store.beginTransaction();
    let changed: number;
    try {
      changed = fn();
    } catch (error) {
      store.rollback();
      console.error("[canvas] edit failed", error);
      return;
    }
    store.commit();
    if (changed > 0) {
      this.#markDirty();
      this.#report(tool, changed);
    }
  }

  /** Active layer when the paint tools may write to it (tile or grid layer). */
  #editTarget(): { store: MapStore; layer: TileLayer } | null {
    const store = this.#host.scene?.store;
    const layer = this.#activeLayer();
    if (!store || !layer || !isPaintable(layerInfo(layer, store.document))) return null;
    return { store, layer };
  }

  /** Grid value the current tool writes on `layer`, or null when it cannot paint. */
  #gridValue(layer: GridLayer): number | null {
    const s = useEditorStore.getState();
    return gridPaintValue(s.tool, s.gridValue, layer.maxValue);
  }

  /** Dispatches grid writes inside the open transaction; returns the changed cell count. */
  #paintGrid(store: MapStore, layerId: string, cells: GridWrite[]): number {
    if (cells.length === 0) return 0;
    return patchCellCount(store.dispatch({ type: "paintTerrain", layerId, cells }));
  }

  /** Dispatches tile writes inside the open transaction; returns the changed cell count. */
  #paintCells(store: MapStore, layerId: string, cells: CellWrite[]): number {
    if (cells.length === 0) return 0;
    return patchCellCount(store.dispatch({ type: "paintCells", layerId, cells }));
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
      const li = patternLayerIndex(clip, mappingFor(store, clip), s.activeLayerId);
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
    const random = this.#randomPicker(store);
    if (random) return random;
    const sel = s.selection;
    if (!sel || !store.document.getTileset(sel.tilesetId)) return null;
    const value = makeCell(store.getOrAddPaletteIndex(sel.tilesetId, sel.tileId));
    return () => value;
  }

  /**
   * Random brush cell writer when a set of 2+ tiles is picked and the active
   * layer is a tile layer; adds palette entries (call inside the transaction).
   */
  #randomPicker(store: MapStore): ((x: number, y: number) => number) | null {
    const s = useEditorStore.getState();
    if (!isRandomBrush(s.randomSet) || !isTileLayer(this.#activeLayer())) return null;
    const doc = store.document;
    return randomCellPicker(s.randomSet, doc.seed, (tilesetId, tileId) =>
      doc.getTileset(tilesetId) ? store.getOrAddPaletteIndex(tilesetId, tileId) : 0,
    );
  }

  // ------------------------------------------------------------------ one-shot edits

  #fillAt(cell: CellPoint): void {
    const t = this.#editTarget();
    if (!t) return;
    const { store, layer } = t;
    const map = store.document.map;
    if (!store.document.inBounds(cell.x, cell.y)) return;
    if (isGridLayer(layer)) {
      const value = this.#gridValue(layer);
      if (value === null) return;
      const writes = gridFillWrites(layer, cell.x, cell.y, value, map);
      if (writes.length > 0) this.#transact(store, "fill", () => this.#paintGrid(store, layer.id, writes));
      return;
    }
    // The sentinel never equals a cell, so this is the whole same-valued region.
    const points = floodFill(layer, cell.x, cell.y, -1, map);
    const single = this.#singleTile();
    this.#transact(store, "fill", () => {
      // Stamps tile by absolute position, so neighbouring fills line up.
      const at = this.#writePattern(store, { x: 0, y: 0 });
      if (!at) return 0;
      const cells: CellWrite[] = [];
      for (const p of points) {
        const v = at(p.x, p.y);
        if (v === EMPTY_CELL || layer.getCell(p.x, p.y) === v) continue;
        cells.push({ x: p.x, y: p.y, cell: v });
      }
      return this.#paintCells(store, layer.id, cells);
    });
    if (single) this.#pushRecent(single);
  }

  /** Fills `r` (modifiers already applied); a stamp repeats from the drag start `anchor`. */
  /**
   * Fills `r` with the current brush (tile, stamp pattern, random set or
   * grid value) as one undo step reported as "fill" — the selection bar's
   * "Doldur". No-op when the active layer takes no paint.
   */
  fillRegion(r: CellRegion): void {
    if (this.#gesture) return;
    this.#commitRect(r, { x: r.x, y: r.y }, "fill");
    this.#host.requestRender();
  }

  #commitRect(r: CellRegion, anchor: CellPoint, tool: StrokeTool = "rect"): void {
    const t = this.#editTarget();
    if (!t) return;
    const { store, layer } = t;
    if (isGridLayer(layer)) {
      const value = this.#gridValue(layer);
      if (value === null) return;
      const writes = gridRectWrites(r, value, (x, y) => layer.getCell(x, y));
      if (writes.length > 0) this.#transact(store, tool, () => this.#paintGrid(store, layer.id, writes));
      return;
    }
    const single = this.#singleTile();
    this.#transact(store, tool, () => {
      const at = this.#writePattern(store, anchor);
      if (!at) return 0;
      const cells: CellWrite[] = [];
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) {
          const v = at(x, y);
          if (v === EMPTY_CELL || layer.getCell(x, y) === v) continue;
          cells.push({ x, y, cell: v });
        }
      }
      return this.#paintCells(store, layer.id, cells);
    });
    if (single) this.#pushRecent(single);
  }

  #finishSelect(start: CellPoint, end: CellPoint, moved: boolean): void {
    const map = this.#host.scene?.store.document.map;
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
    const doc = this.#host.scene?.store.document;
    if (!doc) return;
    const r = dragRegion(start, end, doc.map);
    if (!r) return;
    const s = useEditorStore.getState();
    // Alt held (temporary eyedropper): releasing Alt brings the previous tool back.
    const switchTool = () => {
      if (this.#host.springActive?.()) return;
      if (s.tool === "eraser" || s.tool === "select" || s.tool === "eyedropper") s.setTool("brush");
    };
    // On a grid layer a single-cell pick takes the painted value.
    const active = this.#activeLayer();
    if (isGridLayer(active) && r.width === 1 && r.height === 1) {
      const value = active.getCell(r.x, r.y);
      if (value !== 0) {
        s.setGridValue(value);
        switchTool();
        this.#picked(gridPickEvent(value, r));
        return;
      }
    }
    const result = decidePick(doc.layers.map((l) => layerInfo(l)), s.activeLayerId, r, (i) => doc.palette.get(i));
    if (result.kind === "none") return;
    let clip: TileClip | null = null;
    if (result.kind === "tile") {
      s.setStamp(null);
      s.setSelection(result.entry);
    } else {
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
    switchTool();
    const event = pickEvent(result, clip, r);
    if (event) this.#picked(event);
  }

  /** Pick feedback: recent tiles, the handle event and a flash on the map. */
  #picked(event: CanvasPickEvent): void {
    const tile = recentTileOf(event);
    if (tile) this.#pushRecent(tile);
    this.#host.flash?.(event.region);
    this.#host.picked?.(event);
  }

  // ------------------------------------------------------------------ strokes

  /** Starts a brush / eraser stroke; `from` (Shift + click) joins it to that cell with a line. */
  #beginPaint(e: PointerEvent, from: CellPoint | null): void {
    const state = useEditorStore.getState();
    const t = this.#editTarget();
    if (!t) return;
    const { store, layer } = t;
    let value: number;
    let pick: ((x: number, y: number) => number) | null = null;
    let recent: TileSelection | null = null;
    const grid = isGridLayer(layer);
    if (grid) {
      const v = this.#gridValue(layer);
      if (v === null) return;
      value = v;
    } else if (state.tool === "eraser") value = EMPTY_CELL;
    else if (isRandomBrush(state.randomSet)) {
      try {
        pick = this.#randomPicker(store);
      } catch (error) {
        console.error("[canvas] cannot paint random set", error);
        return;
      }
      if (!pick) return;
      value = EMPTY_CELL;
    } else {
      const sel = state.selection;
      if (!sel || !store.document.getTileset(sel.tilesetId)) return;
      try {
        value = makeCell(store.getOrAddPaletteIndex(sel.tilesetId, sel.tileId));
      } catch (error) {
        console.error("[canvas] cannot paint selection", error);
        return;
      }
      recent = sel;
    }
    const offsets = brushFootprint(state.brushSize, state.brushShape);
    const tool: StrokeTool = state.tool === "eraser" ? "eraser" : "brush";
    store.beginTransaction();
    const seen = new Set<string>();
    // The line starts after the anchor's footprint, which the previous stroke already painted.
    if (from) footprintCells([from], offsets, seen);
    this.#start({ kind: "paint", pointerId: e.pointerId, store, layerId: layer.id, value, grid, pick, tool, offsets, seen, count: 0, last: from });
    this.#paint([e]);
    if (recent) this.#pushRecent(recent);
  }

  #beginStamp(e: PointerEvent, clip: TileClip, start: CellPoint): void {
    const store = this.#host.scene?.store;
    if (!store) return;
    const saved = savedStamp(clip) !== null;
    const mapping = saved ? {} : mappingFor(store, clip);
    if (!saved && Object.keys(mapping).length === 0) return;
    store.beginTransaction();
    this.#start({ kind: "stamp", pointerId: e.pointerId, store, clip, mapping, saved, start, placed: new Set(), count: 0, last: null });
    this.#paint([e]);
  }

  #paint(events: readonly PointerEvent[]): void {
    const g = this.#gesture;
    if (!g || (g.kind !== "paint" && g.kind !== "stamp")) return;
    const doc = g.store.document;
    const samples: CellPoint[] = [];
    for (const ev of events) {
      const c = this.#host.camera.cellAt(this.#host.toLocal(ev));
      if (c) samples.push(c);
    }
    const cells = strokeCells(g.last, samples);
    g.last = samples[samples.length - 1] ?? g.last;

    if (g.kind === "stamp") {
      let changed = false;
      try {
        for (const o of stampOrigins(g.start, cells, g.clip.width, g.clip.height, g.placed)) {
          if (g.saved) {
            const r = placeStamp(g.store, g.clip, o.x, o.y);
            for (const p of r.patches) g.count += patchCellCount(p);
            if (r.patches.length > 0 || r.createdLayerIds.length > 0) changed = true;
          } else {
            const patches = pasteClip(g.store, g.clip, g.mapping, o.x, o.y);
            for (const p of patches) g.count += patchCellCount(p);
            if (patches.length > 0) changed = true;
          }
        }
      } catch (error) {
        console.error("[canvas] stamp failed", error);
        this.cancel();
        return;
      }
      if (changed) this.#markDirty();
      return;
    }

    const layer = doc.getLayer(g.layerId);
    if (!layer) return;
    // Every stroke cell stamps the brush footprint; cells already covered by this stroke are skipped.
    const covered = footprintCells(cells, g.offsets, g.seen);
    const getCell = (x: number, y: number) => layer.getCell(x, y);
    let changed: number;
    try {
      if (g.grid) changed = this.#paintGrid(g.store, g.layerId, gridWrites(covered, g.value, doc.map, getCell));
      else if (g.pick) {
        const writes: CellWrite[] = [];
        for (const { x, y } of covered) {
          if (!doc.inBounds(x, y)) continue;
          const v = g.pick(x, y);
          if (getCell(x, y) !== v) writes.push({ x, y, cell: v });
        }
        changed = this.#paintCells(g.store, g.layerId, writes);
      } else {
        changed = this.#paintCells(g.store, g.layerId, cellWrites(covered, g.value, doc.map.width, doc.map.height, getCell));
      }
    } catch (error) {
      console.error("[canvas] paint failed", error);
      this.cancel();
      return;
    }
    g.count += changed;
    if (changed > 0) this.#markDirty();
  }

  // ------------------------------------------------------------------ entities

  /**
   * Entity tool / select tool on an entity layer. A click on an entity of the
   * active layer selects it and starts a drag; with the entity tool a click
   * on empty space adds an entity of the chosen type at that cell (the spawn
   * point, of which a level has one, moves there instead). Returns false when
   * the select tool should run its marquee (click on empty space).
   */
  #entityDown(e: PointerEvent, cell: CellPoint): boolean {
    const store = this.#host.scene?.store;
    const layer = this.#activeLayer();
    if (!store || !isEntityLayer(layer) || !layer.visible) return false;
    const s = useEditorStore.getState();
    const hit = this.#host.entities.hitTest(layer, this.#host.toLocal(e));
    if (hit) {
      if (s.selectedEntityId !== hit.id) s.setSelectedEntity(hit.id);
      this.#start({
        kind: "entity",
        pointerId: e.pointerId,
        store,
        entityId: hit.id,
        start: { x: hit.x, y: hit.y },
        grab: cell,
        movable: !layer.locked,
      });
      return true;
    }
    if (s.tool !== "entity") {
      if (s.selectedEntityId) s.setSelectedEntity(null);
      return false;
    }
    const doc = store.document;
    const typeId = s.entityTypeId;
    if (!typeId || !doc.getEntityType(typeId) || !doc.inBounds(cell.x, cell.y)) return true;
    // The UI's action owns the rules (one spawn per level, locked layer) and their toasts; it selects the new entity.
    if (placeEntity(layer.id, typeId, cell.x, cell.y) !== null) this.#markDirty();
    return true;
  }

  /** Moves the dragged entity to the cell under the pointer (one transaction per drag). */
  #dragEntity(g: Extract<Gesture, { kind: "entity" }>): void {
    if (!g.movable) return;
    const cell = this.#host.pointerCell();
    const doc = g.store.document;
    const found = doc.findEntity(g.entityId);
    if (!cell || !found) return;
    const to = dragPosition(g.start, g.grab, cell, doc.map);
    if (to.x === found.entity.x && to.y === found.entity.y) return;
    // Consecutive moves share one transaction: the whole drag is one undo step.
    if (!g.store.inTransaction) g.store.beginTransaction();
    if (!moveEntityToCell(g.entityId, Math.floor(to.x / doc.map.tileWidth), Math.floor(to.y / doc.map.tileHeight))) {
      this.cancel();
      return;
    }
    this.#markDirty();
  }
}
