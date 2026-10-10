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
 * document seed; round 4: core `RandomSet` with stamp candidates, scatter,
 * random flip and chunks, see `randomBrushSource`); on an entity layer the entity tool (and the select tool)
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
  makeCell,
  moveRegion,
  pasteClip,
  patchCellCount,
  placeStamp,
  type CellPoint,
  type CellWrite,
  type GridLayer,
  type GridWrite,
  type MapStore,
  type RandomSet,
  type TileClip,
  type TileLayer,
} from "@smap/core";

import { moveEntityToCell, placeEntity } from "../commands/entityActions";
import { useEditorStore, type CellRegion, type TileSelection, type ToolId } from "../state/editorStore";
import { isRecentStamp, recentOfClip } from "../state/recentItems";
import { cellWrites, strokeCells } from "./brush";
import type { Point } from "./camera";
import {
  gridPickEvent,
  pickEvent,
  recentTileOf,
  strokeSummary,
  type BlockedAction,
  type CanvasContextRequest,
  type CanvasPickEvent,
  type StrokeSummary,
  type StrokeTool,
} from "./canvasEvents";
import type { CameraController } from "./cameraController";
import { dragPosition, type WorldPoint } from "./entityLogic";
import type { EntityRenderer } from "./entityRenderer";
import { brushFootprint, constrainRect, footprintCells, type RectModifiers } from "./footprint";
import { gridFillWrites, gridPaintValue, gridRectWrites, gridWrites } from "./gridPaint";
import { activeLayer, layerInfo, mappingFor, savedStamp } from "./layerAccess";
import type { MapScene } from "./mapScene";
import { activeRandomSet, hasRandomBrush, randomStampOf } from "./randomBrushSource";
import { planRandomPaint } from "./randomPaint";
import {
  blockedReason,
  decidePick,
  dragRegion,
  isEditable,
  isEmptyGridPick,
  isGridEditable,
  isPaintable,
  missingBrush,
  moveOffset,
  movedRegion,
  patternCell,
  patternLayerIndex,
  regionContains,
  rightPressAction,
  rightReleaseAction,
  stampOrigins,
  toolAfterPick,
  type LayerState,
  type RightPress,
} from "./tools";

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
      /** Random brush (overrides `value`), or null; `placed` = stamp anchors this stroke already placed. */
      readonly random: { readonly set: RandomSet; readonly placed: Set<string> } | null;
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
  | {
      readonly kind: "pick";
      readonly pointerId: number;
      readonly button: number;
      readonly start: CellPoint;
      end: CellPoint;
      /** Right press: what it asks for (menu presses turn into a pick / nothing when dragged). */
      readonly press?: RightPress;
      /** Entity under a right press on an entity layer. */
      readonly entityId?: string | undefined;
      /** Client (page) position of the press, for a context menu. */
      readonly client?: Point;
      /** The temporary (Alt) eyedropper was active at the press: the pick does not switch tools. */
      readonly spring: boolean;
    }
  | {
      /** Select tool: the selection's content is dragged (live, rolled back and redone per cell). */
      readonly kind: "move";
      readonly pointerId: number;
      readonly store: MapStore;
      readonly layerId: string;
      /** The selection when the drag started. */
      readonly region: CellRegion;
      readonly grab: CellPoint;
      dx: number;
      dy: number;
    }
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
  /** Tool active before the eyedropper was chosen: an eyedropper pick returns to it (brush / fill / rectangle). */
  toolBeforeEyedropper?(): ToolId | null;
  /** Something was picked from the map. */
  picked?(event: CanvasPickEvent): void;
  /** An edit gesture finished as one undo step. */
  strokeCommitted?(summary: StrokeSummary): void;
  /** Briefly outline `region` (pick feedback). */
  flash?(region: CellRegion): void;
  /** A left press could not do anything on the active layer (see `blockedReason`). */
  blocked?(action: BlockedAction): void;
  /** A right click asks for a context menu (entity / selection). */
  contextRequest?(request: CanvasContextRequest): void;
}

