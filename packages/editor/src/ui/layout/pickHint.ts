/**
 * One-time discoverability hint for picking tiles from the map (right click,
 * right drag, Alt + click). Shown in the status bar until the first pick,
 * then never again (remembered per browser, like the window layout).
 */
import { create } from "zustand";

import { watchCanvasHandle } from "../canvas/canvasHandle";

const KEY = "smap.hint.pickFromMap";

function read(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

interface PickHintState {
  /** The user has picked from the map at least once (or closed the hint). */
  seen: boolean;
  dismiss(): void;
}

export const usePickHint = create<PickHintState>()((set) => ({
  seen: read(),
  dismiss: () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // Private window: the hint just comes back next time.
    }
    set({ seen: true });
  },
}));

let installed = false;

/** Hides the hint on the first map pick (idempotent). */
export function installPickHint(): void {
  if (installed || usePickHint.getState().seen) return;
  installed = true;
  let unsubscribe: (() => void) | null = null;
  const stopWatching = watchCanvasHandle((handle) => {
    unsubscribe?.();
    unsubscribe = handle
      ? handle.onPick(() => {
          usePickHint.getState().dismiss();
          unsubscribe?.();
          unsubscribe = null;
          queueMicrotask(() => stopWatching());
        })
      : null;
  });
}
