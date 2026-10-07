/**
 * The browser host: File System Access API folders, recents in IndexedDB,
 * settings in localStorage. There is no file watcher in a browser, so
 * "changed on disk" is checked when the tab regains focus.
 */
import { PROJECT_FILE_NAME } from "@smap/core";

import { DirectoryHandleFileSystem, ensureReadWrite, pickDirectory } from "../io/browserFs";
import { forgetRecent, listRecents, rememberRecent, supportsRecents, type RecentProject } from "../io/recents";
import {
  FolderTakenError,
  folderNameFor,
  RecentGoneError,
  type Platform,
  type ProjectFileChange,
  type ProjectLocation,
  type RecentEntry,
} from "./types";

const SETTINGS_KEY = "smap.settings";

function locationOf(handle: FileSystemDirectoryHandle): ProjectLocation {
  return { fs: new DirectoryHandleFileSystem(handle), ref: handle, label: handle.name };
}

function handleOf(location: ProjectLocation | null): FileSystemDirectoryHandle | null {
  const ref = location?.ref;
  return typeof FileSystemDirectoryHandle !== "undefined" && ref instanceof FileSystemDirectoryHandle ? ref : null;
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
async function resolveSaveFolder(
  picked: FileSystemDirectoryHandle,
  projectName: string,
  current: FileSystemDirectoryHandle | null,
): Promise<FileSystemDirectoryHandle> {
  if (!(await hasVisibleEntries(picked))) return picked;
  const name = folderNameFor(projectName);
  const sub = await picked.getDirectoryHandle(name, { create: true });
  if (current && (await current.isSameEntry(sub))) return sub;
  if ((await new DirectoryHandleFileSystem(sub).list("")).includes(PROJECT_FILE_NAME)) {
    throw new FolderTakenError(name);
  }
  return sub;
}

// ------------------------------------------------------------------ recents

/** Entries of the last `list()`, so `open`/`remove` get the handle back. */
const listed = new Map<string, RecentProject>();

function toEntry(recent: RecentProject): RecentEntry {
  return { key: String(recent.openedAt), name: recent.name, location: recent.folder, openedAt: recent.openedAt, exists: true };
}

// ------------------------------------------------------------------ "watcher" (focus check)

/** Files whose change matters: the project file, levels and tileset PNGs. */
async function scanStamps(handle: FileSystemDirectoryHandle): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const stamp = (file: File) => `${file.lastModified}:${file.size}`;
  try {
    out.set(PROJECT_FILE_NAME, stamp(await (await handle.getFileHandle(PROJECT_FILE_NAME)).getFile()));
  } catch {
    // Not saved yet.
  }
  for (const [dir, ext] of [
    ["levels", ".json"],
    ["tilesets", ".png"],
  ] as const) {
    let folder: FileSystemDirectoryHandle;
    try {
      folder = await handle.getDirectoryHandle(dir);
    } catch {
      continue;
    }
    for await (const [name, entry] of folder.entries()) {
      if (entry.kind !== "file" || name.startsWith(".") || !name.toLowerCase().endsWith(ext)) continue;
      out.set(`${dir}/${name}`, stamp(await (entry as FileSystemFileHandle).getFile()));
    }
  }
  return out;
}

const changeListeners = new Set<(change: ProjectFileChange) => void>();
let watched: { handle: FileSystemDirectoryHandle; stamps: Map<string, string> | null } | null = null;
let scanning = false;

function emit(change: ProjectFileChange): void {
  for (const listener of changeListeners) {
    try {
      listener(change);
    } catch (error) {
      console.error(error);
    }
  }
}

/**
 * Back in the tab: the level files are always re-checked (the editor
 * compares their text, as before v0.5); a PNG counts as changed when its
 * modification time or size differs from the last scan.
 */
async function checkWatched(): Promise<void> {
  const target = watched;
  if (!target || scanning) return;
  scanning = true;
  try {
    const next = await scanStamps(target.handle);
    if (watched !== target) return;
    const previous = target.stamps;
    target.stamps = next;
    for (const [path, stamp] of next) {
      if (!path.endsWith(".png")) emit({ path, kind: "modified" });
      else if (previous && previous.get(path) !== stamp) emit({ path, kind: previous.has(path) ? "modified" : "created" });
    }
    if (previous) for (const path of previous.keys()) if (!next.has(path)) emit({ path, kind: "removed" });
  } catch (error) {
    console.warn("Disk check failed", error);
  } finally {
    scanning = false;
  }
}

const onFocus = () => void checkWatched();
const onVisibility = () => {
  if (document.visibilityState === "visible") void checkWatched();
};

// ------------------------------------------------------------------ platform

export const browserPlatform: Platform = {
  kind: "browser",

  async openProjectDialog() {
    const handle = await pickDirectory();
    return handle ? locationOf(handle) : null;
  },

  async pickProjectFolder(projectName, current) {
    const picked = await pickDirectory();
    if (!picked) return null;
    return locationOf(await resolveSaveFolder(picked, projectName, handleOf(current)));
  },

  openPath() {
    return Promise.reject(new Error("Opening a path is not supported in the browser"));
  },

  watchProject(location) {
    const handle = handleOf(location);
    if (watched && handle && watched.handle === handle) return;
    watched = handle ? { handle, stamps: null } : null;
    if (!handle) return;
    const target = watched;
    void scanStamps(handle)
      .then((stamps) => {
        if (target && watched === target && target.stamps === null) target.stamps = stamps;
      })
      .catch(() => undefined);
  },

  recents: {
    supported: supportsRecents(),
    async list() {
      const all = await listRecents();
      listed.clear();
      for (const recent of all) listed.set(String(recent.openedAt), recent);
      return all.map(toEntry);
    },
    async add(location, name) {
      const handle = handleOf(location);
      if (handle) await rememberRecent(name, handle);
    },
    async remove(entry) {
      listed.delete(entry.key);
      await forgetRecent(entry.openedAt);
    },
    async open(entry) {
      const recent = listed.get(entry.key);
      if (!recent) throw new RecentGoneError(entry.location);
      if (!(await ensureReadWrite(recent.handle))) return null;
      return locationOf(recent.handle);
    },
  },

  onOpenFile() {
    return () => undefined;
  },

  onFileChanged(cb) {
    if (changeListeners.size === 0) {
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
    }
    changeListeners.add(cb);
    return () => {
      changeListeners.delete(cb);
      if (changeListeners.size === 0) {
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  },

  log(level, message) {
    (level === "debug" ? console.debug : console[level])(message);
  },

  appReady() {},

  setTitle(title) {
    document.title = title;
  },

  async readSettings() {
    try {
      return localStorage.getItem(SETTINGS_KEY);
    } catch {
      return null;
    }
  },

  async writeSettings(text) {
    localStorage.setItem(SETTINGS_KEY, text);
  },

  settingsLocation() {
    return `localStorage › ${SETTINGS_KEY}`;
  },
};
