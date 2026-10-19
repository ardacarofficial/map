/**
 * Export actions wired to the app: the open project, the tileset image
 * registry, folder pickers, downloads, toasts and the after-save hook.
 * Folders are written through `ProjectFileSystem` (a directory handle today,
 * Tauri in v0.5).
 */
import { exportBaseName, exportGameJson, exportLayerSummaries, type MapDocument } from "@smap/core";

import { getLocale, t } from "../i18n";
import { getPlatform, type SaveFileFilter } from "../platform";
import { DirectoryHandleFileSystem, ensureReadWrite, UnsupportedError } from "../io/browserFs";
import { levelName, projectFiles } from "../io/projectIo";
import { useProjectLibrary } from "../io/projectLibrary";
import { describeError, getLevelWorkspace, getProjectFolder, onProjectSaved } from "../io/session";
import { useEditorStore, type OpenProject } from "../state/editorStore";
import { getTilesetImage, tilesetPngSource } from "../state/tilesetImages";
import { resolveFileData } from "../io/fileData";
import { toast } from "../ui/toast/toastStore";
import { AutoExporter, type SavedProject } from "./autoExport";
import { tmjExportFiles, unityExportFiles, writeExportFiles, type ExportFileSet } from "./exportFiles";
import { levelKey, outputSubfolder, selectedLayerIds, unityGameOptions } from "./exportOptions";
import { defaultExportSettings, loadExportSettings, updateExportSettings, type ExportSettings } from "./exportSettings";
import { useExportStore } from "./exportStore";
import { type PngScale } from "./pngComposite";
import { PngTooLargeError, renderMapPng } from "./pngRender";
import { projectZipEntries, zipCompressed } from "./zip";

export type FolderKind = "unity" | "tmj";

const tilesetBytes = tilesetPngSource;

/** "12:04" in the UI language. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });
}

/** Level name used for exported file names ("main"). */
export function projectLevelName(project: OpenProject): string {
  return levelName(project.levelPath);
}

/** The level an export writes: the open one, or another level of the project (dialog's "Harita"). */
export interface ExportSource {
  readonly document: MapDocument;
  /** Project-relative level file, e.g. `"levels/main.json"` (gives the export file names). */
  readonly levelPath: string;
  readonly levelId?: string | undefined;
}

/** The open level as an export source. */
export function activeSource(project: OpenProject): ExportSource {
  return { document: project.store.document, levelPath: project.levelPath, levelId: project.levelId };
}

/** Level name of a source, for file names ("main"). */
export function sourceLevelName(source: ExportSource): string {
  return levelName(source.levelPath);
}

/**
 * A project level as an export source, without opening it: the open level's
 * live document, a cached level's (unsaved edits included) or the level file.
 */
export async function loadExportSource(levelId: string): Promise<ExportSource | null> {
  const project = useEditorStore.getState().project;
  if (!project) return null;
  if (levelId === project.levelId) return activeSource(project);
  const ws = getLevelWorkspace();
  const level = ws?.level(levelId);
  if (!ws || !level) return null;
  const document = await ws.documentOf(levelId, getProjectFolder()?.fs ?? null);
  return { document, levelPath: level.path, levelId };
}

/** Tile layers of `source` an export writes (the dialog's layer checkboxes), before Unity's tile switch. */
export function sourceLayers(settings: ExportSettings, source: ExportSource): string[] {
  return selectedLayerIds(exportLayerSummaries(source.document), settings.excludedLayers[levelKey(source)] ?? []);
}

/** The files a Unity / Tiled export of `source` writes with `settings` (also the dialog preview). */
export function previewFiles(kind: FolderKind, source: ExportSource, settings: ExportSettings): ExportFileSet {
  const layers = sourceLayers(settings, source);
  if (kind === "unity") {
    return unityExportFiles(source.document, sourceLevelName(source), tilesetBytes, {
      ...unityGameOptions(settings, settings.unityTiles ? layers : []),
      subfolder: outputSubfolder(settings.unitySubfolder),
      copyTextures: settings.copyTextures,
    });
  }
  return tmjExportFiles(source.document, sourceLevelName(source), tilesetBytes, { layers });
}

