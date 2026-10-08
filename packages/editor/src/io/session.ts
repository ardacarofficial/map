/**
 * App-level project actions: new / open / save / close, adding tilesets, and
 * dirty tracking. Wires the pure IO (`projectIo.ts`) to the stores, the
 * tileset image registry and toasts.
 */
import {
  createDocument,
  FormatError,
  MapStore,
  parseLevel,
  type MapDocument,
  type ProjectLevel,
  type Stamp,
} from "@smap/core";

import { t } from "../i18n";
import { useEditorStore, type OpenProject } from "../state/editorStore";
import {
  clearTilesetImages,
  getTilesetImage,
  setTilesetImage,
  type TilesetImage,
} from "../state/tilesetImages";
import { preloadCanvas } from "../ui/canvas/loadCanvas";
import { askUnsaved } from "../ui/dialogs/confirmStore";
import { toast } from "../ui/toast/toastStore";
import { useUiStore } from "../ui/uiStore";
import { getPlatform, FolderTakenError, RecentGoneError, type ProjectLocation, type RecentEntry } from "../platform";
import { UnsupportedError } from "./browserFs";
import { AutosaveScheduler } from "./autosave";
import { listBackups, writeBackup, type BackupEntry } from "./backups";
import { FileNotFoundError, type ProjectFileSystem } from "./fs";
import { useProjectLibrary } from "./projectLibrary";
import { LevelWorkspace, paletteProblems, type SavedLevel } from "./levelWorkspace";
import { DEFAULT_LEVEL_PATH, decodePng, defaultLevels, levelName, loadProject, ProjectOpenError } from "./projectIo";
import { useSaveStatus } from "./saveStatus";
import { hasPngSignature, inferTileSize, looksLikePng, planTileset, baseName } from "./tilesetImport";

/** Default map size for a project created by dropping a tileset. */
export const DEFAULT_MAP_WIDTH = 64;
export const DEFAULT_MAP_HEIGHT = 48;

/** A project folder from the platform (directory handle in the browser, path on the desktop). */
type ProjectFolder = ProjectLocation;

/** Where the open project lives on disk; `null` until first saved. */
let folder: ProjectFolder | null = null;
/**
 * v1.0: the open project's levels (list, cached stores, per-level dirty
 * state and the file text last read / written for change detection).
 */
let workspace: LevelWorkspace | null = null;
/** Text of the newest backup we wrote, per level path (no duplicate backups for unchanged saves). */
const lastBackupText = new Map<string, string>();
/** Active layer per level id, restored when the level is opened again. */
const activeLayerMemory = new Map<string, string | null>();
/** Number of writes in flight (focus checks skip while we write). */
let writesInFlight = 0;
/** Writes run one after another (manual save and autosave never overlap). */
let writeQueue: Promise<unknown> = Promise.resolve();

function setFolder(next: ProjectFolder | null): void {
  folder = next;
  lastBackupText.clear();
  useSaveStatus.setState({ hasFolder: next !== null, lastSavedAt: null, failed: false, diskConflict: null });
  getPlatform().watchProject(next);
}

/** The project folder, or null for a project that was never saved. */
export function getProjectFolder(): ProjectFolder | null {
  return folder;
}

/** v1.0: the open project's levels, or `null` (welcome screen). */
export function getLevelWorkspace(): LevelWorkspace | null {
  return workspace;
}

/**
 * Publishes the workspace state to the stores: per-level dirty dots and the
 * project-wide dirty flag (any level or the library unsaved).
 */
export function publishLevelState(options: { listChanged?: boolean } = {}): void {
  const ws = workspace;
  if (!ws) return;
  if (options.listChanged) useProjectLibrary.getState().setLevels(ws.levels);
  useProjectLibrary.getState().setDirtyLevels(ws.dirtyIds());
}

// ------------------------------------------------------------------ helpers

export interface NewProjectOptions {
  name: string;
  width: number;
  height: number;
  tileSize: number;
}

/** A fresh document with one empty tile layer. */
export function createProjectDocument(options: NewProjectOptions): OpenProject {
  const document = createDocument({
    width: options.width,
    height: options.height,
    tileWidth: options.tileSize,
    tileHeight: options.tileSize,
  });
  const store = new MapStore(document);
  store.dispatch({ type: "addLayer", layer: { name: t("layers.defaultName") } });
  // Building the document is not an undo step (the first undo must not remove the layer).
  store.clearHistory();
  return { name: options.name, store, levelPath: DEFAULT_LEVEL_PATH, levelId: defaultLevels(DEFAULT_LEVEL_PATH)[0]!.id };
}

