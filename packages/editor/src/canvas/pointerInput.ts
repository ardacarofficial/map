/**
 * DOM input of the map canvas: pointer events (routed to panning or the
 * tool controller), wheel zoom / pan, Space-to-pan, Esc-to-cancel, the
 * hovered cell (reported to the status bar) and the CSS cursor.
 */
import type { CellPoint, MapInfo } from "@smap/core";

import { useEditorStore } from "../state/editorStore";
import { classifyWheel } from "./brush";
import { wheelDeltaPixels, wheelZoomFactor, type Point } from "./camera";
import type { CameraController } from "./cameraController";
import type { ToolController } from "./toolController";
import { cursorFor } from "./tools";

/** How long a pan gesture "sticks" for following wheel events. */
const PAN_GESTURE_MS = 250;

interface Pan {
  readonly pointerId: number;
  lastX: number;
  lastY: number;
}

export interface InputHost {
  readonly camera: CameraController;
  readonly tools: ToolController;
  map(): MapInfo | undefined;
  /** The active layer can be painted (cursor shows "not-allowed" otherwise). */
  paintable(): boolean;
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
  #pan: Pan | null = null;
  #lastPanWheel = -Infinity;
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

  /** Hovered map cell (inside the map), updated by {@link updateHover}. */
  get hover(): CellPoint | null {
    return this.#hover;
  }

  /** Hovered map cell for cursors and previews, or null while panning / off the map. */
  cursorCell(): CellPoint | null {
    if (!this.pointer || this.#pan || this.#spaceDown) return null;
    return this.#hover;
  }

  /** Cell under the pointer, also outside the map (drags), or null without a pointer. */
  pointerCell(): CellPoint | null {
    return this.pointer ? this.#host.camera.cellAt(this.pointer) : null;
  }

  /** Canvas bounding rect (cached until resize / scroll / pointer down). */
  rect(): DOMRect {
    return (this.#canvasRect ??= this.#canvas.getBoundingClientRect());
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
      if (this.#host.tools.gesture || this.#pan) return;
      this.pointer = null;
      this.#host.requestRender();
    }, opts);
    c.addEventListener("wheel", (e) => this.#onWheel(e), { signal, passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault(), opts);
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
    window.addEventListener("keyup", (e) => this.#onKey(e, false), opts);
    window.addEventListener("blur", () => {
      this.#spaceDown = false;
      this.updateCursor();
    }, opts);
    window.addEventListener("scroll", () => (this.#canvasRect = null), { signal, capture: true, passive: true });
    this.updateCursor();
  }

  /** Recomputes the hovered cell and reports changes to the editor store. */
  updateHover(): void {
    const map = this.#host.map();
    let cell: CellPoint | null = null;
    if (map && this.pointer) {
      const c = this.#host.camera.cellAt(this.pointer);
      if (c && c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height) cell = c;
    }
    const prev = this.#hover;
    if (prev === cell || (prev && cell && prev.x === cell.x && prev.y === cell.y)) return;
    this.#hover = cell;
    useEditorStore.getState().setHoverCell(cell ? { x: cell.x, y: cell.y } : null);
  }

  updateCursor(): void {
    const cursor = cursorFor({
      tool: useEditorStore.getState().tool,
      panning: this.#pan !== null,
      spaceDown: this.#spaceDown,
      hasMap: this.#host.map() !== undefined,
      overMap: this.#hover !== null,
      editable: this.#host.paintable(),
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

  /** Esc cancels the gesture in progress (and is then not a "deselect"). */
  #onEscape(e: KeyboardEvent): void {
    if (e.key !== "Escape" || !this.#host.tools.gesture) return;
    e.preventDefault();
    this.#host.tools.cancel();
  }

  #onPointerDown(e: PointerEvent): void {
    const tools = this.#host.tools;
    this.#canvasRect = null;
    this.pointer = this.toLocal(e);
    if (document.activeElement !== this.#canvas) this.#canvas.focus({ preventScroll: true });
    if (e.button === 2 && tools.isCancelable()) {
      tools.cancel();
      return;
    }
    if (this.#pan || tools.gesture) return;
    if (e.button === 1 || (e.button === 0 && this.#spaceDown)) {
      e.preventDefault();
      this.#pan = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      this.capture(e.pointerId);
      this.#host.camera.stopAnimation();
      this.updateCursor();
      this.#host.requestRender();
      return;
    }
    const cell = this.pointerCell();
    if (!cell) return;
    tools.pointerDown(e, cell);
  }

  #onPointerMove(e: PointerEvent): void {
    this.pointer = this.toLocal(e);
    if (this.#pan && e.pointerId === this.#pan.pointerId) {
      const dx = e.clientX - this.#pan.lastX;
      const dy = e.clientY - this.#pan.lastY;
      this.#pan.lastX = e.clientX;
      this.#pan.lastY = e.clientY;
      this.#host.camera.panBy(dx, dy);
    } else {
      this.#host.tools.pointerMove(e);
    }
    this.#host.requestRender();
  }

  #onPointerUp(e: PointerEvent): void {
    if (this.#pan && e.pointerId === this.#pan.pointerId) this.#endPan();
    else this.#host.tools.pointerUp(e);
    this.release(e.pointerId);
    this.#host.requestRender();
  }

  #onPointerEnd(e: PointerEvent): void {
    if (this.#pan && e.pointerId === this.#pan.pointerId) this.#endPan();
    const g = this.#host.tools.gesture;
    if (g && e.pointerId === g.pointerId) this.#host.tools.end();
    this.#host.requestRender();
  }

  #endPan(): void {
    this.#pan = null;
    this.updateCursor();
  }

  #onWheel(e: WheelEvent): void {
    e.preventDefault(); // also blocks the browser's own ctrl+wheel page zoom
    if (this.#pan) return;
    const cam = this.#host.camera;
    const p = this.toLocal(e);
    this.pointer = p;
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
      cam.setZoom(cam.zoomTarget * wheelZoomFactor(dy, true), p);
    } else {
      cam.animateZoomTo(cam.zoomTarget * wheelZoomFactor(dy, false), p);
    }
  }
}
