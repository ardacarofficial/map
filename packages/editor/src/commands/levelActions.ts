/**
 * Level list actions (v1.0) and portal navigation / target point picking
 * (v1.1), wired to the session, the stores and toasts.
 *
 * Level list edits are not undoable (they are project-level, like files in
 * a folder); deleting asks first. A level's id never changes; renaming
 * keeps its file path as well (see `levelWorkspace.ts`).
 */
import { PORTAL_TARGET_POINT, portalTarget, type EntityPoint } from "@smap/core";
import { create } from "zustand";

import { t } from "../i18n";
import type { PortalReferences } from "../io/levelWorkspace";
import { LEVELS_DIR } from "../io/levelWorkspace";
import { useProjectLibrary } from "../io/projectLibrary";
import { newLayerFor } from "../ui/projectSettings/projectTemplates";
import { describeError, getLevelWorkspace, getProjectFolder, openLevel, publishLevelState } from "../io/session";
import { useEditorStore, type ToolId } from "../state/editorStore";
import { getCanvasHandle, watchCanvasHandle } from "../ui/canvas/canvasHandle";
import { toast } from "../ui/toast/toastStore";
import { registerPaletteProvider } from "./registry";

// ------------------------------------------------------------------ dialogs

interface LevelUiState {
  /** "Yeni level" dialog. */
  newLevelOpen: boolean;
  /** Level whose delete confirmation is open, or `null`. */
  removeLevelId: string | null;
  /** Active target-point pick (v1.1), or `null`. */
  pick: PointPick | null;
}

export interface PointPick {
  sourceLevelId: string;
  entityId: string;
  field: string;
  targetLevelId: string;
  /** Tool before the pick (restored afterwards). */
  tool: ToolId;
}

export const useLevelUi = create<LevelUiState>()(() => ({ newLevelOpen: false, removeLevelId: null, pick: null }));

export function openNewLevelDialog(open = true): void {
  useLevelUi.setState({ newLevelOpen: open });
}

export function askRemoveLevel(id: string | null): void {
  if (id !== null && (getLevelWorkspace()?.levels.length ?? 0) <= 1) {
    toast.warning(t("levels.removeLast"));
    return;
  }
  useLevelUi.setState({ removeLevelId: id });
}

// ------------------------------------------------------------------ list edits

function fail(error: unknown): void {
  console.error(error);
  toast.error(t("levels.actionFailed", { detail: describeError(error) }));
}

/** File names already in `levels/` (so a new level never overwrites a stray file). */
async function diskLevelFiles(): Promise<string[]> {
  try {
    return (await getProjectFolder()?.fs.list(LEVELS_DIR)) ?? [];
  } catch {
    return [];
  }
}

/** "Level 2", "Level 3"… — the first free default name. */
export function nextLevelName(): string {
  const names = new Set(getLevelWorkspace()?.levels.map((l) => l.name.toLocaleLowerCase("tr")) ?? []);
  for (let n = (getLevelWorkspace()?.levels.length ?? 0) + 1; ; n++) {
    const name = t("levels.defaultName", { n });
    if (!names.has(name.toLocaleLowerCase("tr"))) return name;
  }
}

export interface NewLevelInput {
  name: string;
  width: number;
  height: number;
  tileSize: number;
}

/** Adds an empty level at the end of the list and opens it. */
export async function createLevel(input: NewLevelInput): Promise<boolean> {
  const ws = getLevelWorkspace();
  if (!ws) return false;
  try {
    // The project's layer template (project settings), if any.
    const layers = useProjectLibrary.getState().settings.layerTemplate.map(newLayerFor);
    const level = ws.add({ ...input, name: input.name.trim(), layerName: t("layers.defaultName"), layers }, await diskLevelFiles());
    publishLevelState({ listChanged: true });
    return await openLevel(level.id);
  } catch (error) {
    fail(error);
    return false;
  }
}

/** Copies a level (with its unsaved edits) under a new id, right after it, and opens the copy. */
export async function duplicateLevel(id: string): Promise<boolean> {
  const ws = getLevelWorkspace();
  const source = ws?.level(id);
  if (!ws || !source) return false;
  try {
    const level = await ws.duplicate(id, t("levels.copyName", { name: source.name }), getProjectFolder()?.fs ?? null, await diskLevelFiles());
    publishLevelState({ listChanged: true });
    return await openLevel(level.id);
  } catch (error) {
    fail(error);
    return false;
  }
}