function activate(
  project: OpenProject,
  images: readonly TilesetImage[],
  target: ProjectFolder | null,
  levelText: string | null = null,
  library: { stamps: Stamp[]; brokenStampFiles: string[]; levels: ProjectLevel[]; retiredLevelIds?: string[] } = {
    stamps: [],
    brokenStampFiles: [],
    levels: defaultLevels(project.levelPath),
  },
): void {
  const level = library.levels.find((l) => l.id === project.levelId) ?? library.levels.find((l) => l.path === project.levelPath);
  if (!level) throw new Error(`activate: level ${project.levelPath} is not in the project`);
  project = { ...project, levelId: level.id, levelPath: level.path };
  workspace = new LevelWorkspace({
    name: project.name,
    levels: library.levels,
    retiredLevelIds: library.retiredLevelIds ?? [],
    active: { id: level.id, store: project.store, knownText: levelText },
  });
  activeLayerMemory.clear();
  useProjectLibrary.getState().load(library);
  clearTilesetImages();
  for (const image of images) setTilesetImage(image);
  setFolder(target);
  useUiStore.getState().setActiveTileset(project.store.document.tilesets[0]?.id ?? null);
  useEditorStore.getState().setProject(project);
  useEditorStore.getState().setTool("brush");
}

/** Human-readable (Turkish) message for an IO error. */
export function describeError(error: unknown): string {
  if (error instanceof FormatError) return t("toast.formatError", { detail: error.message });
  if (error instanceof ProjectOpenError) return t(error.problem === "noLevel" ? "toast.noLevel" : "toast.noProjectFile");
  if (error instanceof FileNotFoundError) return t("toast.missingTilesetImage", { path: error.path });
  if (error instanceof UnsupportedError) return t("toast.fsUnsupported");
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return t("toast.permissionDenied");
  }
  return error instanceof Error ? error.message : String(error);
}

async function withBusy<T>(work: () => Promise<T>): Promise<T | undefined> {
  const ui = useUiStore.getState();
  if (ui.busy) return undefined;
  ui.setBusy(true);
  try {
    return await work();
  } finally {
    useUiStore.getState().setBusy(false);
  }
}

/**
 * When a project with unsaved changes is open, asks whether to save first.
 * Returns true when it is fine to continue (saved or discarded).
 */
export async function confirmDiscard(): Promise<boolean> {
  const { project, dirty } = useEditorStore.getState();
  if (!project || !dirty) return true;
  const choice = await askUnsaved(project.name);
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  return saveCurrentProject(false);
}

// ------------------------------------------------------------------ actions

export async function newProject(options: NewProjectOptions): Promise<void> {
  activate(createProjectDocument(options), [], null);
}

export function closeProject(): void {
  setFolder(null);
  workspace = null;
  activeLayerMemory.clear();
  useEditorStore.getState().setProject(null);
  clearTilesetImages();
  useUiStore.getState().setActiveTileset(null);
  useProjectLibrary.getState().load({ stamps: [], levels: [] });
}

interface DecodedPng {
  file: File;
  bytes: Uint8Array;
  bitmap: ImageBitmap;
}

async function decodeTilesetFile(file: File): Promise<DecodedPng | null> {
  if (!looksLikePng(file)) {
    toast.error(t("toast.notPng", { name: file.name }));
    return null;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPngSignature(bytes)) {
    toast.error(t("toast.notPng", { name: file.name }));
    return null;
  }
  try {
    return { file, bytes, bitmap: await decodePng(bytes) };
  } catch {
    toast.error(t("toast.imageDecodeFailed", { name: file.name }));
    return null;
  }
}

