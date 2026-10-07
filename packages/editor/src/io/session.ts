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
  PROJECT_FILE_NAME,
  type MapDocument,
} from "@smap/core";

import { t } from "../i18n";
import { useEditorStore, type OpenProject } from "../state/editorStore";
import {
  clearTilesetImages,
  getTilesetImage,
  setTilesetImage,
  type TilesetImage,
} from "../state/tilesetImages";
import { askUnsaved } from "../ui/dialogs/confirmStore";
import { toast } from "../ui/toast/toastStore";
import { useUiStore } from "../ui/uiStore";
import { DirectoryHandleFileSystem, ensureReadWrite, pickDirectory, UnsupportedError } from "./browserFs";
import { AutosaveScheduler } from "./autosave";
import { listBackups, writeBackup, type BackupEntry } from "./backups";
import { compareDisk } from "./externalChange";
import { FileNotFoundError, type ProjectFileSystem } from "./fs";
import { DEFAULT_LEVEL_PATH, decodePng, levelName, loadProject, ProjectOpenError, saveProject } from "./projectIo";
import { useSaveStatus } from "./saveStatus";
import { forgetRecent, rememberRecent, type RecentProject } from "./recents";
import { hasPngSignature, inferTileSize, looksLikePng, planTileset, baseName } from "./tilesetImport";

/** Default map size for a project created by dropping a tileset. */
export const DEFAULT_MAP_WIDTH = 64;
export const DEFAULT_MAP_HEIGHT = 48;

interface ProjectFolder {
  fs: ProjectFileSystem;
  handle: FileSystemDirectoryHandle | null;
}

/** Where the open project lives on disk; `null` until first saved. */
let folder: ProjectFolder | null = null;
/** The level file as we last read or wrote it (external change detection). */
let knownLevelText: string | null = null;
/** Text of the newest backup we wrote (no duplicate backups for unchanged saves). */
let lastBackupText: string | null = null;
/** Number of writes in flight (focus checks skip while we write). */
let writesInFlight = 0;
/** Writes run one after another (manual save and autosave never overlap). */
let writeQueue: Promise<unknown> = Promise.resolve();

function setFolder(next: ProjectFolder | null, levelText: string | null): void {
  folder = next;
  knownLevelText = levelText;
  lastBackupText = null;
  useSaveStatus.setState({ hasFolder: next !== null, lastSavedAt: null, failed: false, diskConflict: null });
}

/** The project folder, or null for a project that was never saved. */
export function getProjectFolder(): ProjectFolder | null {
  return folder;
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
  return { name: options.name, store, levelPath: DEFAULT_LEVEL_PATH };
}

function activate(
  project: OpenProject,
  images: readonly TilesetImage[],
  target: ProjectFolder | null,
  levelText: string | null = null,
): void {
  clearTilesetImages();
  for (const image of images) setTilesetImage(image);
  setFolder(target, levelText);
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
  setFolder(null, null);
  useEditorStore.getState().setProject(null);
  clearTilesetImages();
  useUiStore.getState().setActiveTileset(null);
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

/** Folder name for a project inside a chosen parent folder. */
function folderNameFor(projectName: string): string {
  const name = projectName.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return name.length > 0 ? name : "harita";
}

async function hasVisibleEntries(handle: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const name of handle.keys()) if (!name.startsWith(".")) return true;
  return false;
}

/**
 * The folder to save a new project into: the picked folder when it is empty,
 * otherwise a sub-folder named after the project (refusing to overwrite a
 * different project there).
 */
async function resolveSaveFolder(picked: FileSystemDirectoryHandle, projectName: string): Promise<FileSystemDirectoryHandle> {
  if (!(await hasVisibleEntries(picked))) return picked;
  const name = folderNameFor(projectName);
  const sub = await picked.getDirectoryHandle(name, { create: true });
  const current = folder?.handle;
  if (current && (await current.isSameEntry(sub))) return sub;
  if ((await new DirectoryHandleFileSystem(sub).list("")).includes(PROJECT_FILE_NAME)) {
    throw new FolderTakenError(name);
  }
  return sub;
}

class FolderTakenError extends Error {
  readonly folder: string;
  constructor(folderName: string) {
    super(folderName);
    this.folder = folderName;
  }
}

/**
 * Writes the project into `target` (queued behind other writes), then a
 * backup of the level. Updates the remembered disk text and the save status.
 */
