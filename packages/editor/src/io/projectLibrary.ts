/**
 * Project-level data that is not part of a level's `MapStore`: the stamp
 * library and the level list (ids + names, for level pickers such as a
 * portal's target). Saved with the project by `session.ts`.
 *
 * Stamp edits are not undoable (like files in a folder); they mark the
 * project dirty and are written on the next (auto)save.
 */
import type { ProjectLevel, Stamp } from "@smap/core";
import { create } from "zustand";

import { sortStamps } from "./stampsIo";

export interface ProjectLibraryState {
  stamps: Stamp[];
  /** Stamp files that could not be read on open (left on disk). */
  brokenStampFiles: string[];
  levels: ProjectLevel[];
  /** Bumped on every user edit of the library (not on load); drives dirty tracking. */
  revision: number;

  /** Replaces everything (project opened / created). Not an edit. */
  load(data: { stamps: Stamp[]; brokenStampFiles?: string[]; levels: ProjectLevel[] }): void;
  addStamp(stamp: Stamp): void;
  renameStamp(id: string, name: string): void;
  removeStamp(id: string): Stamp | undefined;
}

export const useProjectLibrary = create<ProjectLibraryState>()((set, get) => ({
  stamps: [],
  brokenStampFiles: [],
  levels: [],
  revision: 0,

  load: ({ stamps, brokenStampFiles = [], levels }) => set({ stamps: sortStamps(stamps), brokenStampFiles, levels }),
  addStamp: (stamp) =>
    set((s) => ({ stamps: sortStamps([...s.stamps.filter((x) => x.id !== stamp.id), stamp]), revision: s.revision + 1 })),
  renameStamp: (id, name) =>
    set((s) => ({
      stamps: sortStamps(s.stamps.map((x) => (x.id === id ? Object.freeze({ ...x, name }) : x))),
      revision: s.revision + 1,
    })),
  removeStamp: (id) => {
    const stamp = get().stamps.find((x) => x.id === id);
    if (stamp) set((s) => ({ stamps: s.stamps.filter((x) => x.id !== id), revision: s.revision + 1 }));
    return stamp;
  },
}));

/** Ids a new stamp must not take (library + unreadable files, so none is overwritten). */
export function takenStampIds(state: Pick<ProjectLibraryState, "stamps" | "brokenStampFiles">): string[] {
  const fromFiles = state.brokenStampFiles.map((p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.json$/, ""));
  return [...state.stamps.map((s) => s.id), ...fromFiles];
}