async function withExportBusy<T>(work: () => Promise<T>): Promise<T | undefined> {
  const store = useExportStore.getState();
  if (store.busy) return undefined;
  store.setBusy(true);
  try {
    return await work();
  } finally {
    useExportStore.getState().setBusy(false);
  }
}

function settingsKey(kind: FolderKind): "unityDir" | "tmjDir" {
  return kind === "unity" ? "unityDir" : "tmjDir";
}

async function looksLikeUnityRoot(handle: FileSystemDirectoryHandle): Promise<boolean> {
  let assets = false;
  let projectSettings = false;
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== "directory") continue;
    if (name === "Assets") assets = true;
    if (name === "ProjectSettings") projectSettings = true;
  }
  return assets && projectSettings;
}

/**
 * Asks for a target folder and remembers it for the project. Returns `null`
 * when the user cancels.
 */
export async function chooseExportFolder(kind: FolderKind): Promise<ExportSettings | null> {
  const project = useEditorStore.getState().project;
  if (!project) return null;
  if (!window.showDirectoryPicker) throw new UnsupportedError();
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ id: kind === "unity" ? "smap-unity" : "smap-tiled", mode: "readwrite" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
  if (kind === "unity" && (await looksLikeUnityRoot(handle).catch(() => false))) {
    toast.warning(t("export.unityRootWarning", { name: handle.name }));
  }
  return updateExportSettings(project.name, { [settingsKey(kind)]: handle });
}

/** The remembered folder (asking for permission again if needed), or a newly picked one. */
async function folderFor(kind: FolderKind, project: OpenProject): Promise<FileSystemDirectoryHandle | null> {
  const remembered = (await loadExportSettings(project.name))[settingsKey(kind)];
  if (remembered && (await ensureReadWrite(remembered))) return remembered;
  return (await chooseExportFolder(kind))?.[settingsKey(kind)] ?? null;
}

function warnMissing(set: ExportFileSet): void {
  if (set.missingImages.length > 0) toast.warning(t("export.toastMissingImages", { paths: set.missingImages.join(", ") }));
}

async function exportToFolder(kind: FolderKind, from?: ExportSource): Promise<ExportFileSet | null> {
  const project = useEditorStore.getState().project;
  if (!project) return null;
  const source = from ?? activeSource(project);
  const result = await withExportBusy(async () => {
    try {
      const handle = await folderFor(kind, project);
      if (!handle) return null;
      const set = previewFiles(kind, source, await loadExportSettings(project.name));
      try {
        await writeExportFiles(new DirectoryHandleFileSystem(handle), set.files);
      } catch (error) {
        // The remembered folder was deleted or moved: forget it, the next export asks again.
        if (error instanceof DOMException && error.name === "NotFoundError") {
          await updateExportSettings(project.name, { [settingsKey(kind)]: null });
        }
        throw error;
      }
      const now = new Date();
      await updateExportSettings(project.name, {
        target: kind,
        ...(kind === "unity" ? { lastUnityAt: now.getTime() } : {}),
      });
      useExportStore.getState().bump();
      toast.success(
        kind === "unity"
          ? t("export.toastUnity", { time: formatClock(now) })
          : t("export.toastTmj", { file: set.mapFile, time: formatClock(now) }),
      );
      warnMissing(set);
      return set;
    } catch (error) {
      console.error(error);
      toast.error(t("export.toastFailed", { detail: describeError(error) }));
      return null;
    }
  });
  return result ?? null;
}

/**
 * Writes `<level>.smapmap` + tileset PNGs into the project's Unity folder
 * (asks once), with the remembered options and layer selection. `source`
 * defaults to the open level.
 */
export function exportToUnity(source?: ExportSource): Promise<ExportFileSet | null> {
  return exportToFolder("unity", source);
}

/** Writes `<level>.tmj` + tileset PNGs into the project's Tiled folder (asks once). */
export function exportToTiled(source?: ExportSource): Promise<ExportFileSet | null> {
  return exportToFolder("tmj", source);
}

