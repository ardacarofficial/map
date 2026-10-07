/**
 * Export actions wired to the app: the open project, the tileset image
 * registry, folder pickers, downloads, toasts and the after-save hook.
 * Folders are written through `ProjectFileSystem` (a directory handle today,
 * Tauri in v0.5).
 */
import { exportBaseName, exportGameJson } from "@smap/core";

import { getLocale, t } from "../i18n";
import { DirectoryHandleFileSystem, ensureReadWrite, UnsupportedError } from "../io/browserFs";
import { levelName, projectFiles } from "../io/projectIo";
import { useProjectLibrary } from "../io/projectLibrary";
import { describeError, onProjectSaved } from "../io/session";
import { useEditorStore, type OpenProject } from "../state/editorStore";
import { getTilesetImage } from "../state/tilesetImages";
import { toast } from "../ui/toast/toastStore";
import { AutoExporter, type SavedProject } from "./autoExport";
import { tmjExportFiles, unityExportFiles, writeExportFiles, type ExportFileSet } from "./exportFiles";
import { loadExportSettings, updateExportSettings, type ExportSettings } from "./exportSettings";
import { useExportStore } from "./exportStore";
import { type PngScale } from "./pngComposite";
import { PngTooLargeError, renderMapPng } from "./pngRender";
import { projectZipEntries, zipCompressed } from "./zip";

export type FolderKind = "unity" | "tmj";

const tilesetBytes = (id: string) => getTilesetImage(id)?.bytes;

/** "12:04" in the UI language. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString(getLocale() === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

/** Level name used for exported file names ("main"). */
export function projectLevelName(project: OpenProject): string {
  return levelName(project.levelPath);
}

/** The files a Unity / Tiled export of the open project would write (dialog preview). */
export function previewFiles(kind: FolderKind, project: OpenProject): ExportFileSet {
  const build = kind === "unity" ? unityExportFiles : tmjExportFiles;
  return build(project.store.document, projectLevelName(project), tilesetBytes);
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

async function exportToFolder(kind: FolderKind): Promise<ExportFileSet | null> {
  const project = useEditorStore.getState().project;
  if (!project) return null;
  const result = await withExportBusy(async () => {
    try {
      const handle = await folderFor(kind, project);
      if (!handle) return null;
      const set = previewFiles(kind, project);
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

/** Writes `<level>.smapmap` + tileset PNGs into the project's Unity folder (asks once). */
export function exportToUnity(): Promise<ExportFileSet | null> {
  return exportToFolder("unity");
}

/** Writes `<level>.tmj` + tileset PNGs into the project's Tiled folder (asks once). */
export function exportToTiled(): Promise<ExportFileSet | null> {
  return exportToFolder("tmj");
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

/** Composites the map into one PNG at `scale` and downloads `<level>.png`. */
export async function exportPng(scale: PngScale): Promise<boolean> {
  const project = useEditorStore.getState().project;
  if (!project) return false;
  const result = await withExportBusy(async () => {
    try {
      const png = await renderMapPng(project.store.document, scale, (id) => getTilesetImage(id)?.bitmap);
      const fileName = `${exportBaseName(projectLevelName(project))}.png`;
      downloadBlob(png.blob, fileName);
      await updateExportSettings(project.name, { target: "png", pngScale: scale });
      toast.success(t("export.toastPng", { file: fileName, width: png.width, height: png.height }));
      if (png.missing.length > 0) {
        const paths = project.store.document.tilesets.filter((ts) => png.missing.includes(ts.id)).map((ts) => ts.imagePath);
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

/** Downloads the game JSON (`<level>.json`). */
export async function exportJson(): Promise<boolean> {
  const project = useEditorStore.getState().project;
  if (!project) return false;
  try {
    const fileName = `${exportBaseName(projectLevelName(project))}.json`;
    const text = exportGameJson(project.store.document);
    downloadBlob(new Blob([text], { type: "application/json" }), fileName);
    await updateExportSettings(project.name, { target: "json" });
    toast.success(t("export.toastJson", { file: fileName }));
    return true;
  } catch (error) {
    console.error(error);
    toast.error(t("export.toastFailed", { detail: describeError(error) }));
    return false;
  }
}

/** Files of the whole project as a save would write them (project.smap, levels/, tilesets/, stamps/). */
export function previewZipFiles(project: OpenProject) {
  const library = useProjectLibrary.getState();
  return projectFiles({
    name: project.name,
    document: project.store.document,
    levelPath: project.levelPath,
    tilesetBytes,
    levels: library.levels,
    stamps: library.stamps,
  });
}

/** Downloads the whole project folder as `<project>.zip` (no backups/). */
export async function exportZip(): Promise<boolean> {
  const project = useEditorStore.getState().project;
  if (!project) return false;
  const result = await withExportBusy(async () => {
    try {
      const fileName = `${project.name}.zip`;
      const bytes = await zipCompressed(projectZipEntries(previewZipFiles(project)));
      downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }), fileName);
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

async function autoTarget(project: SavedProject): Promise<DirectoryHandleFileSystem | null> {
  const settings = await loadExportSettings(project.name);
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
    files: (project) => unityExportFiles(project.document, project.levelName, tilesetBytes),
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
  return onProjectSaved(({ project, manual }) => {
    void exporter.onSaved({
      name: project.name,
      document: project.store.document,
      levelName: projectLevelName(project),
      manual,
    });
  });
}
