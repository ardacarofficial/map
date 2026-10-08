/**
 * The editor's `Platform` on Tauri: native dialogs, scoped Rust file
 * commands, the project watcher, `recent.json`, `settings.json` and the log
 * file. Built here (desktop → editor), never imported by the editor.
 */
import { FolderTakenError, folderNameFor, RecentGoneError, type Platform, type ProjectLocation, type RecentEntry } from "@smap/editor";

import * as bridge from "./desktopBridge";
import { DesktopFsError, joinPath, TauriFileSystem, toProjectPath, writeFileAbsolute } from "./tauriFileSystem";

const PROJECT_FILE = "project.smap";

function locationOf(fs: TauriFileSystem): ProjectLocation {
  return { fs, ref: fs.root, label: fs.root };
}

function rootOf(location: ProjectLocation | null): string | null {
  return location && location.fs instanceof TauriFileSystem ? location.fs.root : null;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const windows = /^[a-zA-Z]:/.test(a) || a.startsWith("\\\\");
  return windows ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "FileNotFoundError";
}

/**
 * Close requests (only sent while there is unsaved work): asks `shouldClose`,
 * closes the window when it says so. Requests while one is being answered
 * are dropped (the dialog is already open).
 */
export function listenCloseRequests(shouldClose: () => Promise<boolean>): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  let asking = false;
  const onRequest = async () => {
    if (asking || disposed) return;
    asking = true;
    try {
      if (await shouldClose()) await bridge.closeWindow();
    } catch (error) {
      bridge.log("error", `close request: ${String(error)}`);
    } finally {
      asking = false;
    }
  };
  void bridge
    .onCloseRequested(() => void onRequest())
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch((error: unknown) => bridge.log("warn", `close requests unavailable: ${String(error)}`));
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export function createDesktopPlatform(): Platform {
  /** Root the Rust side currently treats as the project (watcher, scope). */
  let activeRoot: string | null = null;
  let settingsLocation = "settings.json";
  void bridge
    .settingsPath()
    .then((path) => (settingsLocation = path))
    .catch(() => undefined);

  async function open(path: string, name?: string): Promise<ProjectLocation> {
    const { project, fs } = await bridge.openProject(path, name);
    activeRoot = project.root;
    return locationOf(fs);
  }

  return {
    kind: "desktop",

    async openProjectDialog() {
      const path = await bridge.openProjectDialog();
      return path ? open(path) : null;
    },

    async pickProjectFolder(projectName, current) {
      const dir = await bridge.pickFolderDialog();
      if (!dir) return null;
      if (!(await bridge.dirHasEntries(dir))) return locationOf(new TauriFileSystem(dir));
      const name = folderNameFor(projectName);
      const sub = joinPath(dir, name);
      const currentRoot = rootOf(current);
      if (currentRoot && samePath(currentRoot, sub)) return current;
      if (await bridge.pathExists(joinPath(sub, PROJECT_FILE))) throw new FolderTakenError(name);
      const fs = new TauriFileSystem(sub);
      await fs.mkdir("");
      return locationOf(fs);
    },

    openPath(path) {
      return open(path);
    },

    watchProject(location) {
      const root = rootOf(location);
      if (root === null) {
        if (activeRoot !== null) void bridge.closeProject().catch(() => undefined);
        activeRoot = null;
        return;
      }
      if (activeRoot !== null && samePath(activeRoot, root)) return;
      activeRoot = root;
      // A new project's folder (first save): make it the scope root and watch it.
      void bridge.useFolderAsProject(root).catch((error: unknown) => bridge.log("warn", `watch ${root}: ${String(error)}`));
    },

    recents: {
      supported: true,
      async list() {
        const entries = await bridge.recentList();
        return entries.map(
          (e): RecentEntry => ({
            key: e.path,
            name: e.name,
            location: e.path.replace(/[\\/]project\.smap$/i, ""),
            openedAt: e.openedAt,
            exists: e.exists,
          }),
        );
      },
      async add(location, name) {
        const root = rootOf(location);
        if (root) await bridge.recentAdd(joinPath(root, PROJECT_FILE), name);
      },
      async remove(entry) {
        await bridge.recentRemove(entry.key);
      },
      async open(entry) {
        if (!entry.exists) throw new RecentGoneError(entry.location);
        try {
          return await open(entry.key, entry.name);
        } catch (error) {
          if (isNotFound(error)) throw new RecentGoneError(entry.location);
          throw error;
        }
      },
    },

    async onOpenFile(cb) {
      return bridge.onOpenFile(cb);
    },

    onFileChanged(cb) {
      let unlisten: (() => void) | null = null;
      let disposed = false;
      void bridge
        .onFileChanged((change) => {
          const root = activeRoot;
          const path = root ? toProjectPath(root, change.path) : null;
          if (path) cb({ path, kind: change.kind });
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        });
      return () => {
        disposed = true;
        unlisten?.();
      };
    },

    log(level, message) {
      bridge.log(level, message);
    },

    appReady() {
      void bridge.appReady().catch(() => undefined);
    },

    setTitle(title) {
      document.title = title;
      void bridge.setWindowTitle(title).catch(() => undefined);
    },

    onCloseRequested(shouldClose) {
      return listenCloseRequests(shouldClose);
    },

    setUnsavedChanges(unsaved) {
      void bridge.setCloseGuard(unsaved).catch(() => undefined);
    },

    readSettings() {
      return bridge.settingsRead();
    },

    writeSettings(text) {
      return bridge.settingsWrite(text);
    },

    settingsLocation() {
      return settingsLocation;
    },

    async saveFile(fileName, bytes, filter) {
      const path = await bridge.saveFileDialog({ defaultName: fileName, filter });
      if (!path) return false;
      await writeFileAbsolute(path, bytes);
      return true;
    },
  };
}

export { DesktopFsError };
