/**
 * Stamp files (v0.6): one `stamps/<id>.json` per saved stamp. Pure IO over a
 * `ProjectFileSystem` so it runs in tests with an in-memory folder.
 *
 * Stamps are flat copies (CLAUDE.md → Yapılmayacaklar): nothing in a level
 * refers to a stamp file, so deleting one only removes it from the library.
 */
import { parseStamp, serializeStamp, STAMPS_DIR, stampPath, type Stamp } from "@smap/core";

import { FileNotFoundError, type ProjectFileSystem } from "./fs";

export interface LoadedStamps {
  /** Valid stamps, sorted by name. */
  stamps: Stamp[];
  /** Files in `stamps/` that could not be read (kept on disk, never deleted on save). */
  broken: string[];
}

const isStampFile = (name: string) => name.endsWith(".json") && !name.startsWith(".");

/** Display order of the library: by name (Turkish collation), then id. */
export function sortStamps(stamps: readonly Stamp[]): Stamp[] {
  return [...stamps].sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** Reads every stamp file. A malformed file is reported in `broken`, never fatal. */
export async function loadStamps(fs: ProjectFileSystem): Promise<LoadedStamps> {
  const names = (await fs.list(STAMPS_DIR)).filter(isStampFile);
  const stamps: Stamp[] = [];
  const broken: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const path = `${STAMPS_DIR}/${name}`;
    try {
      const stamp = parseStamp(await fs.readText(path));
      // Two files claiming the same id: keep the one whose file name matches.
      if (seen.has(stamp.id)) {
        broken.push(path);
        continue;
      }
      seen.add(stamp.id);
      stamps.push(stamp);
    } catch {
      broken.push(path);
    }
  }
  return { stamps: sortStamps(stamps), broken };
}

async function readOrNull(fs: ProjectFileSystem, path: string): Promise<string | null> {
  try {
    return await fs.readText(path);
  } catch (error) {
    if (error instanceof FileNotFoundError) return null;
    throw error;
  }
}

/**
 * Makes `stamps/` match `stamps`: writes new and changed stamps (unchanged
 * files are not rewritten) and removes `.json` files of stamps that were
 * deleted. Paths in `keep` (files that could not be read) are left alone.
 */
export async function saveStamps(fs: ProjectFileSystem, stamps: readonly Stamp[], keep: Iterable<string> = []): Promise<void> {
  await fs.mkdir(STAMPS_DIR);
  const wanted = new Set<string>();
  for (const stamp of stamps) {
    const path = stampPath(stamp.id);
    wanted.add(path);
    const text = serializeStamp(stamp);
    if ((await readOrNull(fs, path)) === text) continue;
    await fs.writeText(path, text);
  }
  const kept = new Set(keep);
  for (const name of (await fs.list(STAMPS_DIR)).filter(isStampFile)) {
    const path = `${STAMPS_DIR}/${name}`;
    if (!wanted.has(path) && !kept.has(path)) await fs.remove(path);
  }
}
