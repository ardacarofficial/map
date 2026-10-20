import { editGate } from "../agent/editGate";
import type { WorldHistory } from '@smap/core';

import { useEditorStore } from '../state/editorStore';
import { t } from '../i18n';
import { toast } from '../ui/toast/toastStore';
import { getLevelWorkspace, openLevel, publishLevelState } from './session';

let moving = false;
/** Temporary stamp documents always keep their own local history. */
export function activeWorldHistory(): WorldHistory | null {
  const project = useEditorStore.getState().project, ws = getLevelWorkspace();
  return project && !project.levelId?.startsWith('stamp:') && ws?.entry(project.levelId ?? ws.activeId)?.store === project.store ? ws.history : null;
}
export function canMoveHistory(move: 'undo' | 'redo'): boolean {
  if (moving || editGate.blocked) return false;
  const store = useEditorStore.getState().project?.store;
  const history = activeWorldHistory();
  return move === 'undo' ? (history?.canUndo ?? store?.canUndo ?? false) : (history?.canRedo ?? store?.canRedo ?? false);
}
/** Activate the origin before replay so canvas feedback and project observers see the right map. */
export async function moveHistory(move: 'undo' | 'redo', targetId?: number): Promise<number> {
  if (!canMoveHistory(move)) return 0;
  const history = activeWorldHistory();
  if (!history) {
    const store = useEditorStore.getState().project!.store;
    return targetId === undefined ? Number(store[move]()) : move === 'undo' ? store.undoTo(targetId) : store.redoTo(targetId);
  }
  if (targetId !== undefined && !history.entries().some(e => e.id === targetId && e.state === (move === 'undo' ? 'done' : 'undone'))) return 0;
  moving = true;
  let count = 0;
  try {
    do {
      const entry = move === 'undo' ? history.peekUndo() : history.peekRedo();
      if (!entry) break;
      if (!(await openLevel(entry.originMapId)) || activeWorldHistory() !== history) break;
      if (!history[move]()) { toast.error(t('worldHistory.invalid')); break; }
      count++;
      publishLevelState();
      useEditorStore.getState().setDirty(true);
      if (targetId === undefined || entry.id === targetId) break;
    } while (move === 'undo' ? history.canUndo : history.canRedo);
  } finally { moving = false; }
  return count;
}
