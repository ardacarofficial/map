import { FileNotFoundError, splitPath, type ProjectFileSystem } from "./fs";

/** In-memory project folder (tests; also handy for previews). */
export class MemoryFileSystem implements ProjectFileSystem {
  readonly name: string;
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>([""]);

  constructor(name = "memory") {
    this.name = name;
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new FileNotFoundError(path);
    return bytes.slice();
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const { dirs } = splitPath(path);
    await this.mkdir(dirs.join("/"));
    this.files.set(path, bytes.slice());
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(dir: string): Promise<string[]> {
    const prefix = dir === "" ? "" : `${dir}/`;
    const names: string[] = [];
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (!rest.includes("/")) names.push(rest);
    }
    return names.sort();
  }

  async mkdir(dir: string): Promise<void> {
    const parts = dir.split("/").filter((p) => p.length > 0);
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
  }
}
