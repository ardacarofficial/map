import { create } from "zustand";

import type { ExportTarget } from "./exportSettings";

interface ExportUiState {
  /** Export dialog open. */
  open: boolean;
  /**
   * Target to show when the dialog opens (the app bar's "Unity'ye aktar"
   * opens it on Unity); `null` = the project's last target.
   */
  initialTarget: ExportTarget | null;
  /** An export is being written. */
  busy: boolean;
  /** Bumped after every export (manual or automatic), so the dialog re-reads "last export". */
  revision: number;
  setOpen(open: boolean): void;
  setBusy(busy: boolean): void;
  bump(): void;
}

export const useExportStore = create<ExportUiState>()((set) => ({
  open: false,
  initialTarget: null,
  busy: false,
  revision: 0,
  setOpen: (open) => set(open ? { open } : { open, initialTarget: null }),
  setBusy: (busy) => set({ busy }),
  bump: () => set((s) => ({ revision: s.revision + 1 })),
}));

/**
 * Opens the export dialog, on `target` when given (e.g. the app bar's
 * primary "Unity'ye aktar" button: `openExportDialog({ target: "unity" })`),
 * otherwise on the project's last export target.
 */
export function openExportDialog(options: { target?: ExportTarget } = {}): void {
  useExportStore.setState({ open: true, initialTarget: options.target ?? null });
}
