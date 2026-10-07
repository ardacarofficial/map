/** `ProjectFileSystem` over a File System Access API directory handle (Chromium). */
import { FileNotFoundError, splitPath, type ProjectFileSystem } from "./fs";

export class DirectoryHandleFileSystem implements ProjectFileSystem {
  readonly handle: FileSystemDirectoryHandle;

  constructor(handle: FileSystemDirectoryHandle) {
    this.handle = handle;
  }

  get name(): string {
    return this.handle.name;
  }

  async readText(path: string): Promise<string> {
    return (await this.#file(path)).text();
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.#write(path, text);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.#file(path)).arrayBuffer());
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.#write(path, new Blob([bytes as Uint8Array<ArrayBuffer>]));
  }

  async list(dir: string): Promise<string[]> {
    let folder: FileSystemDirectoryHandle;
    try {
      folder = await this.#dir(dir === "" ? [] : dir.split("/"), false);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const names: string[] = [];
    for await (const [name, entry] of folder.entries()) {
      if (entry.kind === "file") names.push(name);
    }
    return names.sort();
  }

  async remove(path: string): Promise<void> {
    const { dirs, file } = splitPath(path);
    try {
      await (await this.#dir(dirs, false)).removeEntry(file);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async mkdir(dir: string): Promise<void> {
    await this.#dir(dir.split("/").filter(Boolean), true);
  }

  async #dir(parts: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let folder = this.handle;
    for (const part of parts) folder = await folder.getDirectoryHandle(part, { create });
    return folder;
  }

  async #file(path: string): Promise<File> {
    const { dirs, file } = splitPath(path);
    try {
      const folder = await this.#dir(dirs, false);
      return await (await folder.getFileHandle(file)).getFile();
    } catch (error) {
      if (isNotFound(error)) throw new FileNotFoundError(path);
      throw error;
    }
  }

  async #write(path: string, data: string | Blob): Promise<void> {
    const { dirs, file } = splitPath(path);
    const folder = await this.#dir(dirs, true);
    const handle = await folder.getFileHandle(file, { create: true });
    // createWritable writes to a swap file and replaces the target on close,
    // so a failed write never leaves a half-written file behind.
    const stream = await handle.createWritable();
    try {
      await stream.write(data);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => undefined);
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotFoundError" || error.name === "TypeMismatchError");
}

export function supportsDirectoryAccess(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/**
 * Asks the user for a folder with read/write access. Returns `null` when the
 * user cancels. Throws when the API is unsupported or access is denied.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) throw new UnsupportedError();
  try {
    return await window.showDirectoryPicker({ id: "smap-project", mode: "readwrite" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

/** Makes sure we may read and write `handle` (asks the user if needed; needs a user gesture). */
export async function ensureReadWrite(handle: FileSystemHandle): Promise<boolean> {
  const descriptor = { mode: "readwrite" } as const;
  if (!handle.queryPermission || !handle.requestPermission) return true;
  if ((await handle.queryPermission(descriptor)) === "granted") return true;
  return (await handle.requestPermission(descriptor)) === "granted";
}

export class UnsupportedError extends Error {
  constructor() {
    super("File System Access API is not supported");
    this.name = "UnsupportedError";
  }
}