/**
 * Hands an exported file to the user: a native save dialog on the desktop,
 * a download in the browser. Resolves false when the user cancels.
 */
export async function deliverFile(blob: Blob, fileName: string, filter: SaveFileFilter): Promise<boolean> {
  const platform = getPlatform();
  if (!platform.saveFile) {
    downloadBlob(blob, fileName);
    return true;
  }
  return platform.saveFile(fileName, new Uint8Array(await blob.arrayBuffer()), filter);
}

/** Starts a browser download of `blob`. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Composites the map (selected visible layers) into one PNG at `scale` and downloads `<level>.png`. */
export async function exportPng(scale: PngScale, from?: ExportSource): Promise<boolean> {
  const project = useEditorStore.getState().project;
  if (!project) return false;
  const source = from ?? activeSource(project);
  const result = await withExportBusy(async () => {
    try {
      const layers = sourceLayers(await loadExportSettings(project.name), source);
      const png = await renderMapPng(source.document, scale, (id) => getTilesetImage(id)?.bitmap, { layers });
      const fileName = `${exportBaseName(sourceLevelName(source))}.png`;
      if (!(await deliverFile(png.blob, fileName, { name: "PNG", extensions: ["png"] }))) return false;
      await updateExportSettings(project.name, { target: "png", pngScale: scale });
      toast.success(t("export.toastPng", { file: fileName, width: png.width, height: png.height }));
      if (png.missing.length > 0) {
        const paths = source.document.tilesets.filter((ts) => png.missing.includes(ts.id)).map((ts) => ts.imagePath);
        toast.warning(t("export.toastMissingImages", { paths: paths.join(", ") }));
      }
      return true;
    } catch (error) {
      console.error(error);
      toast.error(error instanceof PngTooLargeError ? t("export.toastPngTooLarge") : t("export.toastFailed", { detail: describeError(error) }));
      return false;
    }
  });
  return result ?? false;
}

/** Downloads the game JSON (`<level>.json`) of the selected layers. */
export async function exportJson(from?: ExportSource): Promise<boolean> {
  const project = useEditorStore.getState().project;
  if (!project) return false;
  const source = from ?? activeSource(project);
  try {
    const fileName = `${exportBaseName(sourceLevelName(source))}.json`;
    const text = exportGameJson(source.document, { layers: sourceLayers(await loadExportSettings(project.name), source) });
    if (!(await deliverFile(new Blob([text], { type: "application/json" }), fileName, { name: "JSON", extensions: ["json"] }))) return false;
    await updateExportSettings(project.name, { target: "json" });
    toast.success(t("export.toastJson", { file: fileName }));
    return true;
  } catch (error) {
    console.error(error);
    toast.error(t("export.toastFailed", { detail: describeError(error) }));
    return false;
  }
}

/**
 * Files of the whole project as a save would write them (project.smap,
 * levels/, tilesets/, stamps/). v1.0: levels in memory are serialized; a
 * level only on disk is listed with empty data (`zipFiles` reads it).
 */
export function previewZipFiles(project: OpenProject) {
  const library = useProjectLibrary.getState();
  const ws = getLevelWorkspace();
  const others = ws
    ? ws
        .cachedIds()
        .filter((id) => id !== ws.activeId && ws.level(id))
        .map((id) => ({ path: ws.level(id)!.path, document: ws.entry(id)!.store.document }))
    : [];
  const files = projectFiles({
    name: project.name,
    document: project.store.document,
    levelPath: project.levelPath,
    tilesetBytes,
    levels: library.levels,
    stamps: library.stamps,
    otherLevels: others,
    ...(ws ? { retiredLevelIds: ws.retiredLevelIds } : {}),
  });
  const listed = new Set(files.map((f) => f.path));
  const onDisk = library.levels.filter((l) => !listed.has(l.path)).map((l) => ({ path: l.path, data: "" }));
  // Before project.smap (the last file).
  return [...files.slice(0, -1), ...onDisk, ...files.slice(-1)];
}

