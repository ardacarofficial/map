import { create } from "zustand";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss delay in ms. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push(kind: ToastKind, message: string, duration?: number): number;
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

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (kind, message, duration = DEFAULT_DURATION[kind]) => {
    const id = nextId++;
    set((s) => {
      // Same message twice in a row: replace instead of stacking duplicates.
      const rest = s.toasts.filter((t) => t.message !== message);
      return { toasts: [...rest, { id, kind, message, duration }].slice(-MAX_TOASTS) };
    });
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Shorthands usable outside React. */
export const toast = {
  info: (message: string) => useToastStore.getState().push("info", message),
  success: (message: string) => useToastStore.getState().push("success", message),
  warning: (message: string) => useToastStore.getState().push("warning", message),
  error: (message: string) => useToastStore.getState().push("error", message),
};
