/**
 * App-level project actions: new / open / save / close, adding tilesets, and
 * dirty tracking. Wires the pure IO (`projectIo.ts`) to the stores, the
 * tileset image registry and toasts.
 */
import {
  createDocument,
  DEFAULT_PROJECT_SETTINGS,
  FormatError,
  isTileLayer,
  MapStore,
  normalizeProjectSettings,
  parseLevel,
  type MapDocument,
  type ProjectLevel,
  type ProjectSettings,
  type Stamp,
  type TileGridSpec,
  type Tileset,
} from "@smap/core";

import { t } from "../i18n";
import { useEditorStore, type OpenProject } from "../state/editorStore";
import { clearLevelViews } from "../state/levelViewMemory";
import {
  allTilesetImages,
  clearTilesetImages,
  getTilesetImage,
  setTilesetImage,
  type TilesetImage,
} from "../state/tilesetImages";
import { preloadCanvas } from "../ui/canvas/loadCanvas";
import { askUnsaved } from "../ui/dialogs/confirmStore";
import { toast, useToastStore } from "../ui/toast/toastStore";
import { undoStepAction } from "../commands/undoStepAction";
import { isConfidentGuess, readAutoAdd } from "../ui/tilesetImport/bulkModel";
import { groupNames } from "../ui/tileset/libraryModel";
import { useUiStore } from "../ui/uiStore";
import { getPlatform, FolderTakenError, RecentGoneError, type ProjectLocation, type RecentEntry } from "../platform";
import { UnsupportedError } from "./browserFs";
import { AutosaveScheduler } from "./autosave";
import { listBackups, writeBackup, type BackupEntry } from "./backups";
import { FileNotFoundError, type ProjectFileSystem } from "./fs";
import { useProjectLibrary } from "./projectLibrary";
import { LevelWorkspace, paletteProblems, projectDataOf, type SavedLevel } from "./levelWorkspace";
import { DEFAULT_LEVEL_PATH, decodePng, defaultLevels, levelName, loadProject, ProjectOpenError } from "./projectIo";
import { useSaveStatus } from "./saveStatus";
import { readSaveIndicator, subscribeSaveIndicator } from "./saveIndicator";
import { refreshRecentProjects } from "../platform/recentProjects";
import { captureMapThumbnail } from "../platform/recentThumbnail";
import { addTemplateLayers, type LayerSpec } from "../ui/projectSettings/projectTemplates";
import { updateExportSettings } from "../export/exportSettings";
import { hasPngSignature, looksLikePng, planTilesetGrid, baseName } from "./tilesetImport";
import { inferDraft, readLastSpec, rememberSpec } from "../ui/tilesetImport/importModel";
import { openBulkCard, openTilesetCard, type BulkFile, type BulkRequest, type CardMode } from "../ui/tilesetImport/importStore";
import { readAlpha } from "../ui/tilesetImport/imageAlpha";

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
  /** Tile height when it differs from the width (default: `tileSize`). */
  tileHeight?: number;
  /** Layers bottom to top (default: one tile layer). */
  layers?: readonly LayerSpec[];
}

/** Round 4: what the new project dialog adds on top of {@link NewProjectOptions}. */
export interface NewProjectSetup extends NewProjectOptions {
  /** Project settings saved in `project.smap` (new-level defaults, Unity options). */
  settings?: ProjectSettings;
  /** Folder chosen up front ("Klasör seç…"): the project is written there at once, so autosave works from the start. */
  folder?: ProjectLocation | null;
  /** Starting tilesets (decoded, with their grid). */
  tilesets?: readonly PlannedTileset[];
  /** Unity export folder picked in the dialog (browser: a directory handle, remembered per project). */
  unityDir?: FileSystemDirectoryHandle | null;
}

