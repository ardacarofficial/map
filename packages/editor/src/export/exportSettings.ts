/**
 * Per-project export memory: last export target, PNG scale, the Unity and
 * Tiled folders (directory handles are structured-cloneable, like recents),
 * and the "export to Unity on save" switch. Kept in its own IndexedDB
 * database, keyed by project name. Every function degrades to defaults /
 * no-ops where IndexedDB is unavailable.
 */
import type { PngScale } from "./pngComposite";

export type ExportTarget = "unity" | "png" | "json" | "tmj" | "zip";

export interface ExportSettings {
  /** Project name (the key). */
  project: string;
  target: ExportTarget;
  pngScale: PngScale;
  /** Folder inside the Unity project's Assets (null until picked). */
  unityDir: FileSystemDirectoryHandle | null;
  /** Folder for Tiled exports (null until picked). */
  tmjDir: FileSystemDirectoryHandle | null;
  /** Export to Unity after every save (manual and autosave). */
  autoUnity: boolean;
  /** `Date.now()` of the last Unity export. */
  lastUnityAt: number | null;
}

export function defaultExportSettings(project: string): ExportSettings {
  return { project, target: "unity", pngScale: 1, unityDir: null, tmjDir: null, autoUnity: false, lastUnityAt: null };
}

const DB_NAME = "smap-export";
const STORE = "settings";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "project" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** Cache, so the after-save hook does not hit IndexedDB on every autosave. */
const cache = new Map<string, ExportSettings>();

export async function loadExportSettings(project: string): Promise<ExportSettings> {
  const cached = cache.get(project);
  if (cached) return cached;
  let settings = defaultExportSettings(project);
  try {
    const db = await openDb();
    if (db) {
      const stored = await new Promise<Partial<ExportSettings> | undefined>((resolve) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(project);
        request.onsuccess = () => resolve(request.result as Partial<ExportSettings> | undefined);
        request.onerror = () => resolve(undefined);
      });
      db.close();
      if (stored) settings = { ...settings, ...stored, project };
    }
  } catch {
    // Defaults.
  }
  cache.set(project, settings);
  return settings;
}

/** Merges `patch` into the project's settings and stores them. Returns the new settings. */
export async function updateExportSettings(project: string, patch: Partial<ExportSettings>): Promise<ExportSettings> {
  const next = { ...(await loadExportSettings(project)), ...patch, project };
  cache.set(project, next);
  try {
    const db = await openDb();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(next);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      });
      db.close();
    }
  } catch (error) {
    console.warn("Could not store export settings", error);
  }
  return next;
}