/** Renames a level (id and file path stay). Empty or unchanged names are ignored. */
export function renameLevel(id: string, name: string): void {
  const ws = getLevelWorkspace();
  const trimmed = name.trim();
  if (!ws || trimmed.length === 0 || ws.level(id)?.name === trimmed) return;
  try {
    ws.rename(id, trimmed);
    publishLevelState({ listChanged: true });
  } catch (error) {
    fail(error);
  }
}

/** Moves a level to `index` in the list. */
export function moveLevel(id: string, index: number): void {
  const ws = getLevelWorkspace();
  if (!ws) return;
  const from = ws.levels.findIndex((l) => l.id === id);
  if (from < 0 || from === index) return;
  try {
    ws.move(id, index);
    publishLevelState({ listChanged: true });
  } catch (error) {
    fail(error);
  }
}

/** The level `step` places after `activeId` in `ids`, wrapping around; null with fewer than two levels. */
export function cycleLevelId(ids: readonly string[], activeId: string | null, step: 1 | -1): string | null {
  if (ids.length < 2) return null;
  const index = activeId === null ? -1 : ids.indexOf(activeId);
  if (index < 0) return ids[step === 1 ? 0 : ids.length - 1]!;
  return ids[(index + step + ids.length) % ids.length]!;
}

/** Ctrl+Tab / Ctrl+Shift+Tab: opens the next / previous level of the list (wraps around). */
export function openAdjacentLevel(step: 1 | -1): boolean {
  const ws = getLevelWorkspace();
  if (!ws || useLevelUi.getState().pick) return false;
  const id = cycleLevelId(
    ws.levels.map((l) => l.id),
    ws.activeId,
    step,
  );
  if (id === null) return false;
  void openLevel(id);
  return true;
}

/** Portals in other levels that point at `id` (reads levels that are not loaded). */
export async function portalsTo(id: string): Promise<PortalReferences> {
  const ws = getLevelWorkspace();
  if (!ws) return { count: 0, levels: [], unreadable: 0 };
  return ws.portalsTo(id, getProjectFolder()?.fs ?? null);
}

/**
 * Deletes a level (not undoable; the caller asked first). When it is the
 * open level, its neighbour opens first. Portals pointing at it turn red.
 */
export async function removeLevel(id: string): Promise<boolean> {
  const ws = getLevelWorkspace();
  const level = ws?.level(id);
  if (!ws || !level) return false;
  if (ws.levels.length <= 1) {
    toast.warning(t("levels.removeLast"));
    return false;
  }
  if (ws.activeId === id) {
    const index = ws.levels.findIndex((l) => l.id === id);
    const neighbour = ws.levels[index + 1] ?? ws.levels[index - 1];
    if (!neighbour || !(await openLevel(neighbour.id))) return false;
  }
  try {
    ws.remove(id);
  } catch (error) {
    fail(error);
    return false;
  }
  publishLevelState({ listChanged: true });
  toast.success(t("levels.removed", { name: level.name }));
  return true;
}

// ------------------------------------------------------------------ portals (v1.1)

/** Cell containing a pixel point of a map. */
function cellOf(point: EntityPoint, tileWidth: number, tileHeight: number): { x: number; y: number } {
  return { x: Math.floor(point.x / tileWidth), y: Math.floor(point.y / tileHeight) };
}

/**
 * Portal double-click (canvas `onNavigate`): opens the target level and
 * centres the view on the target point (the map is framed when the point is
 * not set).
 */
export async function navigateTo(levelId: string, point: EntityPoint | null): Promise<boolean> {
  const ws = getLevelWorkspace();
  if (!ws) return false;
  if (!ws.level(levelId)) {
    toast.warning(t("levels.targetMissing"));
    return false;
  }
  if (!(await openLevel(levelId))) return false;
  const map = useEditorStore.getState().project?.store.document.map;
  const handle = getCanvasHandle();
  if (point && map && handle) {
    const cell = cellOf(point, map.tileWidth, map.tileHeight);
    handle.centerOn(Math.min(map.width - 1, Math.max(0, cell.x)), Math.min(map.height - 1, Math.max(0, cell.y)));
  }
  return true;
}

