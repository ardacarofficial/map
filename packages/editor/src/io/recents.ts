/**
 * Recent projects: directory handles kept in IndexedDB (handles are
 * structured-cloneable, so permission can be re-requested next session).
 * Every function degrades to a no-op where IndexedDB or the File System
 * Access API is unavailable.
 */
import { mergeThumbnail } from "../platform/recentThumbnail";

export interface RecentProject {
  /** Project name (from project.smap) at the time it was last opened/saved. */
  name: string;
  /** Folder name. */
  folder: string;
  handle: FileSystemDirectoryHandle;
  /** `Date.now()` of the last open/save. */
  openedAt: number;
  /** PNG data URL of the map at the last save. */
  thumbnail?: string;
}

const DB_NAME = "smap";
const STORE = "recentProjects";
const MAX_RECENTS = 8;
// Metadata and the later PNG update must not read/replace the same stale list.
let recentWrites: Promise<void> = Promise.resolve();
function enqueueRecent(work: () => Promise<void>): Promise<void> {
  const next = recentWrites.then(work, work);
  recentWrites = next.catch(() => undefined);
  return next;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "openedAt" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function readAll(db: IDBDatabase): Promise<RecentProject[]> {
  return new Promise((resolve) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as RecentProject[]).sort((a, b) => b.openedAt - a.openedAt));
    request.onerror = () => resolve([]);
  });
}

export function supportsRecents(): boolean {
  return typeof indexedDB !== "undefined" && typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Most recent first. */
export async function listRecents(): Promise<RecentProject[]> {
  if (!supportsRecents()) return [];
  await recentWrites;
  try {
    const db = await openDb();
    if (!db) return [];
    const all = await readAll(db);
    db.close();
    return all;
  } catch {
    return [];
  }
}

/**
 * Adds or refreshes `handle` (same folder entries are replaced). Keeps the
 * newest few. Without a `thumbnail` the replaced entry's picture is kept.
 */
export function rememberRecent(name: string, handle: FileSystemDirectoryHandle, thumbnail?: string): Promise<void> {
  return enqueueRecent(() => writeRecent(name, handle, thumbnail));
}

async function writeRecent(name: string, handle: FileSystemDirectoryHandle, thumbnail?: string): Promise<void> {
  if (!supportsRecents()) return;
  try {
    const db = await openDb();
    if (!db) return;
    const all = await readAll(db);
    // Decide what to drop before opening the transaction: awaiting anything
    // but IndexedDB inside it would auto-commit it.
    const drop: number[] = [];
    let kept = 0;
    let previous: string | undefined;
    for (const entry of all) {
      if (await entry.handle.isSameEntry(handle)) {
        drop.push(entry.openedAt);
        previous ??= entry.thumbnail;
      } else if (++kept >= MAX_RECENTS) drop.push(entry.openedAt);
    }
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const key of drop) store.delete(key);
    const picture = mergeThumbnail(previous, thumbnail);
    const record: RecentProject = { name, folder: handle.name, handle, openedAt: Math.max(Date.now(), (all[0]?.openedAt ?? 0) + 1), ...(picture ? { thumbnail: picture } : {}) };
    store.put(record);
    await done(tx);
    db.close();
  } catch (error) {
    console.warn("Could not store recent project", error);
  }
}

export function forgetRecent(openedAt: number): Promise<void> {
  return enqueueRecent(() => removeRecent(openedAt));
}

async function removeRecent(openedAt: number): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(openedAt);
    await done(tx);
    db.close();
  } catch {
    // Nothing to do: the list just keeps the entry.
  }
}