/** Tool view of a layer for {@link blockedReason}. */
export function layerState(layer: TileLayer, _doc?: { readonly layers: readonly TileLayer[] }): LayerState {
  return {
    kind: isEntityLayer(layer) ? "entity" : isGridLayer(layer) ? "grid" : "tile",
    visible: layer.visible,
    locked: layer.locked,
  };
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
      this.#rightDown(e, cell);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    const s = useEditorStore.getState();
    const active = this.#activeLayer();
    const grid = isGridLayer(active);
    if (this.#reportBlocked(s.tool) || this.#reportMissingBrush()) return;
    if ((s.tool === "entity" || s.tool === "select") && isEntityLayer(active)) {
      if (this.#entityDown(e, cell) || s.tool === "entity") {
        this.#host.requestRender();
        return;
      }
    }
    if (s.tool === "select" && s.region && regionContains(s.region, cell)) {
      this.#beginMove(e, s.region, cell);
      this.#host.requestRender();
      return;
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
        if (grid ? isGridEditable(info) : isEditable(info) && (s.stamp || s.selection || hasRandomBrush())) {
          this.#start({ kind: "rect", pointerId: e.pointerId, start: cell, end: cell, square: e.shiftKey, fromCenter: e.altKey });
        }
        break;
      }
      case "select":
        this.#start({ kind: "select", pointerId: e.pointerId, start: cell, end: cell, moved: false });
        break;
      case "eyedropper":
        this.#start({ kind: "pick", pointerId: e.pointerId, button: 0, start: cell, end: cell, spring: this.#host.springActive?.() ?? false });
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
    } else if (g.kind === "move") {
      this.#dragMove(g);
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
    else if (g.kind === "move") this.#dragMove(g);
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
    return !!g && (g.kind === "rect" || g.kind === "select" || g.kind === "entity" || g.kind === "move" || (g.kind === "pick" && g.button === 0));
  }

  /** Ends without applying drags; keeps what a stroke already painted (lost capture, project change). */
  end(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    if ((g.kind === "paint" || g.kind === "stamp" || g.kind === "entity" || g.kind === "move") && g.store.inTransaction) {
      g.store.commit();
      if (g.kind === "move") this.#moveDone(g);
      else if (g.kind !== "entity") this.#strokeDone(g);
    }
    this.#host.release(g.pointerId);
    this.#host.requestRender();
  }

  /** Cancels the gesture; a stroke is rolled back. */
  cancel(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    if ((g.kind === "paint" || g.kind === "stamp" || g.kind === "entity" || g.kind === "move") && g.store.inTransaction) g.store.rollback();
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
      case "move":
        if (g.store.inTransaction) {
          g.store.commit();
          this.#moveDone(g);
        }
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
        this.#finishRight(g);
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
    if (head && !isRecentStamp(head) && head.tilesetId === tile.tilesetId && head.tileId === tile.tileId) return;
    s.pushRecentTile({ tilesetId: tile.tilesetId, tileId: tile.tileId });
  }

  /** Adds a used stamp (or the single tile it holds) to the recent strip. */
  #pushRecentClip(clip: TileClip): void {
    const s = useEditorStore.getState();
    const head = s.recentTiles[0];
    if (head && isRecentStamp(head) && head.stamp === clip) return;
    const item = recentOfClip(clip);
    if (item) s.pushRecentItem(item);
  }

  /** The brush stamp, when fill / rectangle just painted with it (not a random set). */
  #pushUsedStamp(): void {
    const s = useEditorStore.getState();
    if (s.stamp && !hasRandomBrush()) this.#pushRecentClip(s.stamp);
  }

  /** The selected single tile when the fill / rectangle tools paint it (no stamp, no random set). */
  #singleTile(): TileSelection | null {
    const s = useEditorStore.getState();
    if (s.stamp || hasRandomBrush() || !s.selection) return null;
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
    const sel = s.selection;
    if (!sel || !store.document.getTileset(sel.tilesetId)) return null;
    const value = makeCell(store.getOrAddPaletteIndex(sel.tilesetId, sel.tileId));
    return () => value;
  }

  /** The random set the paint tools use on the active layer now (tile layers only), or null. */
  #randomSet(): RandomSet | null {
    const s = useEditorStore.getState();
    if (s.stamp) return null;
    return activeRandomSet(this.#host.scene?.store.document, this.#activeLayer());
  }

  /**
   * Applies the random brush to `cells` (inside the open transaction):
   * tile candidates are written to `layerId`, stamp candidates placed with
   * `placeStamp` at their anchors (once per anchor: `placed`), scattered
   * cells are left alone. Returns the changed cell count.
   */
  #paintRandom(store: MapStore, layerId: string, set: RandomSet, cells: Iterable<CellPoint>, placed: Set<string>): number {
    const doc = store.document;
    const layer = doc.getLayer(layerId);
    if (!layer) return 0;
    const inside: CellPoint[] = [];
    for (const c of cells) if (doc.inBounds(c.x, c.y)) inside.push(c);
    const plan = planRandomPaint(set, doc.seed, inside, placed);
    const writes: CellWrite[] = [];
    for (const t of plan.tiles) {
      const v = makeCell(store.getOrAddPaletteIndex(t.tilesetId, t.tileId), t.flags);
      if (layer.getCell(t.x, t.y) !== v) writes.push({ x: t.x, y: t.y, cell: v });
    }
    let changed = this.#paintCells(store, layerId, writes);
    // Stamps after the tiles of the same batch, so a stamp is not cut by its neighbours' tiles.
    for (const p of plan.stamps) {
      const stamp = randomStampOf(p.stampId);
      if (!stamp) continue;
      const r = placeStamp(store, stamp, p.x, p.y, { flip: p.flip });
      for (const patch of r.patches) changed += patchCellCount(patch);
      changed += r.createdLayerIds.length;
    }
    return changed;
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
    const random = this.#randomSet();
    if (random) {
      this.#transact(store, "fill", () => this.#paintRandom(store, layer.id, random, points, new Set()));
      return;
    }
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
    else this.#pushUsedStamp();
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
    const random = this.#randomSet();
    if (random) {
      this.#transact(store, tool, () => this.#paintRandom(store, layer.id, random, rectCells(r), new Set()));
      return;
    }
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
    else this.#pushUsedStamp();
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

  #finishPick(start: CellPoint, end: CellPoint, spring: boolean): void {
    const doc = this.#host.scene?.store.document;
    if (!doc) return;
    const r = dragRegion(start, end, doc.map);
    if (!r) return;
    const s = useEditorStore.getState();
    // Tools that cannot place the pick switch (see `toolAfterPick`); the Alt eyedropper decided at the press.
    const switchTool = () => {
      const st = useEditorStore.getState();
      const next = toolAfterPick(st.tool, this.#host.toolBeforeEyedropper?.() ?? null, spring);
      if (next && next !== st.tool) st.setTool(next);
    };
    // On a grid layer a single-cell pick takes the painted value.
    const active = this.#activeLayer();
    if (isGridLayer(active) && r.width === 1 && r.height === 1) {
      // An empty grid cell picks nothing (not the tiles under it); drag for an area.
      if (isEmptyGridPick(r, (x, y) => active.getCell(x, y))) return;
      const value = active.getCell(r.x, r.y);
      s.setGridValue(value);
      switchTool();
      this.#picked(gridPickEvent(value, r));
      return;
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
    let random: { set: RandomSet; placed: Set<string> } | null = null;
    let recent: TileSelection | null = null;
    const grid = isGridLayer(layer);
    if (grid) {
      const v = this.#gridValue(layer);
      if (v === null) return;
      value = v;
    } else if (state.tool === "eraser") value = EMPTY_CELL;
    else if (hasRandomBrush()) {
      const set = this.#randomSet();
      if (!set) return;
      random = { set, placed: new Set() };
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
    this.#start({ kind: "paint", pointerId: e.pointerId, store, layerId: layer.id, value, grid, random, tool, offsets, seen, count: 0, last: from });
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
    this.#pushRecentClip(clip);
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
      else if (g.random) changed = this.#paintRandom(g.store, g.layerId, g.random.set, covered, g.random.placed);
      else {
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

  // ------------------------------------------------------------------ blocked, right click

  /** Emits a blocked action (and returns true) when `tool` cannot act on the active layer. */
  #reportBlocked(tool: ToolId | "move"): boolean {
    const layer = this.#activeLayer();
    const doc = this.#host.scene?.store.document;
    if (!layer || !doc) return false;
    const s = useEditorStore.getState();
    const reason = blockedReason(tool, layerState(layer, doc), tool === "brush" && savedStamp(s.stamp) !== null);
    if (!reason) return false;
    this.#host.blocked?.({ reason, layerId: layer.id });
    this.#host.requestRender();
    return true;
  }

  /**
   * Brush / fill / rectangle on a tile layer with nothing chosen to paint:
   * says so ("Önce bir tile seç") instead of doing nothing silently.
   */
  #reportMissingBrush(): boolean {
    const layer = this.#activeLayer();
    const doc = this.#host.scene?.store.document;
    if (!layer || !doc || isEntityLayer(layer)) return false;
    const s = useEditorStore.getState();
    const missing = missingBrush(s.tool, {
      grid: isGridLayer(layer),
      stamp: s.stamp !== null,
      tile: !!s.selection && doc.getTileset(s.selection.tilesetId) !== undefined,
      random: hasRandomBrush(),
    });
    if (!missing) return false;
    this.#host.blocked?.({ reason: "noBrush", layerId: layer.id });
    this.#host.requestRender();
    return true;
  }

  /** Eraser right drag: clears `r` on the active layer (tiles, or grid values) as one undo step. */
  #eraseRegion(r: CellRegion): void {
    const t = this.#editTarget();
    if (!t) return;
    const { store, layer } = t;
    if (isGridLayer(layer)) {
      const writes = gridRectWrites(r, 0, (x, y) => layer.getCell(x, y));
      if (writes.length > 0) this.#transact(store, "eraser", () => this.#paintGrid(store, layer.id, writes));
      return;
    }
    const cells: CellWrite[] = [];
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) if (layer.getCell(x, y) !== EMPTY_CELL) cells.push({ x, y, cell: EMPTY_CELL });
    }
    if (cells.length > 0) this.#transact(store, "eraser", () => this.#paintCells(store, layer.id, cells));
  }

  /** Right press: pick, eraser rectangle, or a context menu request on release (entity / selection). */
  #rightDown(e: PointerEvent, cell: CellPoint): void {
    const s = useEditorStore.getState();
    const layer = this.#activeLayer();
    let entityId: string | undefined;
    if (isEntityLayer(layer) && layer.visible) entityId = this.#host.entities.hitTest(layer, this.#host.toLocal(e))?.id;
    const press = rightPressAction({
      layer: layer ? layerState(layer, undefined).kind : null,
      tool: s.tool,
      inRegion: regionContains(s.region, cell),
      entityHit: entityId !== undefined,
    });
    if (press === "none") return;
    // The eraser's right drag erases a rectangle: say why up front when the layer takes no edits.
    if (press === "eraseRect" && this.#reportBlocked("eraser")) return;
    const spring = this.#host.springActive?.() ?? false;
    this.#start({ kind: "pick", pointerId: e.pointerId, button: 2, start: cell, end: cell, press, entityId, client: { x: e.clientX, y: e.clientY }, spring });
  }

  /** Release of a pick gesture (right button or eyedropper). */
  #finishRight(g: Extract<Gesture, { kind: "pick" }>): void {
    const moved = g.start.x !== g.end.x || g.start.y !== g.end.y;
    const action = rightReleaseAction(g.press ?? "pick", moved);
    const client = g.client ?? { x: 0, y: 0 };
    if (action === "pick") this.#finishPick(g.start, g.end, g.spring);
    else if (action === "eraseRect") {
      const map = this.#host.scene?.store.document.map;
      const r = map ? dragRegion(g.start, g.end, map) : null;
      if (r) this.#eraseRegion(r);
    } else if (action === "entityMenu" && g.entityId) {
      const s = useEditorStore.getState();
      if (s.selectedEntityId !== g.entityId) s.setSelectedEntity(g.entityId);
      this.#host.contextRequest?.({ kind: "entity", entityId: g.entityId, x: client.x, y: client.y });
    } else if (action === "selectionMenu") {
      this.#host.contextRequest?.({ kind: "selection", x: client.x, y: client.y });
    }
  }

  // ------------------------------------------------------------------ selection move

  /** Select tool, press inside the selection: drag its content (active layer). */
  #beginMove(e: PointerEvent, region: CellRegion, cell: CellPoint): void {
    const store = this.#host.scene?.store;
    const layer = this.#activeLayer();
    if (!store || !layer || this.#reportBlocked("move")) return;
    store.beginTransaction();
    this.#start({ kind: "move", pointerId: e.pointerId, store, layerId: layer.id, region: { ...region }, grab: cell, dx: 0, dy: 0 });
  }

  /** Redoes the move for the cell under the pointer (the open transaction is rolled back first). */
  #dragMove(g: Extract<Gesture, { kind: "move" }>): void {
    const cell = this.#host.pointerCell();
    if (!cell) return;
    const map = g.store.document.map;
    const off = moveOffset(g.region, g.grab, cell, map);
    if (off.x === g.dx && off.y === g.dy) return;
    g.dx = off.x;
    g.dy = off.y;
    if (g.store.inTransaction) g.store.rollback();
    g.store.beginTransaction();
    if (g.dx === 0 && g.dy === 0) return;
    try {
      moveRegion(g.store, [g.layerId], g.region, g.dx, g.dy);
    } catch (error) {
      console.error("[canvas] move failed", error);
      this.cancel();
      return;
    }
    this.#markDirty();
    this.#host.requestRender();
  }

  /** After a move's commit: the selection follows its content. */
  #moveDone(g: Extract<Gesture, { kind: "move" }>): void {
    if (g.dx === 0 && g.dy === 0) return;
    const map = g.store.document.map;
    useEditorStore.getState().setRegion(movedRegion(g.region, g.dx, g.dy, map));
  }

  /**
   * Arrow keys with the select tool: moves the selection's content by
   * (`dx`, `dy`) cells on the active layer as one undo step. False when
   * there is nothing to move (no selection, a gesture running, blocked).
   */
  nudgeSelection(dx: number, dy: number): boolean {
    const s = useEditorStore.getState();
    const store = this.#host.scene?.store;
    const layer = this.#activeLayer();
    const region = s.region;
    if (this.#gesture || s.tool !== "select" || !region || !store || !layer) return false;
    if (this.#reportBlocked("move")) return true;
    const map = store.document.map;
    const off = moveOffset(region, { x: 0, y: 0 }, { x: dx, y: dy }, map);
    if (off.x === 0 && off.y === 0) return true;
    try {
      moveRegion(store, [layer.id], region, off.x, off.y);
    } catch (error) {
      console.error("[canvas] move failed", error);
      return true;
    }
    this.#markDirty();
    s.setRegion(movedRegion(region, off.x, off.y, map));
    this.#host.requestRender();
    return true;
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

/** The cells of `r`, row by row. */
function* rectCells(r: CellRegion): Generator<CellPoint> {
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) yield { x, y };
}
