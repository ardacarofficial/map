import type { MapStore } from "@smap/core";
import { useEffect, useRef, useState } from "react";

import { useEditorStore } from "../../state/editorStore";
import { watchCanvasHandle } from "../canvas/canvasHandle";
import { Icon } from "../primitives/Icon";
import { HistoryLabels, historyMessage, nextBurst, type Burst, type HistoryMove } from "./historyLabels";

/** How long the pill stays after the last undo / redo (ms). */
const SHOW_MS = 1400;

interface Shown {
  move: HistoryMove;
  message: string;
  token: number;
}

/**
 * Brief "Geri alındı: Kalem (12 hücre)" / "Yinelendi: …" pill at the bottom
 * centre of the canvas after every undo / redo, whatever ran it (Ctrl+Z,
 * menu, toolbar). Holding Ctrl+Z updates one pill ("Geri alındı: 7 adım")
 * instead of stacking messages. Mount inside the canvas area.
 */
export function UndoHud() {
  const store = useEditorStore((s) => s.project?.store);
  const [shown, setShown] = useState<Shown | null>(null);
  const [visible, setVisible] = useState(false);
  const labels = useRef(new HistoryLabels());
  const burst = useRef<Burst | null>(null);
  const storeRef = useRef<MapStore | undefined>(store);

  // History of the open document (a new store = a new history).
  useEffect(() => {
    storeRef.current = store;
    if (!store) return;
    labels.current.reset(store.undoDepth, store.redoDepth);
    burst.current = null;
    let token = 0;
    return store.subscribe((event) => {
      if (!event.historyChanged) return;
      const feedback = labels.current.change(event.cause, store.undoDepth, store.redoDepth);
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
        if (s) labels.current.stroke(summary, s.undoDepth);
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

  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
      {shown && (
        <div
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
