
import type { MapStore } from "@smap/core";

import { activeWorldHistory, moveHistory } from "../io/worldHistoryCommands";
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
  const worldMatches = (): boolean => {
    const world = activeWorldHistory();
    return !world || world.peekUndo()?.participants.some(p => world.store(p.mapId) === store && p.entryId === id) === true;
  };
  const enabled = (): boolean => id !== undefined && isOpen() && store.canUndo && store.peekUndo()?.id === id && worldMatches();
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
      const offWorld = activeWorldHistory()?.subscribe(onChange);
      const offEditor = useEditorStore.subscribe((s, prev) => {
        if (s.project?.store !== prev.project?.store) onChange();
      });
      return () => {
        offStore();
        offWorld?.();
        offEditor();
      };
    },
    run: () => {
      if (!enabled()) return;
      if (activeWorldHistory()) void moveHistory("undo").then(count => { if (count) after?.(); });
      else { store.undo(); after?.(); }
    },
  };
}