function addDecodedTileset(store: MapStore, png: DecodedPng): boolean {
  const doc: MapDocument = store.document;
  const tileSize = doc.map.tileWidth;
  const { width, height } = png.bitmap;
  const plan = planTileset(png.file.name, width, height, tileSize, new Set(doc.tilesets.map((ts) => ts.id)));
  if (!plan) {
    png.bitmap.close();
    toast.error(t("toast.imageTooSmall", { name: png.file.name, tile: tileSize }));
    return false;
  }
  // Register the image first so the canvas finds it when the tileset appears.
  setTilesetImage({ tilesetId: plan.tileset.id, bitmap: png.bitmap, bytes: png.bytes });
  store.dispatch({ type: "addTileset", tileset: plan.tileset });
  useUiStore.getState().setActiveTileset(plan.tileset.id);
  if (plan.uneven) {
    toast.warning(t("toast.tileSizeMismatch", { name: png.file.name, width, height, tile: tileSize }));
  } else {
    toast.success(
      t("toast.tilesetAdded", { name: plan.tileset.name, count: plan.tileset.columns * plan.tileset.rows }),
    );
  }
  return true;
}

/** Adds PNG files as tilesets to the open project (drag-drop, + button). */
export async function addTilesetFiles(files: readonly File[]): Promise<void> {
  for (const file of files) {
    const store = useEditorStore.getState().project?.store;
    if (!store) return;
    const png = await decodeTilesetFile(file);
    if (png) addDecodedTileset(store, png);
  }
}

/** Welcome-screen drop: a new 64×48 project around the first PNG, then the rest. */
export async function createProjectFromTilesets(files: readonly File[]): Promise<void> {
  const [first, ...rest] = files;
  if (!first) return;
  if (!(await confirmDiscard())) return;
  const png = await decodeTilesetFile(first);
  if (!png) return;
  const tileSize = inferTileSize(png.bitmap.width, png.bitmap.height, first.name);
  const project = createProjectDocument({
    name: baseName(first.name),
    width: DEFAULT_MAP_WIDTH,
    height: DEFAULT_MAP_HEIGHT,
    tileSize,
  });
  activate(project, [], null);
  addDecodedTileset(project.store, png);
  await addTilesetFiles(rest);
}

/** A finished save (manual or autosave). */
export interface ProjectSavedEvent {
  /** The open (active) level when the save started. */
  project: OpenProject;
  fs: ProjectFileSystem;
  /** True for Ctrl+S / the save button, false for autosave. */
  manual: boolean;
  /** v1.0: every level this save wrote (the active one first in project order is not guaranteed). */
  levels: readonly SavedLevel[];
}

const savedListeners = new Set<(event: ProjectSavedEvent) => void>();

/** Runs `listener` after every successful save (e.g. auto export to Unity). Returns an unsubscribe. */
export function onProjectSaved(listener: (event: ProjectSavedEvent) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

/**
 * Writes the project into `target` (queued behind other writes), then a
 * backup of the level. Updates the remembered disk text and the save status.
 */
async function writeProjectFiles(target: ProjectFolder, project: OpenProject, manual = false): Promise<void> {
  const ws = workspace;
  if (!ws) return;
  const run = async () => {
    writesInFlight++;
    useSaveStatus.setState({ saving: true });
    try {
      const lib = useProjectLibrary.getState();
      ws.name = project.name;
      const levels = await ws.save(target.fs, {
        stamps: lib.stamps,
        keepStampFiles: lib.brokenStampFiles,
        tilesetBytes: (id) => getTilesetImage(id)?.bytes,
      });
      if (workspace !== ws) return;
      if (folder !== target) setFolder(target);
      useSaveStatus.setState({ lastSavedAt: Date.now(), failed: false });
      publishLevelState();
      for (const listener of savedListeners) {
        try {
          listener({ project, fs: target.fs, manual, levels });
        } catch (error) {
          console.error(error);
        }
      }
      const now = new Date();
      for (const level of levels) {
        if (level.text === lastBackupText.get(level.path)) continue;
        try {
          await writeBackup(target.fs, levelName(level.path), level.text, now);
          lastBackupText.set(level.path, level.text);
        } catch (error) {
          // A failed backup must not fail the save itself.
          console.warn("Backup failed", error);
        }
      }
    } finally {
      writesInFlight--;
      if (writesInFlight === 0) useSaveStatus.setState({ saving: false });
    }
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => undefined);
  return next;
}

/** After a save: the project stays dirty when a level or the library changed meanwhile. */
function settleDirty(libRevision: number): void {
  const ws = workspace;
  if (!ws) return;
  const dirty = ws.hasUnsavedLevels || useProjectLibrary.getState().revision !== libRevision;
  if (useEditorStore.getState().dirty !== dirty) useEditorStore.getState().setDirty(dirty);
  publishLevelState();
}

/**
 * Saves the open project. The first save (or `saveAs`) asks for a folder;
 * later saves reuse it without asking. Returns true on success.
 */
export async function saveCurrentProject(saveAs: boolean): Promise<boolean> {
  const project = useEditorStore.getState().project;
  if (!project) return false;
  const result = await withBusy(async () => {
    try {
      let target = folder;
      if (!target || saveAs) {
        const picked = await getPlatform().pickProjectFolder(project.name, folder);
        if (!picked) return false;
        target = picked;
      }
      const ws = workspace;
      const libRevision = useProjectLibrary.getState().revision;
      await writeProjectFiles(target, project, true);
      // The user may still be drawing (or switching levels) while files are written.
      if (workspace !== ws) return true;
      settleDirty(libRevision);
      useSaveStatus.setState({ diskConflict: null });
      toast.success(t("toast.saved", { name: project.name || target.fs.name }));
      void getPlatform().recents.add(target, project.name).catch((error: unknown) => console.warn(error));
      return true;
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof FolderTakenError
          ? t("toast.folderTaken", { name: error.folder })
          : t("toast.saveFailed", { detail: describeError(error) }),
      );
      return false;
    }
  });
  return result ?? false;
}

