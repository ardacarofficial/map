import { useEffect, useRef, useState } from "react";

import { useEditorStore } from "../../state/editorStore";
import { watchCanvasHandle } from "../canvas/canvasHandle";
import { Icon } from "../primitives/Icon";
import { describeEntry, historyMessage, nextBurst, type Burst, type HistoryMove } from "./historyLabels";
import { bindHistoryLabels, recordStrokeLabel, sharedHistoryLabels } from "./sharedHistoryLabels";

/** How long the HUD stays after the last undo / redo (ms). */
const SHOW_MS = 1400;

interface Shown {
  move: HistoryMove;
  message: string;
  token: number;
}

/**
 * Brief "Geri alındı: Kalem (12 hücre)" / "Yinelendi: …" HUD at the bottom
 * centre of the canvas after every undo / redo, whatever ran it (Ctrl+Z,
 * menu, toolbar). Holding Ctrl+Z updates one HUD ("Geri alındı: 7 adım")
 * instead of stacking messages. Mount inside the canvas area. When toasts
 * share its columns the HUD sits above them, never on top of them.
 */
export function UndoHud() {
  const store = useEditorStore((s) => s.project?.store);
  const [shown, setShown] = useState<Shown | null>(null);
  const [visible, setVisible] = useState(false);
  const burst = useRef<Burst | null>(null);

  // History of the open document (a new store = a new history).
  useEffect(() => {
    bindHistoryLabels(store);
    if (!store) return;
    burst.current = null;
    let token = 0;
    return store.subscribe((event) => {
      if (!event.historyChanged) return;
      const feedback = sharedHistoryLabels.change(event.cause, store);
      if (!feedback) return;
      const b = nextBurst(burst.current, feedback.move, performance.now());
      burst.current = b;
      // The step just moved: undone → top of redo, redone → top of undo.
      const fallback = feedback.summary ? null : describeEntry(feedback.move === "undo" ? store.peekRedo() : store.peekUndo());
      setShown({ move: feedback.move, message: historyMessage(feedback.move, feedback.summary, b.count, fallback), token: ++token });
      setVisible(true);
    });
  }, [store]);

  // Stroke summaries name the step on top of the undo stack.
  useEffect(() => {
    let off: (() => void) | undefined;
    const unwatch = watchCanvasHandle((handle) => {
      off?.();
      // Named once for the HUD and the Geçmiş tab (shared labels of the bound store).
      off = handle?.onStrokeCommitted((summary) => recordStrokeLabel(summary));
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
    <div aria-live="polite" className={`max-w-full ${visible ? "flex" : "hidden"}`}>
      {shown && (
        <div
          data-undo-hud={shown.move}
          className={`flex h-8 max-w-full items-center gap-2 rounded-md border border-line-strong bg-popup px-3 text-sm text-text shadow-popup transition-[opacity,translate] duration-(--duration-ui) ease-(--ease-out) motion-reduce:transition-none ${
            visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
          }`}
        >
          <Icon name={shown.move === "undo" ? "undo-2" : "redo-2"} size={16} className="shrink-0 text-muted" />
          <span className="truncate">{shown.message}</span>
        </div>
      )}
    </div>
  );
}
