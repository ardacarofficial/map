import { create } from "zustand";

/** Save / autosave state for the status bar and the "file changed on disk" dialog. */
export interface SaveStatus {
  /** True while files are being written (manual save or autosave). */
  saving: boolean;
  /** Time of the last successful save (ms since epoch), or null. */
  lastSavedAt: number | null;
  /** The last autosave failed (cleared by the next successful save). */
  failed: boolean;
  /** The open project has a folder on disk (autosave and backups work). */
  hasFolder: boolean;
  /** Set while the level file changed on disk and the user has not decided yet. */
  diskConflict: { path: string; diskText: string } | null;
}

export const useSaveStatus = create<SaveStatus>()(() => ({
  saving: false,
  lastSavedAt: null,
  failed: false,
  hasFolder: false,
  diskConflict: null,
}));
