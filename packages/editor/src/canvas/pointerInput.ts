import { activeSmartStamp, useSmartStampSession } from "../ui/stamps/smartStampSession";
/**
 * DOM input of the map canvas: pointer events (routed to panning or the
 * tool controller), wheel zoom / pan, Space-to-pan, Esc-to-cancel, the
 * hovered cell (reported to the status bar) and the CSS cursor.
 *
 * Modifier keys: holding Alt over the canvas is a temporary eyedropper
 * (`springKey.ts`; a tap does nothing and never focuses the browser / OS
 * menu); Shift shows the Shift + click line preview and, with Alt, shapes a
 * rectangle drag (square / from the centre).
 */
import type { CellPoint, MapInfo } from "@smap/core";

import { commandForEvent } from "../commands/registry";
import { useEditorStore } from "../state/editorStore";
import { classifyWheel } from "./brush";
import { wheelDeltaPixels, wheelZoomFactor, wheelZoomSteps, type Point } from "./camera";
import type { CameraController } from "./cameraController";
import { SPRING_HOLD_MS, SPRING_IDLE, springStep, type SpringEvent, type SpringState } from "./springKey";
import type { ToolController } from "./toolController";
import { cursorFor, nudgeOffset, suppressedCommandKey } from "./tools";

/** How long a pan gesture "sticks" for following wheel events. */
const PAN_GESTURE_MS = 250;
/** Small wheel deltas add up to a zoom step until the wheel pauses this long. */
const WHEEL_ACC_RESET_MS = 200;

interface Pan {
  readonly pointerId: number;
  lastX: number;
  lastY: number;
}

/** Pointer routing of the world map view (v1.2), see `worldView.ts`. */
export interface WorldInput {
  /** True while a level is pressed / dragged. */
  readonly busy: boolean;
  /** Left press; false when no level is under the pointer (the input pans instead). */
  pointerDown(e: PointerEvent, p: Point): boolean;
  pointerMove(e: PointerEvent, p: Point): void;
  pointerUp(e: PointerEvent, p: Point): void;
  altChanged(alt: boolean): void;
  cancel(): void;
  /** CSS cursor, or null for the default one. */
  cursor(): string | null;
}

export interface InputHost {
  /** The world view's input while it is shown, else null (level view: tools). */
  world(): WorldInput | null;
  readonly camera: CameraController;
  /** Bring a pending layout resize into the camera before converting coordinates. */
  syncRect?(): DOMRect;
  readonly tools: ToolController;
  map(): MapInfo | undefined;
  /** The active layer can be painted (cursor shows "not-allowed" otherwise). */
  paintable(): boolean;
  /** Entity cursor state (see `CursorInput.entity`). */
  entityCursor(): "over" | "drag" | "blocked" | null;
  /** Select tool: pointer over the selection / moving it (see `CursorInput.region`). */
  regionCursor(): "over" | "moving" | null;
  /** Double click at a canvas point (CSS px): portals open their target. */
  doubleClick(p: Point): void;
  requestRender(): void;
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}

export class PointerInput {
  /** Pointer position in canvas CSS px, or null when outside. */
  pointer: Point | null = null;
  #canvasRect: DOMRect | null = null;
  #spaceDown = false;
  #shiftDown = false;
  #altDown = false;
  #spring: SpringState = SPRING_IDLE;
  #springTimer: ReturnType<typeof setTimeout> | null = null;
  #pan: Pan | null = null;
  #lastPanWheel = -Infinity;
  #wheelAcc = 0;
  #lastZoomWheel = -Infinity;
  #hover: CellPoint | null = null;
  readonly #canvas: HTMLCanvasElement;
  readonly #host: InputHost;

  constructor(canvas: HTMLCanvasElement, host: InputHost) {
    this.#canvas = canvas;
    this.#host = host;
  }

  get panning(): boolean {
    return this.#pan !== null;
  }

