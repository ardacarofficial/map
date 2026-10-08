import { create } from "zustand";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss delay in ms. */
  duration: number;
  /** Optional button (e.g. "Geri al"); running it dismisses the toast. */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  run(): void;
  /** False when the action no longer applies; the button shows disabled. Default: always enabled. */
  enabled?(): boolean;
  /**
   * True once the action can never apply again (e.g. its undo step was
   * undone some other way): the toast is dismissed. Checked whenever
   * `watch` reports a change.
   */
  spent?(): boolean;
  /** Calls `onChange` whenever `enabled()` / `spent()` may have changed; returns an unsubscribe. */
  watch?(onChange: () => void): () => void;
}

interface ToastState {
  toasts: Toast[];
  push(kind: ToastKind, message: string, duration?: number, action?: ToastAction): number;
  dismiss(id: number): void;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 3000,
  success: 2500,
  warning: 6000,
  error: 7000,
};

const MAX_TOASTS = 4;
let nextId = 1;
/** Spent-watchers of shown toasts with an action, by toast id. */
const spentWatchers = new Map<number, () => void>();

/** Stops watching toasts that are no longer shown. */
function pruneWatchers(toasts: readonly Toast[]): void {
  for (const [id, off] of spentWatchers) {
    if (toasts.some((t) => t.id === id)) continue;
    off();
    spentWatchers.delete(id);
  }
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (kind, message, duration = DEFAULT_DURATION[kind], action) => {
    const id = nextId++;
    if (action?.spent?.()) return id;
    set((s) => {
      // Same message twice in a row: replace instead of stacking duplicates.
      const rest = s.toasts.filter((t) => t.message !== message);
      return { toasts: [...rest, { id, kind, message, duration, ...(action ? { action } : {}) }].slice(-MAX_TOASTS) };
    });
    pruneWatchers(get().toasts);
    const { spent, watch } = action ?? {};
    if (spent && watch) {
      spentWatchers.set(
        id,
        watch(() => {
          if (spent()) get().dismiss(id);
        }),
      );
    }
    return id;
  },
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    pruneWatchers(get().toasts);
  },
}));

/** Shorthands usable outside React. */
export const toast = {
  info: (message: string) => useToastStore.getState().push("info", message),
  success: (message: string) => useToastStore.getState().push("success", message),
  warning: (message: string) => useToastStore.getState().push("warning", message),
  error: (message: string) => useToastStore.getState().push("error", message),
  /** Info toast with a button; stays a little longer so there is time to click. */
  withAction: (message: string, action: ToastAction) => useToastStore.getState().push("info", message, 6000, action),
};