/**
 * Autosave: writes the project when it has a folder and unsaved changes.
 * Never asks for a folder. Skips (and asks the user) when the file changed
 * on disk since we last read or wrote it.
 */
export async function autosaveNow(): Promise<void> {
  const { project, dirty } = useEditorStore.getState();
  const target = folder;
  const ws = workspace;
  if (!project || !target || !ws || !dirty || useSaveStatus.getState().diskConflict) return;
  if (project.store.inTransaction) {
    // Mid-stroke: try again once the stroke is done.
    autosave?.notifyChange();
    return;
  }
  const conflict = await ws.findDiskConflict(target.fs);
  if (folder !== target || workspace !== ws) return;
  if (conflict) {
    useSaveStatus.setState({ diskConflict: conflict });
    return;
  }
  const libRevision = useProjectLibrary.getState().revision;
  await writeProjectFiles(target, useEditorStore.getState().project ?? project);
  if (workspace === ws) settleDirty(libRevision);
}

let autosave: AutosaveScheduler | null = null;

// ------------------------------------------------------------------ external changes

let diskCheckRunning = false;

/** Compares the level file on disk with what we last read/wrote; opens the dialog when it differs. */
export async function checkDiskForChanges(): Promise<void> {
  const project = useEditorStore.getState().project;
  const target = folder;
  const ws = workspace;
  if (!project || !target || !ws || diskCheckRunning || writesInFlight > 0 || useSaveStatus.getState().diskConflict) return;
  diskCheckRunning = true;
  try {
    const change = await ws.activeDiskChange(target.fs);
    // Ignore the result when a write started meanwhile (it may be our own file).
    if (writesInFlight > 0 || folder !== target || useEditorStore.getState().project !== project) return;
    if (change) useSaveStatus.setState({ diskConflict: change });
  } catch (error) {
    console.warn("Disk check failed", error);
  } finally {
    diskCheckRunning = false;
  }
}

/** "Diskten yükle": reopens the project from its folder. */
export async function reloadFromDisk(): Promise<void> {
  const target = folder;
  useSaveStatus.setState({ diskConflict: null });
  if (!target) return;
  await withBusy(async () => {
    try {
      await openFromFolder(target, workspace?.activeId);
      toast.success(t("toast.reloaded", { name: useEditorStore.getState().project?.name ?? target.fs.name }));
    } catch (error) {
      console.error(error);
      toast.error(t("toast.openFailed", { detail: describeError(error) }));
    }
  });
}

/** "Benimkini koru": keep the map here; the next save overwrites the file on disk. */
export function keepMine(): void {
  const conflict = useSaveStatus.getState().diskConflict;
  if (conflict) workspace?.acceptDiskText(conflict.path, conflict.diskText);
  useSaveStatus.setState({ diskConflict: null });
  if (useEditorStore.getState().project) useEditorStore.getState().setDirty(true);
}

// ------------------------------------------------------------------ backups

