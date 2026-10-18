/**
 * Recent projects as a live list for menus (File → Son açılanlar). The data
 * comes from `getPlatform().recents`; the list refreshes when a menu mounts
 * it and after every open / save / removal (`io/session.ts`).
 *
 * Opening an entry: `openRecentProject(entry)` in `io/session.ts` (asks about
 * unsaved changes, re-asks folder permission in the browser, drops entries
 * whose project is gone).
 */
import { useEffect } from "react";
import { create } from "zustand";

import { getPlatform } from "./index";
import type { RecentEntry } from "./types";

/** At most this many entries in a menu. */
export const RECENT_MENU_LIMIT = 8;

interface RecentProjectsState {
  entries: readonly RecentEntry[];
  /** False until the first list arrived. */
  loaded: boolean;
}

const useRecentStore = create<RecentProjectsState>()(() => ({ entries: [], loaded: false }));

let refreshing: Promise<void> | null = null;
let refreshAgain = false;

/** Reloads the list from the platform (coalesces overlapping calls). */
export function refreshRecentProjects(): Promise<void> {
  const platform = getPlatform();
  if (!platform.recents.supported) {
    useRecentStore.setState({ entries: [], loaded: true });
    return Promise.resolve();
  }
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      refreshAgain = false;
      try {
        const entries = await platform.recents.list();
        useRecentStore.setState({ entries: entries.slice(0, RECENT_MENU_LIMIT), loaded: true });
      } catch {
        useRecentStore.setState({ loaded: true });
      }
    } while (refreshAgain);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export interface RecentProjects {
  /** False where the host cannot keep recents (browser without File System Access): hide the menu. */
  supported: boolean;
  loaded: boolean;
  /** Newest first, at most `RECENT_MENU_LIMIT`. */
  entries: readonly RecentEntry[];
  refresh(): Promise<void>;
}

/** React hook for menus: the recent projects, refreshed when the component mounts. */
export function useRecentProjects(): RecentProjects {
  const entries = useRecentStore((s) => s.entries);
  const loaded = useRecentStore((s) => s.loaded);
  useEffect(() => {
    void refreshRecentProjects();
  }, []);
  return { supported: getPlatform().recents.supported, loaded, entries, refresh: refreshRecentProjects };
}

/** Removes an entry from the list ("Listeden çıkar"). */
export async function forgetRecentProject(entry: RecentEntry): Promise<void> {
  try {
    await getPlatform().recents.remove(entry);
  } finally {
    await refreshRecentProjects();
  }
}
