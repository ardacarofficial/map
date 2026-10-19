import type { ColorPalette } from "@smap/core";
import type { GeneratedRecipe } from "./smartStampRecipes";
/**
 * Project-level data that is not part of a level's `MapStore`: the stamp
 * library and the level list (ids + names, for level pickers such as a
 * portal's target). Saved with the project by `session.ts`.
 *
 * Stamp edits are not undoable (like files in a folder); they mark the
 * project dirty and are written on the next (auto)save.
 */
import { DEFAULT_PROJECT_SETTINGS, type ProjectLevel, type ProjectSettings, type Stamp } from "@smap/core";
import { create } from "zustand";

import { sortStamps } from "./stampsIo";

export interface ProjectLibraryState {
  colorPalettes: readonly ColorPalette[];
  stamps: Stamp[];
  generatedRecipes: readonly GeneratedRecipe[];
  rememberGeneratedRecipes(recipes: readonly GeneratedRecipe[]): void;
  /** Stamp files that could not be read on open (left on disk). */
  brokenStampFiles: string[];
  levels: ProjectLevel[];
  /** Round 4: project settings (`project.smap` `settings`): new-level defaults, Unity options. */
  settings: ProjectSettings;
  /** v1.0: ids of levels with unsaved changes (status only, set by the session; not an edit). */
  dirtyLevelIds: readonly string[];
  /** Bumped on every user edit of the library (not on load); drives dirty tracking. */
  revision: number;

  /** Replaces everything (project opened / created). Not an edit. */
  load(data: { colorPalettes?: readonly ColorPalette[]; stamps: Stamp[]; generatedRecipes?: readonly GeneratedRecipe[]; brokenStampFiles?: string[]; levels: ProjectLevel[]; settings?: ProjectSettings }): void;
  /** Replaces the project settings: an edit, saved with the project (not undoable, like the level list). */
  setSettings(settings: ProjectSettings): void;
  addStamp(stamp: Stamp): void;
  renameStamp(id: string, name: string): void;
  removeStamp(id: string): Stamp | undefined;
  /** v1.0: the level list changed (add, rename, remove, reorder): an edit, saved with the project. */
  setLevels(levels: readonly ProjectLevel[]): void;
  /** v1.0: which levels have unsaved changes (not an edit). */
  setDirtyLevels(ids: readonly string[]): void;
}

export const useProjectLibrary = create<ProjectLibraryState>()((set, get) => ({
  colorPalettes: [],
  stamps: [],
  generatedRecipes: [],
  rememberGeneratedRecipes: recipes => set(s => ({ generatedRecipes: [...s.generatedRecipes.filter(r => !recipes.some(next => next.tilesetId === r.tilesetId)), ...recipes], revision: s.revision + 1 })),
  brokenStampFiles: [],
  levels: [],
  settings: DEFAULT_PROJECT_SETTINGS,
  dirtyLevelIds: [],
  revision: 0,

  load: ({ colorPalettes = [], stamps, generatedRecipes = [], brokenStampFiles = [], levels, settings = DEFAULT_PROJECT_SETTINGS }) =>
    set({ colorPalettes, stamps: sortStamps(stamps), generatedRecipes, brokenStampFiles, levels, settings, dirtyLevelIds: [] }),
  setSettings: (settings) => set((s) => (s.settings === settings ? s : { settings, revision: s.revision + 1 })),
  setLevels: (levels) => set((s) => ({ levels: [...levels], revision: s.revision + 1 })),
  setDirtyLevels: (ids) =>
    set((s) => (s.dirtyLevelIds.length === ids.length && s.dirtyLevelIds.every((id, i) => id === ids[i]) ? s : { dirtyLevelIds: [...ids] })),
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