/** A fresh document with the given layers (default: one empty tile layer). */
export function createProjectDocument(options: NewProjectOptions): OpenProject {
  const document = createDocument({
    width: options.width,
    height: options.height,
    tileWidth: options.tileSize,
    tileHeight: options.tileHeight ?? options.tileSize,
  });
  const store = new MapStore(document);
  addTemplateLayers(store, options.layers && options.layers.length > 0 ? options.layers : [{ name: t("layers.defaultName"), kind: "tile" }]);
  // Building the document is not an undo step (the first undo must not remove the layer).
  store.clearHistory();
  return { name: options.name, store, levelPath: DEFAULT_LEVEL_PATH, levelId: defaultLevels(DEFAULT_LEVEL_PATH)[0]!.id };
}

function activate(
  project: OpenProject,
  images: readonly TilesetImage[],
  target: ProjectFolder | null,
  levelText: string | null = null,
  library: { stamps: Stamp[]; brokenStampFiles: string[]; levels: ProjectLevel[]; retiredLevelIds?: string[]; settings?: ProjectSettings } = {
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
  clearLevelViews();
  useProjectLibrary.getState().load(library);
  clearTilesetImages();
  for (const image of images) setTilesetImage(image);
  setFolder(target);
  useUiStore.getState().setActiveTileset(project.store.document.tilesets[0]?.id ?? null);
  useEditorStore.getState().setProject(project);
  useEditorStore.getState().setTool("brush");
  announceTerrainMigration(project.store.document, level.id);
}

/**
 * An old project was converted to the terrain-as-brush format on load
 * (terrain grid layers dropped, tileset terrains turned into terrain sets;
 * core `MapDocument.migrations`): the level counts as changed, so the next
 * save writes the new format, and a toast says so.
 */
function announceTerrainMigration(document: MapDocument, levelId: string): void {
  const migrated = document.migrations.length > 0 || document.tilesets.some((ts) => (ts.terrains?.length ?? 0) > 0);
  if (!migrated) return;
  const ws = workspace;
  if (ws && !ws.isDirty(levelId)) ws.markDirty(levelId);
  if (!useEditorStore.getState().dirty) useEditorStore.getState().setDirty(true);
  publishLevelState();
  if (folder) autosave?.notifyChange();
  toast.info(t("terrain.migrated"));
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
 * Extra unsaved work outside the level workspace (the stamp editor tab).
 * `dirty` is checked by the browser's close guard; `settle` runs before the
 * project is discarded and may ask (false = cancel).
 */
export interface UnsavedGuard {
  dirty(): boolean;
  settle(): Promise<boolean>;
}

const unsavedGuards = new Set<UnsavedGuard>();

let unsavedGuardsChanged: (() => void) | null = null;

export function registerUnsavedGuard(guard: UnsavedGuard): () => void {
  unsavedGuards.add(guard);
  unsavedGuardsChanged?.();
  return () => {
    unsavedGuards.delete(guard);
    unsavedGuardsChanged?.();
  };
}

/** A guard's dirty state changed (the desktop host must know before the window closes). */
export function notifyUnsavedGuards(): void {
  unsavedGuardsChanged?.();
}

/**
 * When a project with unsaved changes is open, asks whether to save first.
 * Returns true when it is fine to continue (saved or discarded).
 */
export async function confirmDiscard(): Promise<boolean> {
  for (const guard of unsavedGuards) if (guard.dirty() && !(await guard.settle())) return false;
  const project = useEditorStore.getState().project;
  if (!project || !readSaveIndicator().unsaved) return true;
  const choice = await askUnsaved(project.name);
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  return saveCurrentProject(false);
}

// ------------------------------------------------------------------ actions

/**
 * Creates a project (new project dialog, welcome templates). With a folder
 * chosen up front the project is written there right away (and listed in
 * recents), so autosave runs from the first stroke. Starting tilesets and
 * the layer template are part of the initial state, not undo steps.
 */
export async function newProject(options: NewProjectSetup): Promise<void> {
  const project = createProjectDocument(options);
  const settings = options.settings ?? DEFAULT_PROJECT_SETTINGS;
  activate(project, [], null, null, { stamps: [], brokenStampFiles: [], levels: defaultLevels(project.levelPath, t("levels.firstMapName")), settings });
  if (options.tilesets && options.tilesets.length > 0) {
    const added = addDecodedTilesets(project.store, options.tilesets);
    if (added.length > 0) toast.success(t("tilesetImport.added", { name: added[0]!.name, count: added[0]!.columns * added[0]!.rows }));
  }
  // Starting a project is not an undo step.
  project.store.clearHistory();
  // Start drawing on the bottom tile layer (Zemin), not on the template's top collision layer.
  const ground = project.store.document.layers.find(isTileLayer);
  if (ground) useEditorStore.getState().setActiveLayer(ground.id);
  if (options.unityDir || settings.unity.exportOnSave) {
    void updateExportSettings(project.name, {
      ...(options.unityDir ? { unityDir: options.unityDir } : {}),
      autoUnity: settings.unity.exportOnSave,
    });
  }
  const target = options.folder ?? null;
  if (!target) return;
  try {
    useEditorStore.getState().setDirty(true);
    const ws = workspace;
    const libRevision = useProjectLibrary.getState().revision;
    await writeProjectFiles(target, project, true);
    if (workspace !== ws) return;
    settleDirty(libRevision);
    addRecent(target, project);
  } catch (error) {
    console.error(error);
    toast.error(t("toast.saveFailed", { detail: describeError(error) }));
  }
}

/** Replaces the open project's settings (project settings dialog); saved with the next (auto)save. */
export function updateProjectSettings(settings: ProjectSettings): void {
  if (!useEditorStore.getState().project) return;
  useProjectLibrary.getState().setSettings(settings);
}

/** When the recents thumbnail was last refreshed by an autosave (`Date.now()`). */
let lastThumbnailAt = 0;
/** An autosave refreshes the recents thumbnail at most this often. */
const AUTOSAVE_THUMBNAIL_MS = 60_000;

/** The open level as a small PNG for the recent-projects list (undefined where it cannot be drawn). */
function projectThumbnail(project: OpenProject): string | undefined {
  return captureMapThumbnail(project.store, (id) => getTilesetImage(id)?.bitmap);
}

/** Lists the project in recents, with a fresh thumbnail of the open level. */
function addRecent(target: ProjectFolder, project: OpenProject): void {
  lastThumbnailAt = Date.now();
  void getPlatform()
    .recents.add(target, project.name, projectThumbnail(project))
    .then(refreshRecentProjects, (error: unknown) => console.warn(error));
}

export function closeProject(): void {
  setFolder(null);
  workspace = null;
  activeLayerMemory.clear();
  clearLevelViews();
  useEditorStore.getState().setProject(null);
  clearTilesetImages();
  useUiStore.getState().setActiveTileset(null);
  useProjectLibrary.getState().load({ stamps: [], levels: [] });
}

/**
 * Renames the open project (AppBar double-click, `project.rename`). The new
 * name goes into `project.smap` on the next save (autosave when the project
 * has a folder); the folder keeps its name. Returns false when nothing changed.
 */
export function renameProject(name: string): boolean {
  const project = useEditorStore.getState().project;
  const next = name.replace(/\s+/g, " ").trim();
  if (!project || next === "" || next === project.name) return false;
  // In place: a new `project` object would make the canvas reload the level (camera reset).
  project.name = next;
  if (workspace) workspace.name = next;
  useEditorStore.setState({ dirty: true });
  if (folder) autosave?.notifyChange();
  return true;
}

/** Resolves when every queued write (manual save, autosave) has finished. */
export function waitForWrites(): Promise<void> {
  return writeQueue.then(() => undefined);
}

let closeAsking = false;

/**
 * The window is being closed (desktop X, Alt+F4, taskbar). Asks Kaydet /
 * Kaydetme / Vazgeç when work would be lost; "Kaydet" saves first (asking
 * for a folder when the project was never saved) and closes only if that
 * worked. Resolves true when the window may close. A second close request
 * while the question is open is ignored (resolves false).
 */
export async function requestWindowClose(): Promise<boolean> {
  if (closeAsking) return false;
  closeAsking = true;
  try {
    if (!(await confirmDiscard())) return false;
    // A save (or autosave) still writing: let it finish before the process goes.
    await waitForWrites();
    return true;
  } finally {
    closeAsking = false;
  }
}

export interface DecodedPng {
  file: File;
  bytes: Uint8Array;
  bitmap: ImageBitmap;
}

/** Reads and decodes a PNG file; toasts and returns `null` when it is not a readable PNG. */
export async function decodeTilesetFile(file: File): Promise<DecodedPng | null> {
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

/** True for the generic names pasted images get ("image.png"). */
function genericImageName(fileName: string): boolean {
  const base = baseName(fileName).trim().toLowerCase();
  return base === "" || base === "image";
}

/** Display name of an imported image (a pasted "image.png" gets a friendlier one). */
function tilesetDisplayName(fileName: string): string {
  return genericImageName(fileName) ? t("tilesetImport.pastedName") : baseName(fileName);
}

/**
 * Shows the import card for a decoded PNG, prefilled from `inferTileGrid`
 * (alpha, file name; the last used size — or the map's — as a hint).
 * Resolves with the confirmed name and grid, or `null` when cancelled.
 */
async function promptTilesetGrid(png: DecodedPng, mode: CardMode, mapTile: { tileWidth: number; tileHeight: number } | null) {
  const { width, height } = png.bitmap;
  const alpha = readAlpha(png.bitmap);
  const last = readLastSpec();
  const hintSize = last && last.tileWidth === last.tileHeight ? last.tileWidth : mapTile?.tileWidth === mapTile?.tileHeight ? mapTile?.tileWidth : null;
  const name = tilesetDisplayName(png.file.name);
  const { draft, suggestions } = inferDraft({ name, fileName: png.file.name, image: { width, height, alpha }, hintSize: hintSize ?? null });
  const result = await openTilesetCard({
    mode,
    fileName: png.file.name,
    bitmap: png.bitmap,
    width,
    height,
    alpha,
    initial: draft,
    suggestions,
    mapTile,
  });
  return result?.kind === "confirm" ? result : null;
}

/** A decoded PNG with the name and grid it is added with. */
export interface PlannedTileset {
  readonly png: DecodedPng;
  readonly name: string;
  readonly spec: TileGridSpec;
}

/**
 * Adds decoded PNGs as tilesets in ONE undo step (optionally all in
 * `group`). Returns the added tilesets; images that hold no tile are
 * reported and skipped. Ids taken by a removed tileset whose image is still
 * registered (its removal can be undone) are not reused.
 */
export function addDecodedTilesets(store: MapStore, items: readonly PlannedTileset[], group: string | null = null): Tileset[] {
  const doc: MapDocument = store.document;
  const taken = new Set(doc.tilesets.map((ts) => ts.id));
  for (const image of allTilesetImages()) taken.add(image.tilesetId);
  const added: Tileset[] = [];
  for (const { png, name, spec } of items) {
    const { width, height } = png.bitmap;
    // The id / file name comes from the file name, or from the typed name for a pasted "image.png".
    const fileName = genericImageName(png.file.name) ? `${name}.png` : png.file.name;
    const planned = planTilesetGrid(name, fileName, width, height, spec, taken);
    if (!planned) {
      png.bitmap.close();
      toast.error(t("toast.imageTooSmall", { name: png.file.name, tile: spec.tileWidth }));
      continue;
    }
    const tileset: Tileset = group ? { ...planned, group } : planned;
    taken.add(tileset.id);
    // Register the image first so the canvas finds it when the tileset appears.
    setTilesetImage({ tilesetId: tileset.id, bitmap: png.bitmap, bytes: png.bytes });
    added.push(tileset);
    rememberSpec(spec);
  }
  if (added.length === 0) return added;
  store.beginTransaction();
  try {
    for (const tileset of added) store.dispatch({ type: "addTileset", tileset });
    store.commit();
  } catch (error) {
    store.rollback();
    throw error;
  }
  useUiStore.getState().setActiveTileset(added[0]!.id);
  return added;
}

/** Adds one tileset (one undo step) and says so, with "Geri al". */
function addDecodedTileset(store: MapStore, png: DecodedPng, name: string, spec: TileGridSpec): boolean {
  const [tileset] = addDecodedTilesets(store, [{ png, name, spec }]);
  if (!tileset) return false;
  announceAdded(store, [tileset]);
  return true;
}

/** "Tileset eklendi: X · 24 tile" / "4 tileset eklendi", with "Geri al" (undoes the one step that added them). */
function announceAdded(store: MapStore, added: readonly Tileset[]): void {
  if (added.length === 0) return;
  const message =
    added.length === 1
      ? t("tilesetImport.added", { name: added[0]!.name, count: added[0]!.columns * added[0]!.rows })
      : t("bulkImport.added", { count: added.length });
  useToastStore.getState().push("success", message, 6000, undoStepAction(store));
}

/** The grid guess for a decoded PNG (alpha, file name; the last used size — or the map's — as a hint). */
function guessGrid(png: DecodedPng, mapTile: { tileWidth: number; tileHeight: number } | null) {
  const { width, height } = png.bitmap;
  const alpha = readAlpha(png.bitmap);
  const last = readLastSpec();
  const hintSize = last && last.tileWidth === last.tileHeight ? last.tileWidth : mapTile?.tileWidth === mapTile?.tileHeight ? mapTile?.tileWidth : null;
  const name = tilesetDisplayName(png.file.name);
  const inferred = inferDraft({ name, fileName: png.file.name, image: { width, height, alpha }, hintSize: hintSize ?? null });
  return { name, alpha, hintSize: hintSize ?? null, ...inferred };
}

/**
 * New project dialog: a dropped starting tileset, decoded, with the import
 * card's best grid guess (alpha, file name; `hintSize` = the dialog's tile
 * size). `null` (and a toast) when the file is not a readable PNG. Close
 * `png.bitmap` when the tileset is not used.
 */
export async function planStartingTileset(file: File, hintSize: number | null): Promise<PlannedTileset | null> {
  const png = await decodeTilesetFile(file);
  if (!png) return null;
  const { width, height } = png.bitmap;
  const name = tilesetDisplayName(png.file.name);
  const { suggestions } = inferDraft({ name, fileName: png.file.name, image: { width, height, alpha: readAlpha(png.bitmap) }, hintSize });
  const best = suggestions[0];
  const fallback = hintSize ?? 32;
  const spec: TileGridSpec = best
    ? { tileWidth: best.tileWidth, tileHeight: best.tileHeight, margin: best.margin, spacing: best.spacing }
    : { tileWidth: fallback, tileHeight: fallback, margin: 0, spacing: 0 };
  return { png, name, spec };
}

/** Decodes every PNG (non-PNGs are reported and skipped). */
async function decodeAll(files: readonly File[]): Promise<DecodedPng[]> {
  const out: DecodedPng[] = [];
  for (const file of files) {
    const png = await decodeTilesetFile(file);
    if (png) out.push(png);
  }
  return out;
}

/** Shows the bulk card for `pngs`; resolves with what to add (bitmaps of dropped rows are closed). */
async function promptBulk(pngs: readonly DecodedPng[], mode: BulkRequest["mode"], mapTile: { tileWidth: number; tileHeight: number } | null, groups: readonly string[]) {
  const files: BulkFile[] = pngs.map((png) => {
    const guess = guessGrid(png, mapTile);
    return { fileName: png.file.name, name: guess.name, bitmap: png.bitmap, width: png.bitmap.width, height: png.bitmap.height, alpha: guess.alpha, suggestions: guess.suggestions };
  });
  const result = await openBulkCard({ mode, files, mapTile, groups, fallback: mapTile?.tileWidth ?? 32 });
  const used = new Set(result?.items.map((i) => i.file) ?? []);
  pngs.forEach((png, i) => {
    if (!used.has(i)) png.bitmap.close();
  });
  if (!result) return null;
  return { group: result.group, items: result.items.map((i) => ({ png: pngs[i.file]!, name: i.name, spec: i.spec })) };
}

/**
 * Adds PNG files as tilesets to the open project (drag-drop, "+", menu,
 * paste). One file: the import card — or, with "Tahmin güvenliyse sormadan
 * ekle" on and a safe guess, added right away. Several: ONE summary card
 * for all of them, added as one undo step.
 */
export async function addTilesetFiles(files: readonly File[]): Promise<void> {
  if (!useEditorStore.getState().project) return;
  const pngs = await decodeAll(files);
  const project = useEditorStore.getState().project;
  if (!project || pngs.length === 0) {
    for (const png of pngs) png.bitmap.close();
    return;
  }
  const map = project.store.document.map;
  const mapTile = { tileWidth: map.tileWidth, tileHeight: map.tileHeight };
  if (pngs.length === 1) {
    const png = pngs[0]!;
    const guess = guessGrid(png, mapTile);
    const best = guess.suggestions[0];
    if (best && readAutoAdd() && isConfidentGuess(guess.suggestions, mapTile)) {
      addDecodedTileset(project.store, png, guess.name, { tileWidth: best.tileWidth, tileHeight: best.tileHeight, margin: best.margin, spacing: best.spacing });
      return;
    }
    const choice = await promptTilesetGrid(png, { kind: "add" }, mapTile);
    const store = useEditorStore.getState().project?.store;
    if (!choice || !store) {
      png.bitmap.close();
      return;
    }
    addDecodedTileset(store, png, choice.name, choice.spec);
    return;
  }
  const plan = await promptBulk(pngs, { kind: "add" }, mapTile, groupNames(project.store.document.tilesets));
  const store = useEditorStore.getState().project?.store;
  if (!plan || !store) {
    for (const item of plan?.items ?? []) item.png.bitmap.close();
    return;
  }
  announceAdded(store, addDecodedTilesets(store, plan.items, plan.group));
}

/**
 * Welcome-screen drop (or paste): the import card for one PNG, the bulk
 * card for several; the (first) confirmed tile size becomes the new 64×48
 * project's.
 */
export async function createProjectFromTilesets(files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  if (!(await confirmDiscard())) return;
  const pngs = await decodeAll(files);
  if (pngs.length === 0) return;
  let items: PlannedTileset[];
  let group: string | null = null;
  if (pngs.length === 1) {
    const png = pngs[0]!;
    const choice = await promptTilesetGrid(png, { kind: "new", mapWidth: DEFAULT_MAP_WIDTH, mapHeight: DEFAULT_MAP_HEIGHT }, null);
    if (!choice) {
      png.bitmap.close();
      return;
    }
    items = [{ png, name: choice.name, spec: choice.spec }];
  } else {
    const plan = await promptBulk(pngs, { kind: "new", mapWidth: DEFAULT_MAP_WIDTH, mapHeight: DEFAULT_MAP_HEIGHT }, null, []);
    if (!plan || plan.items.length === 0) return;
    items = plan.items;
    group = plan.group;
  }
  const first = items[0]!;
  const project = createProjectDocument({
    name: genericImageName(first.png.file.name) ? first.name : baseName(first.png.file.name),
    width: DEFAULT_MAP_WIDTH,
    height: DEFAULT_MAP_HEIGHT,
    tileSize: first.spec.tileWidth,
    tileHeight: first.spec.tileHeight,
  });
  const settings = normalizeProjectSettings({ tileWidth: first.spec.tileWidth, tileHeight: first.spec.tileHeight });
  activate(project, [], null, null, { stamps: [], brokenStampFiles: [], levels: defaultLevels(project.levelPath, t("levels.firstMapName")), settings });
  const added = addDecodedTilesets(project.store, items, group);
  // Starting a project is not an undo step: the first Ctrl+Z must not take the tilesets away.
  project.store.clearHistory();
  if (added.length === 1) toast.success(t("tilesetImport.added", { name: added[0]!.name, count: added[0]!.columns * added[0]!.rows }));
  else if (added.length > 1) toast.success(t("bulkImport.added", { count: added.length }));
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
        settings: lib.settings,
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
      // Saving is reported by the app-bar indicator, without a toast (§4.8).
      addRecent(target, project);
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
  const saved = useEditorStore.getState().project ?? project;
  await writeProjectFiles(target, saved);
  if (workspace !== ws) return;
  settleDirty(libRevision);
  // Keep the welcome screen's picture roughly current without redrawing it on every autosave.
  if (Date.now() - lastThumbnailAt >= AUTOSAVE_THUMBNAIL_MS) addRecent(target, saved);
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
    const document = parseLevel(text, project.store.document.tilesets, project.store.document.entityTypes, projectDataOf(project.store.document));
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
    settings: loaded.settings,
  });
  for (const path of loaded.brokenStamps) toast.warning(t("toast.stampUnreadable", { path }));
  for (const path of loaded.missingImages) toast.warning(t("toast.missingTilesetImage", { path }));
  warnPalette(loaded.levels.find((l) => l.id === loaded.levelId)?.name ?? levelName(loaded.levelPath), loaded.document);
  return loaded.name;
}

async function openLocation(location: ProjectLocation): Promise<boolean> {
  const name = await openFromFolder(location);
  toast.success(t("toast.opened", { name }));
  const project = useEditorStore.getState().project;
  if (project) addRecent(location, project);
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
        void getPlatform()
          .recents.remove(recent)
          .then(refreshRecentProjects, () => undefined);
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

let leaveTemporaryDocument: (() => void) | null = null;

/** The stamp editor registers how to leave its tab (shows the active map again). */
export function setLeaveTemporaryDocument(leave: (() => void) | null): void {
  leaveTemporaryDocument = leave;
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
  const run = () => {
    // A map tab / "go to map" while the stamp editor tab is shown leaves it first (even for the active map).
    if (leaveTemporaryDocument && useEditorStore.getState().project?.levelId?.startsWith("stamp:")) leaveTemporaryDocument();
    return switchToLevel(levelId);
  };
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
    if (fromDisk && entry.store.document.migrations.length > 0) announceTerrainMigration(entry.store.document, levelId);
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
    // The stamp editor's temporary map is not part of the project (saved with "Kaydet" only).
    if (project.levelId?.startsWith("stamp:")) return;
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
    if (!readSaveIndicator().unsaved && ![...unsavedGuards].some((g) => g.dirty())) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // Desktop: the host closes at once while nothing is unsaved (even if the
  // page hangs) and asks `requestWindowClose` otherwise.
  const platform = getPlatform();
  let lastUnsaved: boolean | null = null;
  const syncUnsaved = () => {
    const indicator = readSaveIndicator();
    const unsaved = indicator.unsaved || indicator.text === "saving" || [...unsavedGuards].some((g) => g.dirty());
    if (unsaved === lastUnsaved) return;
    lastUnsaved = unsaved;
    platform.setUnsavedChanges(unsaved);
  };
  syncUnsaved();
  unsavedGuardsChanged = syncUnsaved;
  const unsubscribeIndicator = subscribeSaveIndicator(syncUnsaved);
  const unsubscribeClose = platform.onCloseRequested(requestWindowClose);

  // "Changed on disk" hints come from the platform (desktop: file watcher,
  // browser: window focus); `platform/fileChanges.ts` reacts to them.

  return () => {
    unsubscribeStore?.();
    unsubscribeEditor();
    unsubscribeLibrary();
    scheduler.dispose();
    if (autosave === scheduler) autosave = null;
    window.removeEventListener("beforeunload", onBeforeUnload);
    unsubscribeIndicator();
    if (unsavedGuardsChanged === syncUnsaved) unsavedGuardsChanged = null;
    unsubscribeClose();
  };
}
