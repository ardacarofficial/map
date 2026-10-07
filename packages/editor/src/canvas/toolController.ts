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
 */
import {
  EMPTY_CELL,
  SPAWN_TYPE_ID,
  cellFlags,
  cellPaletteIndex,
  copyRegion,
  floodFill,
  isEntityLayer,
  isGridLayer,
  isTileLayer,
  makeCell,
  pasteClip,
  placeStamp,
  type CellPoint,
  type CellWrite,
  type GridLayer,
  type GridWrite,
  type MapStore,
  type TileClip,
  type TileLayer,
} from "@smap/core";

import { useEditorStore } from "../state/editorStore";
import { cellWrites, strokeCells } from "./brush";
import type { Point } from "./camera";
import type { CameraController } from "./cameraController";
import { dragPosition, snapToCell, type WorldPoint } from "./entityLogic";
import type { EntityRenderer } from "./entityRenderer";
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
      last: CellPoint | null;
    }
  | { readonly kind: "rect"; readonly pointerId: number; readonly start: CellPoint; end: CellPoint }
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
  readonly #host: ToolHost;

  constructor(host: ToolHost) {
    this.#host = host;
  }

  get gesture(): Gesture | null {
    return this.#gesture;
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
        else this.#beginPaint(e);
        break;
      case "eraser":
        this.#beginPaint(e);
        break;
      case "fill":
        this.#fillAt(cell);
        break;
      case "rect": {
        const info = this.#activeInfo();
        if (grid ? isGridEditable(info) : isEditable(info) && (s.stamp || s.selection)) {
          this.#start({ kind: "rect", pointerId: e.pointerId, start: cell, end: cell });
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
    if ((g.kind === "paint" || g.kind === "stamp" || g.kind === "entity") && g.store.inTransaction) g.store.commit();
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
      case "entity":
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
    this.#host.release(g.pointerId);
    this.#host.requestRender();
  }

  // ------------------------------------------------------------------ helpers

  #activeLayer(): TileLayer | undefined {
    return activeLayer(this.#host.scene?.store);
  }

  #activeInfo() {
    const layer = this.#activeLayer();
    return layer ? layerInfo(layer) : undefined;
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

  /** Active layer when the paint tools may write to it (tile or grid layer). */
  #editTarget(): { store: MapStore; layer: TileLayer } | null {
    const store = this.#host.scene?.store;
    const layer = this.#activeLayer();
    if (!store || !layer || !isPaintable(layerInfo(layer))) return null;
    return { store, layer };
  }

  /** Grid value the current tool writes on `layer`, or null when it cannot paint. */
  #gridValue(layer: GridLayer): number | null {
    const s = useEditorStore.getState();
    return gridPaintValue(s.tool, s.gridValue, layer.maxValue);
  }

  /** Dispatches grid writes inside the open transaction; true when something changed. */
  #paintGrid(store: MapStore, layerId: string, cells: GridWrite[]): boolean {
    if (cells.length === 0) return false;
    return store.dispatch({ type: "paintTerrain", layerId, cells }).cells.length > 0;
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
      if (writes.length > 0) this.#transact(store, () => this.#paintGrid(store, layer.id, writes));
      return;
    }
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
    if (isGridLayer(layer)) {
      const value = this.#gridValue(layer);
      if (value === null) return;
      const writes = gridRectWrites(r, value, (x, y) => layer.getCell(x, y));
      if (writes.length > 0) this.#transact(store, () => this.#paintGrid(store, layer.id, writes));
      return;
    }
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
    // On a grid layer a single-cell pick takes the painted value.
    const active = this.#activeLayer();
    if (isGridLayer(active) && r.width === 1 && r.height === 1) {
      const value = active.getCell(r.x, r.y);
      if (value !== 0) {
        s.setGridValue(value);
        if (s.tool === "eraser" || s.tool === "select" || s.tool === "eyedropper") s.setTool("brush");
        return;
      }
    }
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

  // ------------------------------------------------------------------ strokes

  #beginPaint(e: PointerEvent): void {
    const state = useEditorStore.getState();
    const t = this.#editTarget();
    if (!t) return;
    const { store, layer } = t;
    let value: number;
    let pick: ((x: number, y: number) => number) | null = null;
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
    }
    store.beginTransaction();
    this.#start({ kind: "paint", pointerId: e.pointerId, store, layerId: layer.id, value, grid, pick, last: null });
    this.#paint([e]);
  }

  #beginStamp(e: PointerEvent, clip: TileClip, start: CellPoint): void {
    const store = this.#host.scene?.store;
    if (!store) return;
    const saved = savedStamp(clip) !== null;
    const mapping = saved ? {} : mappingFor(store, clip);
    if (!saved && Object.keys(mapping).length === 0) return;
    store.beginTransaction();
    this.#start({ kind: "stamp", pointerId: e.pointerId, store, clip, mapping, saved, start, placed: new Set(), last: null });
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
            if (r.patches.length > 0 || r.createdLayerIds.length > 0) changed = true;
          } else if (pasteClip(g.store, g.clip, g.mapping, o.x, o.y).length > 0) changed = true;
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
    const getCell = (x: number, y: number) => layer.getCell(x, y);
    let changed: boolean;
    try {
      if (g.grid) changed = this.#paintGrid(g.store, g.layerId, gridWrites(cells, g.value, doc.map, getCell));
      else if (g.pick) {
        const writes: CellWrite[] = [];
        for (const { x, y } of cells) {
          if (!doc.inBounds(x, y)) continue;
          const v = g.pick(x, y);
          if (getCell(x, y) !== v) writes.push({ x, y, cell: v });
        }
        changed = writes.length > 0 && g.store.dispatch({ type: "paintCells", layerId: g.layerId, cells: writes }).cells.length > 0;
      } else {
        const writes = cellWrites(cells, g.value, doc.map.width, doc.map.height, getCell);
        changed = writes.length > 0 && g.store.dispatch({ type: "paintCells", layerId: g.layerId, cells: writes }).cells.length > 0;
      }
    } catch (error) {
      console.error("[canvas] paint failed", error);
      this.cancel();
      return;
    }
    if (changed) this.#markDirty();
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
    if (layer.locked || !typeId || !doc.getEntityType(typeId) || !doc.inBounds(cell.x, cell.y)) return true;
    const pos = snapToCell(cell, doc.map);
    let id: string | null = null;
    this.#transact(store, () => {
      const spawn = typeId === SPAWN_TYPE_ID ? doc.spawn() : null;
      if (spawn) {
        store.dispatch({ type: "moveEntity", entityId: spawn.id, x: pos.x, y: pos.y });
        id = spawn.id;
        return true;
      }
      id = store.dispatch({ type: "addEntity", layerId: layer.id, entity: { typeId, x: pos.x, y: pos.y } });
      return id !== null;
    });
    if (id !== null) s.setSelectedEntity(id);
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
    try {
      if (!g.store.inTransaction) g.store.beginTransaction();
      g.store.dispatch({ type: "moveEntity", entityId: g.entityId, x: to.x, y: to.y });
    } catch (error) {
      console.error("[canvas] move entity failed", error);
      this.cancel();
      return;
    }
    this.#markDirty();
  }
}