async function writeProjectFiles(target: ProjectFolder, project: OpenProject): Promise<void> {
  const run = async () => {
    writesInFlight++;
    useSaveStatus.setState({ saving: true });
    try {
      const levelText = await saveProject(target.fs, {
        name: project.name,
        document: project.store.document,
        levelPath: project.levelPath,
        tilesetBytes: (id) => getTilesetImage(id)?.bytes,
      });
      if (useEditorStore.getState().project !== project) return;
      if (folder !== target) setFolder(target, levelText);
      knownLevelText = levelText;
      useSaveStatus.setState({ lastSavedAt: Date.now(), failed: false });
      if (levelText !== lastBackupText) {
        try {
          await writeBackup(target.fs, levelName(project.levelPath), levelText, new Date());
          lastBackupText = levelText;
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
        const picked = await pickDirectory();
        if (!picked) return false;
        const handle = await resolveSaveFolder(picked, project.name);
        target = { fs: new DirectoryHandleFileSystem(handle), handle };
      }
      const revision = project.store.revision;
      await writeProjectFiles(target, project);
      // The user may still be drawing while files are written.
      if (useEditorStore.getState().project !== project) return true;
      if (project.store.revision === revision) useEditorStore.getState().setDirty(false);
      useSaveStatus.setState({ diskConflict: null });
      toast.success(t("toast.saved", { name: target.fs.name }));
      if (target.handle) void rememberRecent(project.name, target.handle);
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

async function readLevelText(fs: ProjectFileSystem, path: string): Promise<string | null> {
  try {
    return await fs.readText(path);
  } catch (error) {
    if (error instanceof FileNotFoundError) return null;
    throw error;
  }
}

/**
 * Autosave: writes the project when it has a folder and unsaved changes.
 * Never asks for a folder. Skips (and asks the user) when the file changed
 * on disk since we last read or wrote it.
 */
export async function autosaveNow(): Promise<void> {
  const { project, dirty } = useEditorStore.getState();
  const target = folder;
  if (!project || !target || !dirty || useSaveStatus.getState().diskConflict) return;
  if (project.store.inTransaction) {
    // Mid-stroke: try again once the stroke is done.
    autosave?.notifyChange();
    return;
  }
  const diskText = await readLevelText(target.fs, project.levelPath);
  if (folder !== target || useEditorStore.getState().project !== project) return;
  if (compareDisk(diskText, knownLevelText) === "changed" && diskText !== null) {
    useSaveStatus.setState({ diskConflict: { path: project.levelPath, diskText } });
    return;
  }
  const revision = project.store.revision;
  await writeProjectFiles(target, project);
  if (useEditorStore.getState().project === project && project.store.revision === revision) {
    useEditorStore.getState().setDirty(false);
  }
}

let autosave: AutosaveScheduler | null = null;

// ------------------------------------------------------------------ external changes

let diskCheckRunning = false;

/** Compares the level file on disk with what we last read/wrote; opens the dialog when it differs. */
export async function checkDiskForChanges(): Promise<void> {
  const project = useEditorStore.getState().project;
  const target = folder;
  if (!project || !target || diskCheckRunning || writesInFlight > 0 || useSaveStatus.getState().diskConflict) return;
  diskCheckRunning = true;
  try {
    const diskText = await readLevelText(target.fs, project.levelPath);
    // Ignore the result when a write started meanwhile (it may be our own file).
    if (writesInFlight > 0 || folder !== target || useEditorStore.getState().project !== project) return;
    if (diskText !== null && compareDisk(diskText, knownLevelText) === "changed") {
      useSaveStatus.setState({ diskConflict: { path: project.levelPath, diskText } });
    }
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
      await openFromFolder(target);
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
  if (conflict) knownLevelText = conflict.diskText;
  useSaveStatus.setState({ diskConflict: null });
  if (useEditorStore.getState().project) useEditorStore.getState().setDirty(true);
}

// ------------------------------------------------------------------ backups

/** Backups of the open level, newest first (empty for a project without a folder). */
export async function listProjectBackups(): Promise<BackupEntry[]> {
  const project = useEditorStore.getState().project;
  if (!project || !folder) return [];
  return listBackups(folder.fs, levelName(project.levelPath));
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
    const document = parseLevel(text, project.store.document.tilesets);
    const store = new MapStore(document);
    store.clearHistory();
    useEditorStore.getState().setProject({ ...project, store });
    useEditorStore.getState().setDirty(true);
    toast.success(t("toast.backupOpened", { time: entry.date.toLocaleString() }));
    return true;
  } catch (error) {
    console.error(error);
    toast.error(t("toast.backupFailed", { detail: describeError(error) }));
    return false;
  }
}

async function openFromFolder(target: ProjectFolder): Promise<string> {
  const loaded = await loadProject(target.fs, decodePng);
  const store = new MapStore(loaded.document);
  store.clearHistory();
  const project: OpenProject = { name: loaded.name, store, levelPath: loaded.levelPath };
  activate(project, loaded.images, target, loaded.levelText);
  for (const path of loaded.missingImages) toast.warning(t("toast.missingTilesetImage", { path }));
  return loaded.name;
}

async function openFromHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const name = await openFromFolder({ fs: new DirectoryHandleFileSystem(handle), handle });
  toast.success(t("toast.opened", { name }));
  void rememberRecent(name, handle);
  return true;
}

/** Ctrl+O: pick a project folder and open it. */
export async function openProjectFromPicker(): Promise<void> {
  if (!(await confirmDiscard())) return;
  await withBusy(async () => {
    try {
      const handle = await pickDirectory();
      if (handle) await openFromHandle(handle);
    } catch (error) {
      console.error(error);
      toast.error(t("toast.openFailed", { detail: describeError(error) }));
    }
  });
}

/** Opens an entry of the recent-projects list (asks for permission again if needed). */
export async function openRecentProject(recent: RecentProject): Promise<void> {
  if (!(await confirmDiscard())) return;
  await withBusy(async () => {
    try {
      if (!(await ensureReadWrite(recent.handle))) {
        toast.error(t("toast.permissionDenied"));
        return;
      }
      await openFromHandle(recent.handle);
    } catch (error) {
      console.error(error);
      if (error instanceof DOMException && error.name === "NotFoundError") {
        toast.error(t("toast.recentGone", { name: recent.folder }));
        void forgetRecent(recent.openedAt);
        return;
      }
      toast.error(t("toast.openFailed", { detail: describeError(error) }));
    }
  });
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
      if (!useEditorStore.getState().dirty) useEditorStore.getState().setDirty(true);
      if (folder) scheduler.notifyChange();
    });
  };
  watch(useEditorStore.getState().project);
  const unsubscribeEditor = useEditorStore.subscribe((state, prev) => {
    if (state.project !== prev.project) watch(state.project);
  });

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!useEditorStore.getState().dirty) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  return () => {
    unsubscribeStore?.();
    unsubscribeEditor();
    window.removeEventListener("beforeunload", onBeforeUnload);
  };
}