  /** The hand tool is chosen: a left drag pans (level and world view). */
  #handTool(): boolean {
    return useEditorStore.getState().tool === "hand";
  }

  /** Shift is held (line preview of brush / eraser). */
  get shiftDown(): boolean {
    return this.#shiftDown;
  }

  /** Alt is holding the temporary eyedropper. */
  get springActive(): boolean {
    return this.#spring.phase === "active";
  }

  /** Hovered map cell (inside the map), updated by {@link updateHover}. */
  get hover(): CellPoint | null {
    return this.#hover;
  }

  /** Hovered map cell for cursors and previews, or null while panning / off the map. */
  cursorCell(): CellPoint | null {
    if (!this.pointer || this.#pan || this.#spaceDown || this.#handTool()) return null;
    return this.#hover;
  }

  /** Cell under the pointer, also outside the map (drags), or null without a pointer. */
  pointerCell(): CellPoint | null {
    return this.pointer ? this.#host.camera.cellAt(this.pointer) : null;
  }

  /** Canvas bounding rect (cached until resize / scroll / pointer down). */
  rect(): DOMRect {
    return (this.#canvasRect ??= this.#host.syncRect?.() ?? this.#canvas.getBoundingClientRect());
  }

  invalidateRect(): void {
    this.#canvasRect = null;
  }

  toLocal(e: { clientX: number; clientY: number }): Point {
    const r = this.rect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  attach(signal: AbortSignal): void {
    const c = this.#canvas;
    const opts = { signal };
    c.addEventListener("pointerdown", (e) => this.#onPointerDown(e), opts);
    c.addEventListener("pointermove", (e) => this.#onPointerMove(e), opts);
    c.addEventListener("pointerup", (e) => this.#onPointerUp(e), opts);
    c.addEventListener("pointercancel", (e) => this.#onPointerEnd(e), opts);
    c.addEventListener("lostpointercapture", (e) => this.#onPointerEnd(e), opts);
    c.addEventListener("pointerenter", (e) => this.#setPointer(e), opts);
    c.addEventListener("pointerleave", () => {
      if (this.#host.tools.gesture || this.#pan || this.#host.world()?.busy) return;
      this.pointer = null;
      this.#host.requestRender();
    }, opts);
    c.addEventListener("wheel", (e) => this.#onWheel(e), { signal, passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault(), opts);
    c.addEventListener("dblclick", (e) => {
      if (e.button !== 0 || this.#pan || this.#spaceDown || this.#host.world()) return;
      this.#host.doubleClick(this.toLocal(e));
    }, opts);
    // Middle-button autoscroll (Windows) and text selection.
    c.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    }, opts);
    c.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    }, opts);
    window.addEventListener("keydown", (e) => this.#onKey(e, true), opts);
    // Capture phase: runs before the global shortcut handler, which skips prevented events.
    window.addEventListener("keydown", (e) => this.#onEscape(e), { signal, capture: true });
    window.addEventListener("keydown", (e) => this.#onArrow(e), { signal, capture: true });
    window.addEventListener("keydown", (e) => this.#onCommandKey(e), { signal, capture: true });
    window.addEventListener("keyup", (e) => this.#onKey(e, false), opts);
    window.addEventListener("blur", () => {
      // Focus left the window mid-gesture (Alt+Tab, a dialog): the pointer-up may never come.
      if (this.#host.tools.gesture) this.#host.tools.end();
      if (this.#pan) this.#endPan();
      this.#spaceDown = false;
      this.#setModifiers(false, false);
      this.#feedSpring({ type: "reset" });
      this.updateCursor();
    }, opts);
    signal.addEventListener("abort", () => this.#clearSpringTimer());
    window.addEventListener("scroll", () => (this.#canvasRect = null), { signal, capture: true, passive: true });
    this.updateCursor();
  }

  /** Recomputes the hovered cell and reports changes to the editor store. */
  updateHover(): void {
    const map = this.#host.map();
    let cell: CellPoint | null = null;
    if (map && this.pointer && !this.#host.world()) {
      const c = this.#host.camera.cellAt(this.pointer);
      if (c && c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height) cell = c;
    }
    const prev = this.#hover;
    if (prev === cell || (prev && cell && prev.x === cell.x && prev.y === cell.y)) return;
    this.#hover = cell;
    useEditorStore.getState().setHoverCell(cell ? { x: cell.x, y: cell.y } : null);
  }

  updateCursor(): void {
    const world = this.#host.world();
    if (world) {
      const c = this.#pan ? "grabbing" : this.#spaceDown || this.#handTool() ? "grab" : (world.cursor() ?? "default");
      if (this.#canvas.style.cursor !== c) this.#canvas.style.cursor = c;
      return;
    }
    const cursor = cursorFor({
      tool: useEditorStore.getState().tool,
      panning: this.#pan !== null,
      spaceDown: this.#spaceDown,
      hasMap: this.#host.map() !== undefined,
      overMap: this.#hover !== null,
      editable: this.#host.paintable(),
      entity: this.#pan || this.#spaceDown ? null : this.#host.entityCursor(),
      region: this.#pan || this.#spaceDown ? null : this.#host.regionCursor(),
    });
    if (this.#canvas.style.cursor !== cursor) this.#canvas.style.cursor = cursor;
  }

  capture(pointerId: number): void {
    try {
      this.#canvas.setPointerCapture(pointerId);
    } catch {
      // pointer already gone
    }
  }

  release(pointerId: number): void {
    try {
      if (this.#canvas.hasPointerCapture(pointerId)) this.#canvas.releasePointerCapture(pointerId);
    } catch {
      // ignore
    }
  }

  // ------------------------------------------------------------------ handlers

  #setPointer(e: PointerEvent): void {
    this.pointer = this.toLocal(e);
    this.#host.requestRender();
  }

  #onKey(e: KeyboardEvent, down: boolean): void {
    if (e.key === "Alt") {
      const world = this.#host.world();
      if (world) {
        if (world.busy) {
          // Keep the browser / OS from taking Alt (menu bar focus) during a drag.
          e.preventDefault();
          world.altChanged(down);
          this.updateCursor();
        }
        return;
      }
      this.#onAlt(e, down);
      return;
    }
    if (e.key === "Shift") {
      this.#setModifiers(down, this.#altDown);
      return;
    }
    // Alt + another key is a shortcut (Alt+Tab, ...), not a held eyedropper.
    if (down && e.altKey) this.#feedSpring({ type: "otherKey" });
    if (e.code !== "Space") return;
    if (down) {
      if (isEditableTarget(e.target)) return;
      // Only claim Space while the canvas is hovered or focused, so buttons elsewhere keep working.
      if (!this.pointer && document.activeElement !== this.#canvas && !this.#spaceDown) return;
      e.preventDefault();
      if (this.#spaceDown) return;
      this.#spaceDown = true;
    } else {
      if (!this.#spaceDown) return;
      this.#spaceDown = false;
    }
    this.updateCursor();
    this.#host.requestRender();
  }

  /** Alt over the level view: rectangle "from centre" during a drag, otherwise the temporary eyedropper. */
  #onAlt(e: KeyboardEvent, down: boolean): void {
    const hot = !isEditableTarget(e.target) && (this.pointer !== null || document.activeElement === this.#canvas);
    // A lone Alt would focus the browser / OS menu (Windows) and steal the next keys.
    if (hot) e.preventDefault();
    this.#setModifiers(this.#shiftDown, down);
    if (!down) {
      this.#feedSpring({ type: "up" });
      return;
    }
    if (!hot || !this.pointer || !this.#host.map()) return;
    if (useEditorStore.getState().tool === "select" && useEditorStore.getState().selectionMode === "connected") return;
    if (activeSmartStamp() && (useEditorStore.getState().tool === "rect" || useSmartStampSession.getState().usage === "area")) return;
    if (this.#spring.phase === "idle") this.#feedSpring({ type: "down", time: performance.now(), busy: this.#host.tools.gesture !== null || this.#pan !== null });
  }

  #setModifiers(shift: boolean, alt: boolean): void {
    if (shift === this.#shiftDown && alt === this.#altDown) return;
    this.#shiftDown = shift;
    this.#altDown = alt;
    this.#host.tools.setModifiers(shift, alt);
    this.#host.requestRender();
  }

  /** Runs the spring-key reducer and applies its tool change. */
  #feedSpring(event: SpringEvent): void {
    const store = useEditorStore.getState();
    const before = this.#spring;
    const { state, setTool } = springStep(before, event, store.tool);
    this.#spring = state;
    if (state.phase === "pending" && before.phase !== "pending") {
      this.#clearSpringTimer();
      const since = state.since;
      this.#springTimer = setTimeout(() => {
        this.#springTimer = null;
        this.#feedSpring({ type: "tick", time: Math.max(performance.now(), since + SPRING_HOLD_MS) });
      }, SPRING_HOLD_MS);
    } else if (state.phase !== "pending") this.#clearSpringTimer();
    if (setTool && setTool !== store.tool) {
      // A drag of the temporary eyedropper ends with it (the pick still applies).
      store.setTool(setTool);
    }
    if (state !== before) {
      this.updateCursor();
      this.#host.requestRender();
    }
  }

  #clearSpringTimer(): void {
    if (this.#springTimer !== null) clearTimeout(this.#springTimer);
    this.#springTimer = null;
  }

  /** Esc cancels the gesture in progress (and is then not a "deselect"). */
  #onEscape(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    const world = this.#host.world();
    if (world?.busy) {
      e.preventDefault();
      world.cancel();
      this.updateCursor();
      return;
    }
    if (!this.#host.tools.gesture) return;
    e.preventDefault();
    this.#host.tools.cancel();
  }

  /**
   * Keys of tool / brush commands that must do nothing now (see
   * `suppressedCommandKey`): prevented here, before the global shortcut
   * handler, which skips prevented events.
   */
  #onCommandKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || isEditableTarget(e.target) || this.#host.world()) return;
    const id = commandForEvent(e);
    if (!id) return;
    const gesture = this.#host.tools.gesture !== null || this.#pan !== null;
    if (suppressedCommandKey(id, useEditorStore.getState().tool, gesture)) e.preventDefault();
  }

  /** Arrow keys nudge the selection (select tool, canvas focused); Shift: 10 cells. */
  #onArrow(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || !this.#canvasFocused() || this.#host.world()) return;
    const off = nudgeOffset(e.key, e.shiftKey);
    if (!off) return;
    if (!this.#host.tools.nudgeSelection(off.x, off.y)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** Focus is on the canvas or on the element hosting it (not on a panel, input or the page body). */
  #canvasFocused(): boolean {
    const a = document.activeElement;
    return a === this.#canvas || (a instanceof HTMLElement && a !== document.body && a.contains(this.#canvas));
  }

  #onPointerDown(e: PointerEvent): void {
    const tools = this.#host.tools;
    this.#canvasRect = null;
    this.pointer = this.toLocal(e);
    if (document.activeElement !== this.#canvas) this.#canvas.focus({ preventScroll: true });
    const world = this.#host.world();
    if (world) {
      if (e.button === 2 && world.busy) {
        world.cancel();
        this.updateCursor();
        return;
      }
      if (this.#pan || world.busy) return;
      // Left drag on empty space pans, like the middle button (always with the hand tool).
      const pan = e.button === 1 || (e.button === 0 && (this.#spaceDown || this.#handTool() || !world.pointerDown(e, this.pointer)));
      if (pan) this.#startPan(e);
      this.updateCursor();
      return;
    }
    if (e.button === 2 && tools.isCancelable()) {
      tools.cancel();
      return;
    }
    const gesture = tools.gesture;
    if (this.#pan || (gesture && !(gesture.kind === "pendingSmart" && gesture.released))) return;
    if (e.button === 1 || (e.button === 0 && (this.#spaceDown || this.#handTool()))) {
      this.#startPan(e);
      return;
    }
    const cell = this.pointerCell();
    if (!cell) return;
    this.#syncModifiers(e);
    // Alt + click picks right away (no need to wait for the hold).
    if (e.button === 0 && e.altKey && !(useEditorStore.getState().tool === "select" && useEditorStore.getState().selectionMode === "connected") && !(activeSmartStamp() && (useEditorStore.getState().tool === "rect" || useSmartStampSession.getState().usage === "area"))) {
      if (this.#spring.phase === "idle") this.#feedSpring({ type: "down", time: performance.now() });
      this.#feedSpring({ type: "click" });
    }
    tools.pointerDown(e, cell);
  }

  #startPan(e: PointerEvent): void {
    e.preventDefault();
    this.#pan = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    this.capture(e.pointerId);
    this.#host.camera.stopAnimation();
    this.updateCursor();
    this.#host.requestRender();
  }

  /** Modifier state from a pointer event (keys pressed / released while the window had no focus). */
  #syncModifiers(e: PointerEvent): void {
    if (this.#host.world()) return;
    this.#setModifiers(e.shiftKey, e.altKey);
    if (!e.altKey && this.#spring.phase !== "idle") this.#feedSpring({ type: "up" });
  }

  #onPointerMove(e: PointerEvent): void {
    this.pointer = this.toLocal(e);
    this.#syncModifiers(e);
    if (this.#pan && e.pointerId === this.#pan.pointerId) {
      const dx = e.clientX - this.#pan.lastX;
      const dy = e.clientY - this.#pan.lastY;
      this.#pan.lastX = e.clientX;
      this.#pan.lastY = e.clientY;
      this.#host.camera.panBy(dx, dy);
    } else {
      const world = this.#host.world();
      if (world) {
        world.pointerMove(e, this.pointer);
        this.updateCursor();
      } else this.#host.tools.pointerMove(e);
    }
    this.#host.requestRender();
  }

  #onPointerUp(e: PointerEvent): void {
    const world = this.#host.world();
    if (this.#pan && e.pointerId === this.#pan.pointerId) this.#endPan();
    else if (world) {
      world.pointerUp(e, this.toLocal(e));
      this.updateCursor();
    } else this.#host.tools.pointerUp(e);
    this.release(e.pointerId);
    this.#host.requestRender();
  }

  #onPointerEnd(e: PointerEvent): void {
    if (this.#pan && e.pointerId === this.#pan.pointerId) this.#endPan();
    if (this.#host.world()?.busy) this.#host.world()?.cancel();
    const g = this.#host.tools.gesture;
    if (g && e.pointerId === g.pointerId) {
      // Pointerup releases capture automatically; the completed buffer still awaits readiness.
      if (g.kind === "pendingSmart" && g.released && e.type === "lostpointercapture") return;
      if (g.kind === "pendingSmart") { this.#host.tools.cancel(); return; }
      if (g.kind === "smart" && e.type === "pointercancel") this.#host.tools.cancel();
      else this.#host.tools.end();
    }
    this.#host.requestRender();
  }

  #endPan(): void {
    this.#pan = null;
    this.updateCursor();
  }

  #onWheel(e: WheelEvent): void {
    e.preventDefault(); // also blocks the browser's own ctrl+wheel page zoom
    if (this.#pan) return;
    const p = this.toLocal(e);
    this.pointer = p;
    this.wheel(e, p);
  }

  /**
   * Applies a wheel event anchored at `anchor` (canvas CSS px): mouse
   * notches step through the zoom presets (level view), a pinch zooms
   * continuously and settles on the nearest preset, two-finger scrolling
   * pans (see `classifyWheel`). The minimap forwards its wheel here.
   */
  wheel(e: WheelEvent, anchor: Point): void {
    const cam = this.#host.camera;
    const now = performance.now();
    const dx = wheelDeltaPixels(e.deltaX, e.deltaMode);
    const dy = wheelDeltaPixels(e.deltaY, e.deltaMode);
    const action = classifyWheel(
      { deltaX: dx, deltaY: dy, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey },
      now - this.#lastPanWheel < PAN_GESTURE_MS,
    );
    if (action === "pan") {
      this.#lastPanWheel = now;
      cam.stopAnimation();
      // Shift+wheel on a mouse scrolls horizontally.
      const panX = e.shiftKey && dx === 0 ? dy : dx;
      const panY = e.shiftKey && dx === 0 ? 0 : dy;
      cam.panBy(-panX, -panY);
    } else if (action === "pinch") {
      cam.pinchZoom(wheelZoomFactor(dy, true), anchor);
    } else if (!cam.snapSteps) {
      cam.animateZoomTo(cam.zoomTarget * wheelZoomFactor(dy, false), anchor);
    } else {
      if (now - this.#lastZoomWheel > WHEEL_ACC_RESET_MS) this.#wheelAcc = 0;
      this.#lastZoomWheel = now;
      const r = wheelZoomSteps(dy, e.deltaMode, this.#wheelAcc);
      this.#wheelAcc = r.acc;
      cam.zoomSteps(r.steps, anchor);
    }
  }
}
