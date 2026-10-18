/**
 * Stamp files (v0.6): one `stamps/<id>.json` per saved stamp. Pure IO over a
 * `ProjectFileSystem` so it runs in tests with an in-memory folder.
 *
 * Stamps are flat copies (CLAUDE.md → Yapılmayacaklar): nothing in a level
 * refers to a stamp file, so deleting one only removes it from the library.
 */
import { parseStamp, STAMPS_DIR, stampPath, type Stamp, type Tileset } from "@smap/core";

import type { ProjectFileSystem } from "./fs";

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
export async function loadStamps(fs: ProjectFileSystem, tilesets: readonly Tileset[] = []): Promise<LoadedStamps> {
  const names = (await fs.list(STAMPS_DIR)).filter(isStampFile);
  const stamps: Stamp[] = [];
  const broken: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const path = `${STAMPS_DIR}/${name}`;
    try {
      const stamp = parseStamp(await fs.readText(path), tilesets);
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

/**
 * Removes `.json` files in `stamps/` of stamps that are no longer in the
 * library. Paths in `keep` (files that could not be read) are left alone.
 */
export async function removeStaleStamps(fs: ProjectFileSystem, stamps: readonly Stamp[], keep: Iterable<string> = []): Promise<void> {
  const wanted = new Set(stamps.map((s) => stampPath(s.id)));
  const kept = new Set(keep);
  for (const name of (await fs.list(STAMPS_DIR)).filter(isStampFile)) {
    const path = `${STAMPS_DIR}/${name}`;
    if (!wanted.has(path) && !kept.has(path)) await fs.remove(path);
  }
}
