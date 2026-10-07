/**
 * Minimal file-system interface for a project folder. Paths are relative to
 * the project folder and `/`-separated ("levels/main.json").
 *
 * Implemented by the browser File System Access API (`browserFs.ts`), an
 * in-memory map for tests (`memoryFs.ts`), and in v0.5 by Tauri.
 */
export interface ProjectFileSystem {
  /** Folder name (shown in recents and toasts). */
  readonly name: string;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** Names of files (not folders) directly inside `dir` ("" = root). Missing folder → []. */
  list(dir: string): Promise<string[]>;
  /** Deletes a file. A missing file is not an error. */
  remove(path: string): Promise<void>;
  /** Creates a folder (and parents) if missing. */
  mkdir(dir: string): Promise<void>;
}

/** Thrown by `read*` when the file does not exist. */
export class FileNotFoundError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = "FileNotFoundError";
    this.path = path;
  }
}

/** Splits "a/b/c.png" into ["a", "b"] and "c.png". */
export function splitPath(path: string): { dirs: string[]; file: string } {
  const parts = path.split("/").filter((p) => p.length > 0);
  const file = parts.pop() ?? "";
  return { dirs: parts, file };
}
