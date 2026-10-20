import type { AgentConnection } from "@smap/agent";
/**
 * What the editor needs from its host (browser tab or Tauri window). The
 * editor never calls host APIs (File System Access, IndexedDB, Tauri) directly;
 * it asks `getPlatform()`. Dependency direction stays `desktop → editor → core`:
 * the desktop package builds a `Platform` and hands it to `startEditor`.
 */
import type { ProjectFileSystem } from "../io/fs";

/** A project folder the editor can read and write. */
export interface ProjectLocation {
  fs: ProjectFileSystem;
  /**
   * Host-specific identity: a directory handle in the browser, the folder
   * path on the desktop. Opaque to the editor; the platform compares it.
   */
  readonly ref: unknown;
  /** Shown to the user (folder name or full path). */
  readonly label: string;
}

export interface RecentEntry {
  /** Unique key within the list. */
  readonly key: string;
  /** Project name at the time it was last opened/saved. */
  readonly name: string;
  /** Folder name (browser) or folder path (desktop). */
  readonly location: string;
  /** Unix ms of the last open/save. */
  readonly openedAt: number;
  /** False when the platform already knows the project is gone. */
  readonly exists: boolean;
  /** Small PNG data URL of the map at the last save (absent until the project is saved once). */
  readonly thumbnail?: string;
}

export type FileChangeKind = "created" | "modified" | "removed";

/** A file of the open project that changed on disk (a hint: compare contents before acting). */
export interface ProjectFileChange {
  /** Project-relative, `/`-separated ("tilesets/grass.png"). */
  path: string;
  kind: FileChangeKind;
}

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface SaveFileFilter {
  name: string;
  extensions: string[];
}

export interface Platform {
  /** Optional transport injected by desktop or the serve-only development bridge. */
  agent?: AgentConnection;
  readonly kind: "browser" | "desktop";

  /** Asks for an existing project. `null` = cancelled. */
  openProjectDialog(): Promise<ProjectLocation | null>;
  /**
   * Asks where to save a new project called `projectName` and returns its
   * folder (the picked folder when empty, otherwise a sub-folder named after
   * the project). `null` = cancelled. Throws `FolderTakenError` when that
   * sub-folder already holds another project.
   */
  pickProjectFolder(projectName: string, current: ProjectLocation | null): Promise<ProjectLocation | null>;
  /** Opens a project by OS path (`.smap` from argv / double click). Desktop only. */
  openPath(path: string): Promise<ProjectLocation>;
  /**
   * The editor's current project folder changed (opened, saved for the first
   * time, closed → `null`). The platform watches it for `onFileChanged`.
   */
  watchProject(location: ProjectLocation | null): void;

  readonly recents: {
    /** False where recents cannot be kept (browser without IndexedDB / FS Access). */
    readonly supported: boolean;
    list(): Promise<RecentEntry[]>;
    /**
     * Adds or refreshes an entry. `thumbnail` (PNG data URL, see
     * `recentThumbnail.ts`) replaces the stored one; without it the entry
     * keeps its previous picture.
     */
    add(location: ProjectLocation, name: string, thumbnail?: string): Promise<void>;
    remove(entry: RecentEntry): Promise<void>;
    /**
     * Turns an entry into an openable folder (asking for permission again if
     * needed). `null` = permission denied. Throws `RecentGoneError`.
     */
    open(entry: RecentEntry): Promise<ProjectLocation | null>;
  };

  /**
   * `.smap` paths the OS asks us to open (startup argv, second instance).
   * Resolves with an unsubscribe once listening, after a pending startup
   * request (if any) has been handed to `cb`.
   */
  onOpenFile(cb: (path: string) => void): Promise<() => void>;
  /** Files of the watched project that changed on disk. Returns an unsubscribe. */
  onFileChanged(cb: (change: ProjectFileChange) => void): () => void;

  /** Writes to the app log (desktop: log file; browser: console). */
  log(level: LogLevel, message: string): void;
  /** First frame is on screen (desktop shows the hidden window). */
  appReady(): void;
  /** Window title. */
  setTitle(title: string): void;

  /**
   * The user closes the window (X button, Alt+F4, taskbar). `shouldClose`
   * decides (asks about unsaved work); resolving true closes the window.
   * Desktop only: the browser build keeps `beforeunload`, which cannot wait
   * for an answer. Returns an unsubscribe.
   */
  onCloseRequested(shouldClose: () => Promise<boolean>): () => void;
  /**
   * Whether closing now would lose work. While false the desktop closes at
   * once without asking the page (so a hung page can still be closed).
   */
  setUnsavedChanges(unsaved: boolean): void;

  /** Raw settings JSON, or `null` when none is stored yet. */
  readSettings(): Promise<string | null>;
  writeSettings(text: string): Promise<void>;
  /** Where settings live, shown in the settings dialog ("settings.json" path or "localStorage"). */
  settingsLocation(): string;

  /** Native folder destination for multi-file exports. Browser uses directory handles. */
  pickExportFolder?(): Promise<ProjectLocation | null>;

  /**
   * Saves an exported file where the user chooses (desktop: native save
   * dialog). Absent → the editor downloads it. Resolves false when cancelled.
   */
  openFile?(filter: SaveFileFilter): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveFile?(fileName: string, bytes: Uint8Array, filter: SaveFileFilter): Promise<boolean>;
}

/** The sub-folder for a new project already contains a different project. */
export class FolderTakenError extends Error {
  readonly folder: string;
  constructor(folderName: string) {
    super(folderName);
    this.name = "FolderTakenError";
    this.folder = folderName;
  }
}

/** A recent project no longer exists where it was. */
export class RecentGoneError extends Error {
  constructor(location: string) {
    super(location);
    this.name = "RecentGoneError";
  }
}

/** Folder name for a project inside a chosen parent folder. */
export function folderNameFor(projectName: string): string {
  const name = projectName.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return name.length > 0 ? name : "harita";
}