/** Backups of the open level, newest first (empty for a project without a folder). */
export async function listProjectBackups(): Promise<BackupEntry[]> {
  const project = useEditorStore.getState().project;
  if (!project || !folder) return [];
  return listBackups(folder.fs, levelName(workspace?.activeLevel.path ?? project.levelPath));
}

/**
 * Opens a backup in place of the current level. The result is marked dirty:
 * saving it makes it the current version (undo history starts fresh).
 */
export async function openBackup(entry: BackupEntry): Promise<boolean> {
  const project = useEditorStore.getState().project;
  const target = folder;
  if (!project || !target) return false;
  try {
    const text = await target.fs.readText(entry.path);
    const document = parseLevel(text, project.store.document.tilesets, project.store.document.entityTypes);
    const store = new MapStore(document);
    store.clearHistory();
    workspace?.replaceActiveStore(store);
    useEditorStore.getState().switchLevel({ ...project, store }, useEditorStore.getState().activeLayerId);
    useEditorStore.getState().setDirty(true);
    publishLevelState();
    toast.success(t("toast.backupOpened", { time: entry.date.toLocaleString() }));
    return true;
  } catch (error) {
    console.error(error);
    toast.error(t("toast.backupFailed", { detail: describeError(error) }));
    return false;
  }
}

async function openFromFolder(target: ProjectFolder, levelId?: string): Promise<string> {
  preloadCanvas(); // loads while the files are read
  const loaded = await loadProject(target.fs, decodePng, levelId ? { levelId } : {});
  const store = new MapStore(loaded.document);
  store.clearHistory();
  const project: OpenProject = { name: loaded.name, store, levelPath: loaded.levelPath, levelId: loaded.levelId };
  activate(project, loaded.images, target, loaded.levelText, {
    stamps: loaded.stamps,
    brokenStampFiles: loaded.brokenStamps,
    levels: loaded.levels,
    retiredLevelIds: loaded.retiredLevelIds,
  });
  for (const path of loaded.brokenStamps) toast.warning(t("toast.stampUnreadable", { path }));
  for (const path of loaded.missingImages) toast.warning(t("toast.missingTilesetImage", { path }));
  warnPalette(loaded.levels.find((l) => l.id === loaded.levelId)?.name ?? levelName(loaded.levelPath), loaded.document);
  return loaded.name;
}

async function openLocation(location: ProjectLocation): Promise<boolean> {
  const name = await openFromFolder(location);
  toast.success(t("toast.opened", { name }));
  void getPlatform().recents.add(location, name).catch((error: unknown) => console.warn(error));
  return true;
}

/** Ctrl+O: pick a project and open it. */
export async function openProjectFromPicker(): Promise<void> {
  if (!(await confirmDiscard())) return;
  await withBusy(async () => {
    try {
      const location = await getPlatform().openProjectDialog();
      if (location) await openLocation(location);
    } catch (error) {
      console.error(error);
      toast.error(t("toast.openFailed", { detail: describeError(error) }));
    }
  });
}

/**
 * Opens a project the OS handed us (desktop: double-clicked `.smap`, startup
 * argument, second instance). Asks about unsaved changes first.
 */
export async function openProjectPath(path: string): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  const result = await withBusy(async () => {
    try {
      return await openLocation(await getPlatform().openPath(path));
    } catch (error) {
      console.error(error);
      toast.error(t("toast.openFailed", { detail: describeError(error) }));
      return false;
    }
  });
  return result ?? false;
}

/** Opens an entry of the recent-projects list (asks for permission again if needed). */
export async function openRecentProject(recent: RecentEntry): Promise<void> {
  if (!(await confirmDiscard())) return;
  await withBusy(async () => {
    try {
      const location = await getPlatform().recents.open(recent);
      if (!location) {
        toast.error(t("toast.permissionDenied"));
        return;
      }
      await openLocation(location);
    } catch (error) {
      console.error(error);
      if (error instanceof RecentGoneError || (error instanceof DOMException && error.name === "NotFoundError")) {
        toast.error(t("toast.recentGone", { name: recent.location }));
        void getPlatform().recents.remove(recent).catch(() => undefined);
        return;
      }
      toast.error(t("toast.openFailed", { detail: describeError(error) }));
    }
  });
}

// ------------------------------------------------------------------ levels (v1.0)

