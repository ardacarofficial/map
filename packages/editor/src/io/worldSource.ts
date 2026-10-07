/**
 * The world map's data source (v1.2) on top of the level session cache.
 *
 * - `levels()` is the workspace's own list: the same frozen array until the
 *   list changes, so the canvas can read it on every frame.
 * - `loadThumbnailDoc` hands out the cached store's document for levels in
 *   memory (unsaved edits included) and parses the file otherwise
 *   (`LevelWorkspace.documentOf`, the same parsing as opening a level).
 * - Changes are pushed by the wiring (`commands/worldActions.ts`): list
 *   edits (`{}`), saved or replaced levels (`{ levels: [...] }`), and edits
 *   of the active level, coalesced to at most one report per
 *   {@link ACTIVE_CHANGE_THROTTLE_MS}.
 *
 * Pure (no React, no stores) so it runs in tests.
 */
import type { MapDocument, ProjectLevel } from "@smap/core";

import type { LevelMovedEvent, WorldDataSource, WorldSourceChange } from "../canvas/mapCanvas";
import type { ProjectFileSystem } from "./fs";
import type { LevelWorkspace } from "./levelWorkspace";

/** Edits of the active level are reported at most this often. */
export const ACTIVE_CHANGE_THROTTLE_MS = 500;

const NO_LEVELS: readonly ProjectLevel[] = Object.freeze([]);

export interface WorldSourceDeps {
  /** The open project's levels, or `null` (welcome screen). */
  workspace(): LevelWorkspace | null;
  /** The project folder's files, or `null` (never saved). */
  fs(): ProjectFileSystem | null;
  /** Override of {@link ACTIVE_CHANGE_THROTTLE_MS} (tests). */
  throttleMs?: number;
}

export class WorkspaceWorldSource implements WorldDataSource {
  readonly #deps: WorldSourceDeps;
  readonly #listeners = new Set<(change: WorldSourceChange) => void>();
  /** Levels edited since the last report. */
  readonly #pending = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: WorldSourceDeps) {
    this.#deps = deps;
  }

  levels(): readonly ProjectLevel[] {
    return this.#deps.workspace()?.levels ?? NO_LEVELS;
  }

  loadThumbnailDoc(levelId: string): Promise<MapDocument> {
    const ws = this.#deps.workspace();
    if (!ws) return Promise.reject(new Error("loadThumbnailDoc: no project is open"));
    return ws.documentOf(levelId, this.#deps.fs());
  }

  onChange(cb: (change: WorldSourceChange) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  /** Names, order, world positions or the set of levels changed. */
  listChanged(): void {
    this.#emit({});
  }

  /** The content of these levels changed (saved, replaced, reloaded); `"all"` = every level. */
  contentChanged(levels: readonly string[] | "all"): void {
    if (levels === "all") {
      this.#cancel();
      this.#emit({ levels: "all" });
      return;
    }
    if (levels.length === 0) return;
    for (const id of levels) this.#pending.delete(id);
    this.#emit({ levels: [...levels] });
  }

  /** The active level was edited: reported once the throttle interval has passed. */
  activeEdited(levelId: string): void {
    this.#pending.add(levelId);
    this.#timer ??= setTimeout(() => this.flush(), this.#deps.throttleMs ?? ACTIVE_CHANGE_THROTTLE_MS);
  }

  /** Reports pending edits now. */
  flush(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#pending.size === 0) return;
    const levels = [...this.#pending];
    this.#pending.clear();
    this.#emit({ levels });
  }

  dispose(): void {
    this.#cancel();
    this.#listeners.clear();
  }

  #cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending.clear();
  }

  #emit(change: WorldSourceChange): void {
    for (const cb of [...this.#listeners]) {
      try {
        cb(change);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

/**
 * Applies a world map drag (canvas `onLevelMoved`; the position is already
 * snapped, so no `snap` option). Returns true when the level moved; the
 * caller then publishes the list and marks the project dirty.
 */
export function applyLevelMove(ws: LevelWorkspace, event: LevelMovedEvent): boolean {
  if (!ws.level(event.levelId)) return false;
  return ws.setWorldPosition(event.levelId, { x: event.x, y: event.y });
}
