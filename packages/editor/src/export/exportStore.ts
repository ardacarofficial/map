import { create } from "zustand";

interface ExportUiState {
  /** Export dialog open. */
  open: boolean;
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
  busy: false,
  revision: 0,
  setOpen: (open) => set({ open }),
  setBusy: (busy) => set({ busy }),
  bump: () => set((s) => ({ revision: s.revision + 1 })),
}));
