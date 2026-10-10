/**
 * Document tabs: which maps (levels) are "open" as tabs above the canvas.
 * Only one map is loaded at a time (the session switches); the tabs are a
 * shortcut list the user keeps, like an editor's open files. Pure helpers
 * are exported for tests; the store is UI-only and not saved.
 */
import { create } from "zustand";

export interface DocTabsState {
  ids: readonly string[];
}

export const useDocTabs = create<DocTabsState>()(() => ({ ids: [] }));

/**
 * Tabs after the open map or the map list changed: maps that no longer
 * exist are dropped, and the open map gets a tab (right after the tab that
 * was active before, else at the end).
 */
export function syncTabs(ids: readonly string[], activeId: string | null, levelIds: readonly string[], previousActive: string | null = null): string[] {
  const exists = new Set(levelIds);
  const next = ids.filter((id) => exists.has(id));
  if (activeId !== null && exists.has(activeId) && !next.includes(activeId)) {
    const at = previousActive === null ? -1 : next.indexOf(previousActive);
    if (at < 0) next.push(activeId);
    else next.splice(at + 1, 0, activeId);
  }
  return next;
}

/** The tab to show after closing `id` while it is active: its right neighbour, else its left one; null if it is the last tab. */
export function neighbourAfterClose(ids: readonly string[], id: string): string | null {
  const i = ids.indexOf(id);
  if (i < 0 || ids.length < 2) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

export function setDocTabs(ids: readonly string[]): void {
  const current = useDocTabs.getState().ids;
  if (current.length === ids.length && current.every((id, i) => id === ids[i])) return;
  useDocTabs.setState({ ids });
}
