/**
 * The one answer to "is my work saved?". The title dot, the window title
 * and the status bar text all derive from `deriveSaveIndicator`, so they can
 * never disagree (round 3: the title showed "●" while the status bar said
 * "Kaydedildi" because the status preferred the last save time over the
 * dirty flag).
 */
import { useEditorStore } from "../state/editorStore";
import { useProjectLibrary } from "./projectLibrary";
import { useSaveStatus } from "./saveStatus";

export interface SaveIndicatorInput {
  hasProject: boolean;
  /** Editor dirty flag (map, library or project changes since the last save). */
  dirty: boolean;
  /** Levels with unsaved changes (v1.0 workspace). */
  dirtyLevelCount: number;
  saving: boolean;
  failed: boolean;
  lastSavedAt: number | null;
  hasFolder: boolean;
}

export type SaveIndicatorText = "saving" | "saveFailed" | "notSaved" | "savedAt";

export interface SaveIndicator {
  /** Closing now would lose work: title "●", warning dot, close asks. */
  unsaved: boolean;
  /** Status bar text (`status.<text>`), or null for nothing to say (fresh, untouched project). */
  text: SaveIndicatorText | null;
  /** For "savedAt". */
  lastSavedAt: number | null;
}

export function deriveSaveIndicator(input: SaveIndicatorInput): SaveIndicator {
  const unsaved = input.hasProject && (input.dirty || input.dirtyLevelCount > 0);
  const lastSavedAt = input.hasFolder ? input.lastSavedAt : null;
  let text: SaveIndicatorText | null = null;
  if (!input.hasProject) text = null;
  else if (input.saving) text = "saving";
  else if (input.failed) text = "saveFailed";
  else if (unsaved) text = "notSaved";
  else if (lastSavedAt !== null) text = "savedAt";
  return { unsaved, text, lastSavedAt };
}

/** Current inputs from the stores (non-React callers: window title, close guard). */
export function readSaveIndicator(): SaveIndicator {
  const editor = useEditorStore.getState();
  const status = useSaveStatus.getState();
  return deriveSaveIndicator({
    hasProject: editor.project !== null,
    dirty: editor.dirty,
    dirtyLevelCount: useProjectLibrary.getState().dirtyLevelIds.length,
    saving: status.saving,
    failed: status.failed,
    lastSavedAt: status.lastSavedAt,
    hasFolder: status.hasFolder,
  });
}

/** Calls `listener` whenever any input of the indicator changes. Returns an unsubscribe. */
export function subscribeSaveIndicator(listener: () => void): () => void {
  const a = useEditorStore.subscribe(listener);
  const b = useSaveStatus.subscribe(listener);
  const c = useProjectLibrary.subscribe(listener);
  return () => {
    a();
    b();
    c();
  };
}

/** React hook: the save indicator, re-rendering only when it changes. */
export function useSaveIndicator(): SaveIndicator {
  const hasProject = useEditorStore((s) => s.project !== null);
  const dirty = useEditorStore((s) => s.dirty);
  const dirtyLevelCount = useProjectLibrary((s) => s.dirtyLevelIds.length);
  const saving = useSaveStatus((s) => s.saving);
  const failed = useSaveStatus((s) => s.failed);
  const lastSavedAt = useSaveStatus((s) => s.lastSavedAt);
  const hasFolder = useSaveStatus((s) => s.hasFolder);
  return deriveSaveIndicator({ hasProject, dirty, dirtyLevelCount, saving, failed, lastSavedAt, hasFolder });
}
