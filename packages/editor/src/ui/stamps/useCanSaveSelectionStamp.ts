import { useCallback, useSyncExternalStore } from "react";

import { canSaveSelectionStamp } from "../../commands/stampActions";
import { useEditorStore } from "../../state/editorStore";

/** Re-check a marquee after committed edits/undo without updating on every painted cell. */
export function useCanSaveSelectionStamp(): boolean {
  const store = useEditorStore((s) => s.project?.store);
  useEditorStore((s) => s.region);
  const subscribe = useCallback((notify: () => void) => store?.subscribe(event => {
    if (event.historyChanged) notify();
  }) ?? (() => undefined), [store]);
  return useSyncExternalStore(subscribe, canSaveSelectionStamp);
}