/**
 * "Haritada seç": opens the portal's target level so the user can click
 * the target point there (Esc cancels). The point is written back into the
 * source level as one undo step there.
 */
export async function startPointPick(entityId: string, field: string = PORTAL_TARGET_POINT): Promise<boolean> {
  const ws = getLevelWorkspace();
  const state = useEditorStore.getState();
  const entity = state.project?.store.document.findEntity(entityId)?.entity;
  if (!ws || !entity || useLevelUi.getState().pick) return false;
  const target = portalTarget(entity);
  if (target === null || !ws.level(target)) {
    toast.warning(t("levels.pickNeedsLevel"));
    return false;
  }
  const pick: PointPick = { sourceLevelId: ws.activeId, entityId, field, targetLevelId: target, tool: state.tool };
  if (!(await openLevel(target))) return false;
  useLevelUi.setState({ pick });
  // A tool without a brush preview; clicks are taken by the pick overlay.
  useEditorStore.getState().setTool("select");
  const point = entity.fields[field];
  const map = useEditorStore.getState().project?.store.document.map;
  if (point && typeof point === "object" && map) {
    const cell = cellOf(point, map.tileWidth, map.tileHeight);
    getCanvasHandle()?.centerOn(cell.x, cell.y);
  }
  return true;
}

async function endPick(pick: PointPick): Promise<boolean> {
  useLevelUi.setState({ pick: null });
  const ok = await openLevel(pick.sourceLevelId);
  const editor = useEditorStore.getState();
  editor.setTool(pick.tool);
  if (ok && editor.project?.store.document.findEntity(pick.entityId)) editor.setSelectedEntity(pick.entityId);
  return ok;
}

/** Esc / "Vazgeç": back to the portal's level, nothing written. */
export async function cancelPointPick(): Promise<void> {
  const pick = useLevelUi.getState().pick;
  if (pick) await endPick(pick);
}

/** A cell of the target level was clicked: write its top-left pixel as the portal's target point. */
export async function finishPointPick(cell: { x: number; y: number }): Promise<boolean> {
  const pick = useLevelUi.getState().pick;
  const map = useEditorStore.getState().project?.store.document.map;
  if (!pick || !map) return false;
  const point = { x: cell.x * map.tileWidth, y: cell.y * map.tileHeight };
  if (!(await endPick(pick))) return false;
  const store = useEditorStore.getState().project?.store;
  if (!store?.document.findEntity(pick.entityId)) {
    toast.warning(t("levels.pickSourceGone"));
    return false;
  }
  try {
    store.dispatch({ type: "updateEntity", entityId: pick.entityId, fields: { [pick.field]: point } });
  } catch (error) {
    fail(error);
    return false;
  }
  toast.success(t("levels.pickDone", { x: point.x, y: point.y }));
  return true;
}

// ------------------------------------------------------------------ palette + canvas wiring

/**
 * "Level'a git: <ad>" palette entries and the canvas portal navigation.
 * Call once at startup; returns a cleanup.
 */
export function installLevelActions(): () => void {
  const unregister = registerPaletteProvider(() => {
    const ws = getLevelWorkspace();
    if (!ws || useLevelUi.getState().pick) return [];
    // The active map is listed too while the stamp editor tab is shown (going there leaves the stamp tab).
    const onStamp = useEditorStore.getState().project?.levelId?.startsWith("stamp:") ?? false;
    return ws.levels
      .filter((l) => onStamp || l.id !== ws.activeId)
      .map((l) => ({ key: `level.goto:${l.id}`, prefix: t("levels.goTo"), title: l.name, run: () => void openLevel(l.id) }));
  });

  // Portal double-click on the canvas (the canvas is re-mounted with each project).
  let unsubscribeNavigate: (() => void) | null = null;
  const unwatch = watchCanvasHandle((handle) => {
    unsubscribeNavigate?.();
    unsubscribeNavigate = handle?.onNavigate((r) => void navigateTo(r.levelId, r.point)) ?? null;
  });

  return () => {
    unregister();
    unwatch();
    unsubscribeNavigate?.();
  };
}
