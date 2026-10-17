/** Capture changes while any right-column tab (or the whole column) is hidden. */
import type { MapStore } from "@smap/core";

import type { MessageKey } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { verbForChanges } from "./historyModel";

export class HistoryVerbs {
  readonly labels = new Map<number, MessageKey>();
  private store: MapStore | undefined;
  private unsubscribe: (() => void) | undefined;

  bind(store: MapStore | undefined): void {
    if (store === this.store) return;
    this.unsubscribe?.();
    this.store = store;
    this.labels.clear();
    const capture = () => {
      const entry = store?.peekUndo();
      if (entry && !this.labels.has(entry.id)) {
        const verb = verbForChanges(entry.changes);
        if (verb) this.labels.set(entry.id, verb);
      }
      const ids = new Set(store?.historyEntries().map(i => i.id));
      for (const id of this.labels.keys()) if (!ids.has(id)) this.labels.delete(id);
    };
    capture();
    this.unsubscribe = store?.subscribe(event => { if (event.historyChanged) capture(); });
  }

  labelOf(id: number): MessageKey | null { return this.labels.get(id) ?? null; }
}

export const historyVerbs = new HistoryVerbs();
historyVerbs.bind(useEditorStore.getState().project?.store);
useEditorStore.subscribe((state) => historyVerbs.bind(state.project?.store));
