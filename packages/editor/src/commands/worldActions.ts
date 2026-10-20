import { manualEditAllowed } from "../agent/editGate";
/**
 * World map view (v1.2) wiring: the canvas' second view ("Harita | Dünya").
 *
 * - The canvas gets a {@link WorkspaceWorldSource} after every mount and is
 *   told about list edits, saves and (throttled) edits of the active level.
 * - A dragged level is written into the level list (`project.smap`, not an
 *   undo step, like the other list edits) and the project turns dirty.
 * - Clicking a level on the world map (or in the Levels panel while the
 *   world view is shown) opens it and returns to the level view.
 * - `view.world` (toolbar toggle, `W`, palette) switches views; `Esc` in
 *   the world view returns (see `edit.deselect`).
 */
import { create } from "zustand";

import type { CanvasHandle } from "../canvas";
import type { CanvasView, LevelMovedEvent } from "../canvas/mapCanvas";
import { t } from "../i18n";
import { useProjectLibrary } from "../io/projectLibrary";
import { describeError, getLevelWorkspace, getProjectFolder, onProjectSaved, openLevel, publishLevelState } from "../io/session";
import type { LevelWorkspace } from "../io/levelWorkspace";
import { applyLevelMove, WorkspaceWorldSource } from "../io/worldSource";
import { useEditorStore, type OpenProject } from "../state/editorStore";
import { getCanvasHandle, watchCanvasHandle } from "../ui/canvas/canvasHandle";
import { toast } from "../ui/toast/toastStore";
import { registerCommands } from "./registry";

/** Which view the canvas shows (mirrors the canvas; React reads it). */
export const useWorldView = create<{ view: CanvasView }>()(() => ({ view: "level" }));

/** True while the canvas shows the world map. */
export function isWorldView(): boolean {
  return useWorldView.getState().view === "world";
}

/** Switches the canvas view (no-op while the canvas is starting). */
export function setCanvasView(view: CanvasView): void {
  getCanvasHandle()?.setView(view);
}

export function toggleWorldView(): void {
  setCanvasView(isWorldView() ? "level" : "world");
}

/**
 * Canvas `onLevelMoved`: writes the (already snapped) position into the
 * level list, publishes the list and marks the project dirty.
 */
export function moveLevelOnWorld(event: LevelMovedEvent): boolean {
  if (!manualEditAllowed()) return false;
  const ws = getLevelWorkspace();
  if (!ws) return false;
  try {
    if (!applyLevelMove(ws, event)) return false;
  } catch (error) {
    console.error(error);
    toast.error(t("levels.actionFailed", { detail: describeError(error) }));
    return false;
  }
  publishLevelState({ listChanged: true });
  const editor = useEditorStore.getState();
  if (editor.project && !editor.dirty) editor.setDirty(true);
  return true;
}

/** Opens a level from the world view (map click, Levels panel) and shows it. */
export async function openLevelFromWorld(levelId: string): Promise<boolean> {
  const ok = await openLevel(levelId);
  if (ok) setCanvasView("level");
  return ok;
}

/**
 * Installs the world view: data source, canvas callbacks, change reports
 * and the `view.world` command. Call once at startup; returns a cleanup.
 */
export function installWorldActions(): () => void {
  const source = new WorkspaceWorldSource({
    workspace: getLevelWorkspace,
    fs: () => getProjectFolder()?.fs ?? null,
  });

  registerCommands([
    {
      id: "view.world",
      title: "commands.view.world",
      category: "view",
      enabled: () => useEditorStore.getState().project !== null && getCanvasHandle() !== null,
      run: toggleWorldView,
    },
  ]);

  // ---- canvas (re-mounted with each project; StrictMode mounts twice)
  let unsubscribeCanvas: (() => void) | null = null;
  const bind = (handle: CanvasHandle | null) => {
    unsubscribeCanvas?.();
    unsubscribeCanvas = null;
    useWorldView.setState({ view: handle?.getView() ?? "level" });
    if (!handle) return;
    handle.setWorldSource(source);
    const offView = handle.onViewChange((view) => useWorldView.setState({ view }));
    const offMoved = handle.onLevelMoved((event) => void moveLevelOnWorld(event));
    const offOpen = handle.onOpenLevel((id) => void openLevelFromWorld(id));
    unsubscribeCanvas = () => {
      offView();
      offMoved();
      offOpen();
    };
  };
  const unwatch = watchCanvasHandle(bind);

  // ---- list edits (add, remove, rename, reorder, move; also a project opened)
  const unsubscribeLibrary = useProjectLibrary.subscribe((state, prev) => {
    if (state.levels !== prev.levels) source.listChanged();
  });

  // ---- saves: the written levels' files are current now
  const unsubscribeSaved = onProjectSaved((event) => source.contentChanged(event.levels.map((l) => l.id)));

  // ---- edits of the active level (throttled), replaced stores, another project
  let workspace: LevelWorkspace | null = getLevelWorkspace();
  let unsubscribeStore: (() => void) | null = null;
  const watchProject = (project: OpenProject | null, prev: OpenProject | null) => {
    unsubscribeStore?.();
    unsubscribeStore = null;
    const ws = getLevelWorkspace();
    if (ws !== workspace) {
      // Another project (or the same one reloaded from disk): every level may differ.
      workspace = ws;
      source.contentChanged("all");
      if (isWorldView()) setCanvasView("level");
    } else if (project && prev && project.store !== prev.store && project.levelId === prev.levelId && project.levelId) {
      // Same level, new store (a backup was opened, project data rebuilt it).
      source.contentChanged([project.levelId]);
    }
    if (!project) return;
    const store = project.store;
    unsubscribeStore = store.subscribe((event) => {
      if (event.cells.length === 0 && event.structure.length === 0) return;
      const id = getLevelWorkspace()?.activeId ?? project.levelId;
      if (id) source.activeEdited(id);
    });
  };
  watchProject(useEditorStore.getState().project, null);
  const unsubscribeEditor = useEditorStore.subscribe((state, prev) => {
    if (state.project !== prev.project) watchProject(state.project, prev.project);
  });

  return () => {
    unwatch();
    unsubscribeCanvas?.();
    unsubscribeLibrary();
    unsubscribeSaved();
    unsubscribeEditor();
    unsubscribeStore?.();
    source.dispose();
  };
}