/** {@link previewZipFiles} with the levels that are only on disk read from the project folder. */
async function zipFiles(project: OpenProject) {
  const files = previewZipFiles(project);
  const fs = getProjectFolder()?.fs;
  const cached = new Set(getLevelWorkspace()?.cachedIds().map((id) => getLevelWorkspace()?.level(id)?.path) ?? []);
  const levelPaths = new Set(useProjectLibrary.getState().levels.map((l) => l.path));
  return Promise.all(
    files.map(async (f) =>
      fs && f.data === "" && levelPaths.has(f.path) && !cached.has(f.path) ? { path: f.path, data: await fs.readText(f.path) } : { ...f, data: await resolveFileData(f.data) },
    ),
  );
}

/** Downloads the whole project folder as `<project>.zip` (no backups/). */
export async function exportZip(): Promise<boolean> {
  const project = useEditorStore.getState().project;
  if (!project) return false;
  const result = await withExportBusy(async () => {
    try {
      const fileName = `${project.name}.zip`;
      const bytes = await zipCompressed(projectZipEntries(await zipFiles(project)));
      if (!(await deliverFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }), fileName, { name: "Zip", extensions: ["zip"] }))) return false;
      await updateExportSettings(project.name, { target: "zip" });
      toast.success(t("export.toastZip", { file: fileName }));
      const missing = project.store.document.tilesets.filter((ts) => !tilesetBytes(ts.id)).map((ts) => ts.imagePath);
      if (missing.length > 0) toast.warning(t("export.toastMissingImages", { paths: missing.join(", ") }));
      return true;
    } catch (error) {
      console.error(error);
      toast.error(t("export.toastFailed", { detail: describeError(error) }));
      return false;
    }
  });
  return result ?? false;
}

// ------------------------------------------------------------------ export on save

/** One permission / error toast per streak, not one per autosave. */
let autoProblemShown = false;
/** Settings read by the last `autoTarget` (the exporter asks for the target, then the files). */
let autoSettings: ExportSettings | null = null;

async function autoTarget(project: SavedProject): Promise<DirectoryHandleFileSystem | null> {
  const settings = await loadExportSettings(project.name);
  autoSettings = settings;
  const handle = settings.unityDir;
  if (!settings.autoUnity || !handle) return null;
  const descriptor = { mode: "readwrite" } as const;
  let state = (await handle.queryPermission?.(descriptor)) ?? "granted";
  if (state !== "granted" && project.manual && handle.requestPermission) {
    // Ctrl+S is a user gesture, so the browser may still let us ask.
    state = await handle.requestPermission(descriptor).catch((): PermissionState => "denied");
  }
  if (state !== "granted") {
    if (!autoProblemShown) toast.warning(t("export.toastAutoPermission"));
    autoProblemShown = true;
    return null;
  }
  return new DirectoryHandleFileSystem(handle);
}

/** Hooks "Kaydedince Unity'ye de aktar" into the save pipeline. Call once; returns a cleanup. */
export function installAutoExport(): () => void {
  const exporter = new AutoExporter({
    target: autoTarget,
    files: (project) => {
      const settings = autoSettings ?? defaultExportSettings(project.name);
      return previewFiles("unity", { document: project.document, levelPath: project.levelPath ?? `levels/${project.levelName}.json`, levelId: project.levelId }, settings);
    },
    onExported: ({ project, set, at }) => {
      autoProblemShown = false;
      void updateExportSettings(project.name, { lastUnityAt: at.getTime() }).then(() => useExportStore.getState().bump());
      if (project.manual) {
        toast.success(t("export.toastUnity", { time: formatClock(at) }));
        warnMissing(set);
      }
    },
    onError: (error) => {
      console.error(error);
      if (!autoProblemShown) toast.error(t("export.toastAutoFailed", { detail: describeError(error) }));
      autoProblemShown = true;
    },
  });
  // v1.0: every level the save wrote is exported (not just the open one).
  return onProjectSaved(({ project, manual, levels }) => {
    for (const level of levels) {
      void exporter.onSaved({
        name: project.name,
        document: level.store.document,
        levelName: levelName(level.path),
        levelPath: level.path,
        levelId: level.id,
        manual,
      });
    }
  });
}