/** Toasts the palette entries of a freshly read level that cannot be drawn (core `paletteWarnings`, translated). */
function warnPalette(level: string, document: MapDocument): void {
  const problems = paletteProblems(document);
  if (problems.missingTilesets.length > 0) {
    toast.warning(t("levels.paletteMissingTileset", { level, ids: problems.missingTilesets.join(", ") }));
  }
  if (problems.outOfRange > 0) toast.warning(t("levels.paletteOutOfRange", { level, count: problems.outOfRange }));
}

/** Level switches run one after another (a second click waits for the first file read). */
let levelQueue: Promise<unknown> = Promise.resolve();

/**
 * Opens another level of the project (from memory, or its file). The
 * current level stays in memory while it has unsaved changes or history, so
 * nothing is lost and its undo steps survive. Returns true when `levelId` is
 * the active level afterwards.
 */
export function openLevel(levelId: string): Promise<boolean> {
  const run = () => switchToLevel(levelId);
  const next = levelQueue.then(run, run);
  levelQueue = next.catch(() => false);
  return next;
}

async function switchToLevel(levelId: string): Promise<boolean> {
  const ws = workspace;
  const state = useEditorStore.getState();
  const project = state.project;
  if (!ws || !project) return false;
  if (levelId === ws.activeId) return true;
  const level = ws.level(levelId);
  if (!level || project.store.inTransaction) return false;
  activeLayerMemory.set(ws.activeId, state.activeLayerId);
  let entry;
  const fromDisk = !ws.entry(levelId);
  try {
    entry = await ws.activate(levelId, folder?.fs ?? null);
    if (fromDisk) warnPalette(level.name, entry.store.document);
  } catch (error) {
    console.error(error);
    toast.error(t("levels.openFailed", { name: level.name, detail: describeError(error) }));
    return false;
  }
  if (workspace !== ws) return false;
  const active = ws.activeLevel;
  const current = useEditorStore.getState().project ?? project;
  useEditorStore
    .getState()
    .switchLevel({ name: current.name, store: entry.store, levelPath: active.path, levelId: active.id }, activeLayerMemory.get(active.id) ?? null);
  publishLevelState();
  return true;
}

// ------------------------------------------------------------------ dirty tracking

/**
 * Marks the project dirty on every document change and warns before the tab
 * closes with unsaved work. Call once at startup; returns a cleanup.
 */
export function installSession(): () => void {
  const scheduler = new AutosaveScheduler({
    save: autosaveNow,
    onError: (error) => {
      console.error(error);
      // One toast per failure streak, not one per attempt.
      if (!useSaveStatus.getState().failed) toast.error(t("toast.autosaveFailed", { detail: describeError(error) }));
      useSaveStatus.setState({ failed: true });
    },
  });
  autosave = scheduler;
  let unsubscribeStore: (() => void) | null = null;
  const watch = (project: OpenProject | null) => {
    unsubscribeStore?.();
    unsubscribeStore = null;
    scheduler.cancel();
    if (!project) return;
    unsubscribeStore = project.store.subscribe((event) => {
      if (event.cells.length === 0 && event.structure.length === 0) return;
      const ws = workspace;
      if (ws && ws.entry(ws.activeId)?.store === project.store && !ws.isDirty(ws.activeId)) {
        ws.markDirty(ws.activeId);
        publishLevelState();
      }
      if (!useEditorStore.getState().dirty) useEditorStore.getState().setDirty(true);
      if (folder) scheduler.notifyChange();
    });
  };
  watch(useEditorStore.getState().project);
  // Stamp library edits are saved with the project like map edits.
  const unsubscribeLibrary = useProjectLibrary.subscribe((state, prev) => {
    if (state.revision === prev.revision || !useEditorStore.getState().project) return;
    if (!useEditorStore.getState().dirty) useEditorStore.getState().setDirty(true);
    if (folder) scheduler.notifyChange();
  });
  const unsubscribeEditor = useEditorStore.subscribe((state, prev) => {
    if (state.project !== prev.project) watch(state.project);
  });

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!useEditorStore.getState().dirty) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // "Changed on disk" hints come from the platform (desktop: file watcher,
  // browser: window focus); `platform/fileChanges.ts` reacts to them.

  return () => {
    unsubscribeStore?.();
    unsubscribeEditor();
    unsubscribeLibrary();
    scheduler.dispose();
    if (autosave === scheduler) autosave = null;
    window.removeEventListener("beforeunload", onBeforeUnload);
  };
}
