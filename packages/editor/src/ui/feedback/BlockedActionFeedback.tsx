import { useEffect } from "react";

import { useEditorStore } from "../../state/editorStore";
import { watchCanvasHandle } from "../canvas/canvasHandle";
import { useToastStore } from "../toast/toastStore";
import { blockedToast } from "./blockedFeedback";

/** How long a blocked-press toast stays (ms); the same message again replaces it instead of stacking. */
const DURATION = 5000;

/** Turns the canvas' blocked presses into toasts with a fix (renders nothing). */
export function BlockedActionFeedback() {
  useEffect(() => {
    let off: (() => void) | undefined;
    const unwatch = watchCanvasHandle((handle) => {
      off?.();
      off = handle?.onBlockedAction((blocked) => {
        const state = useEditorStore.getState();
        const doc = state.project?.store.document;
        const shown = doc ? blockedToast(doc, blocked, state.tool) : null;
        if (shown) useToastStore.getState().push("warning", shown.message, DURATION, shown.action ?? undefined);
      });
    });
    return () => {
      unwatch();
      off?.();
    };
  }, []);
  return null;
}
