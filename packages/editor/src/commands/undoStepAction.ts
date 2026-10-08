/**
 * "Geri al" button for a toast that undoes ONE specific history step (a
 * removed layer, terrain, entity type, a tileset grid edit).
 *
 * The step is named by its stable core id (`HistoryEntry.id`), not by the
 * undo depth: at the history limit the depth stays the same while old steps
 * fall off, so a depth check could undo the wrong step. The button undoes
 * only while that step is still on top of the store that is still open;
 * otherwise it does nothing and shows as disabled. Once the step itself has
 * been undone (Ctrl+Z, menu) or its document is closed, the action is spent
 * and the toast goes away instead of offering a stale button.
 */
import type { MapStore } from "@smap/core";

import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import type { ToastAction } from "../ui/toast/toastStore";

/**
 * A toast action that undoes the step currently on top of `store`'s undo
 * stack (call it right after the edit). `after` runs after a successful undo.
 * `isOpen` tells whether `store` is still the open document (default: the
 * editor's project store).
 */
export function undoStepAction(
  store: MapStore,
  after?: () => void,
  isOpen: () => boolean = () => useEditorStore.getState().project?.store === store,
): ToastAction {
  const id = store.peekUndo()?.id;
  const enabled = (): boolean => id !== undefined && isOpen() && store.canUndo && store.peekUndo()?.id === id;
  // Undone elsewhere: the step now sits on the redo side; a closed document never comes back.
  const spent = (): boolean => id === undefined || !isOpen() || store.peekRedo()?.id === id;
  return {
    label: t("common.undo"),
    enabled,
    spent,
    watch: (onChange) => {
      const offStore = store.subscribe((event) => {
        if (event.historyChanged) onChange();
      });
      const offEditor = useEditorStore.subscribe((s, prev) => {
        if (s.project?.store !== prev.project?.store) onChange();
      });
      return () => {
        offStore();
        offEditor();
      };
    },
    run: () => {
      if (!enabled()) return;
      store.undo();
      after?.();
    },
  };
}
