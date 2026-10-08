import type { MapStore } from "@smap/core";
import { useEffect, useRef, useState, type RefObject } from "react";

import { useEditorStore } from "../../state/editorStore";
import { watchCanvasHandle } from "../canvas/canvasHandle";
import { Icon } from "../primitives/Icon";
import { useToastStore } from "../toast/toastStore";
import { HistoryLabels, historyMessage, nextBurst, type Burst, type HistoryMove } from "./historyLabels";
import { hudBottom } from "./hudStack";

/** How long the pill stays after the last undo / redo (ms). */
const SHOW_MS = 1400;
/** Pill's distance from the canvas bottom when nothing is in the way (CSS px, `bottom-4`). */
const BASE_BOTTOM = 16;

interface Shown {
  move: HistoryMove;
  message: string;
  token: number;
}

/**
 * Brief "Geri alındı: Kalem (12 hücre)" / "Yinelendi: …" pill at the bottom
 * centre of the canvas after every undo / redo, whatever ran it (Ctrl+Z,
 * menu, toolbar). Holding Ctrl+Z updates one pill ("Geri alındı: 7 adım")
 * instead of stacking messages. Mount inside the canvas area. When toasts
 * share its columns the pill sits above them, never on top of them.
 */
export function UndoHud() {
  const store = useEditorStore((s) => s.project?.store);
  const [shown, setShown] = useState<Shown | null>(null);
  const [visible, setVisible] = useState(false);
  const labels = useRef(new HistoryLabels());
  const burst = useRef<Burst | null>(null);
  const storeRef = useRef<MapStore | undefined>(store);
  const rowRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  // History of the open document (a new store = a new history).
  useEffect(() => {
    storeRef.current = store;
    if (!store) return;
    labels.current.reset();
    burst.current = null;
    let token = 0;
    return store.subscribe((event) => {
      if (!event.historyChanged) return;
      const feedback = labels.current.change(event.cause, store);
      if (!feedback) return;
      const b = nextBurst(burst.current, feedback.move, performance.now());
      burst.current = b;
      setShown({ move: feedback.move, message: historyMessage(feedback.move, feedback.summary, b.count), token: ++token });
      setVisible(true);
    });
  }, [store]);

  // Stroke summaries name the step on top of the undo stack.
  useEffect(() => {
    let off: (() => void) | undefined;
    const unwatch = watchCanvasHandle((handle) => {
      off?.();
      off = handle?.onStrokeCommitted((summary) => {
        const s = storeRef.current;
        if (s) labels.current.stroke(summary, s);
      });
    });
    return () => {
      unwatch();
      off?.();
    };
  }, []);

  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setVisible(false), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  const bottom = useStackedBottom(rowRef, pillRef, shown !== null);

  return (
    <div ref={rowRef} aria-live="polite" style={{ bottom }} className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4 transition-[bottom] duration-150 ease-(--ease-out)">
      {shown && (
        <div
          ref={pillRef}
          data-undo-hud={shown.move}
          className={`flex max-w-full items-center gap-2 rounded-full border border-line bg-raised/95 py-1.5 pr-3.5 pl-2.5 text-sm text-text shadow-toast backdrop-blur-sm transition-[opacity,translate] duration-200 ease-(--ease-out) ${
            visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
          }`}
        >
          <Icon name={shown.move === "undo" ? "undo" : "redo"} size={14} className="shrink-0 text-accent" />
          <span className="truncate">{shown.message}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The pill's bottom offset: kept clear of the toast stack (measured, since
 * the stack is a window-level layer) while the pill is shown.
 */
function useStackedBottom(row: RefObject<HTMLDivElement | null>, pill: RefObject<HTMLDivElement | null>, active: boolean): number {
  const toastCount = useToastStore((s) => s.toasts.length);
  const [bottom, setBottom] = useState(BASE_BOTTOM);
  useEffect(() => {
    if (!active) return;
    const container = row.current?.parentElement;
    const toaster = document.querySelector("[data-toaster]");
    const measure = () => {
      const c = container?.getBoundingClientRect();
      const p = pill.current?.getBoundingClientRect();
      const t = toastCount > 0 ? toaster?.getBoundingClientRect() : undefined;
      const next = c ? hudBottom(p ?? null, t ?? null, c.bottom, BASE_BOTTOM) : BASE_BOTTOM;
      setBottom((b) => (b === next ? b : next));
    };
    measure();
    // Toast heights settle a frame after they mount, and change as they wrap or leave.
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    if (toaster) observer.observe(toaster);
    if (container) observer.observe(container);
    if (pill.current) observer.observe(pill.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active, toastCount, row, pill]);
  return active ? bottom : BASE_BOTTOM;
}
