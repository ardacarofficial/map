/**
 * Project save / open over a `ProjectFileSystem`. No UI, no globals: the
 * caller supplies image bytes and an image decoder, so this runs in tests
 * with an in-memory folder.
 *
 * Folder layout (CLAUDE.md → Dosya düzeni):
 *   project.smap, levels/<level>.json, tilesets/*.png, stamps/, backups/
 */
import {
  PROJECT_FILE_NAME,
  parseLevel,
  parseProject,
  serializeLevel,
  serializeProject,
  type MapDocument,
} from "@smap/core";

import type { TilesetImage } from "../state/tilesetImages";
import { FileNotFoundError, type ProjectFileSystem } from "./fs";

/** The single level of a v0.1 project. */
export const DEFAULT_LEVEL_PATH = "levels/main.json";
/** Folders every project has (created empty when unused). */
export const PROJECT_DIRS = ["levels", "tilesets", "stamps", "backups"] as const;

export interface SaveProjectInput {
  name: string;
  document: MapDocument;
  levelPath: string;
  /** Original PNG bytes of a tileset; `undefined` keeps whatever file is on disk. */
  tilesetBytes(tilesetId: string): Uint8Array | undefined;
}

/**
 * Writes the whole project. Tileset images go first, then the level, and
 * `project.smap` last, so a project file on disk only ever points at files
 * that were already written. Unchanged tileset PNGs are not rewritten.
 */
export async function saveProject(fs: ProjectFileSystem, input: SaveProjectInput): Promise<void> {
  for (const dir of PROJECT_DIRS) await fs.mkdir(dir);

  const doc = input.document;
  for (const tileset of doc.tilesets) {
    const bytes = input.tilesetBytes(tileset.id);
    if (!bytes) continue;
    if (await sameFile(fs, tileset.imagePath, bytes)) continue;
    await fs.writeBytes(tileset.imagePath, bytes);
  }

  await fs.writeText(input.levelPath, serializeLevel(doc));
  await fs.writeText(
    PROJECT_FILE_NAME,
    serializeProject({
      name: input.name,
      levels: [{ name: levelName(input.levelPath), path: input.levelPath }],
      tilesets: doc.tilesets,
    }),
  );
}

async function sameFile(fs: ProjectFileSystem, path: string, bytes: Uint8Array): Promise<boolean> {
  let existing: Uint8Array;
  try {
    existing = await fs.readBytes(path);
  } catch (error) {
    if (error instanceof FileNotFoundError) return false;
    throw error;
  }
  if (existing.length !== bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (existing[i] !== bytes[i]) return false;
  return true;
}

/** "levels/main.json" → "main". */
export function levelName(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

export type ProjectOpenProblem = "noProjectFile" | "noLevel";

/** A project folder that cannot be opened for a reason other than a malformed file. */
export class ProjectOpenError extends Error {
  readonly problem: ProjectOpenProblem;
  constructor(problem: ProjectOpenProblem) {
    super(problem);
    this.name = "ProjectOpenError";
    this.problem = problem;
  }
}

export interface LoadedProject {
  name: string;
  document: MapDocument;
  levelPath: string;
  /** Decoded tileset images, ready for `setTilesetImage`. */
  images: TilesetImage[];
  /** Image paths that could not be found or decoded (the project still opens). */
  missingImages: string[];
}

export type ImageDecoder = (bytes: Uint8Array) => Promise<ImageBitmap>;

/**
 * Reads a project folder.
 * @throws ProjectOpenError, FormatError (malformed files), FileNotFoundError (level missing).
 */
export async function loadProject(fs: ProjectFileSystem, decode: ImageDecoder): Promise<LoadedProject> {
  let projectText: string;
  try {
    projectText = await fs.readText(PROJECT_FILE_NAME);
  } catch (error) {
    if (error instanceof FileNotFoundError) throw new ProjectOpenError("noProjectFile");
    throw error;
  }
  const project = parseProject(projectText);
  const level = project.levels[0];
  if (!level) throw new ProjectOpenError("noLevel");
  const document = parseLevel(await fs.readText(level.path), project.tilesets);

  const images: TilesetImage[] = [];
  const missingImages: string[] = [];
  await Promise.all(
    project.tilesets.map(async (tileset) => {
      try {
        const bytes = await fs.readBytes(tileset.imagePath);
        images.push({ tilesetId: tileset.id, bitmap: await decode(bytes), bytes });
      } catch {
        missingImages.push(tileset.imagePath);
      }
    }),
  );
  // Keep project order regardless of which read finished first.
  const order = new Map(project.tilesets.map((t, i) => [t.id, i]));
  images.sort((a, b) => (order.get(a.tilesetId) ?? 0) - (order.get(b.tilesetId) ?? 0));
  missingImages.sort();

  return { name: project.name, document, levelPath: level.path, images, missingImages };
}

/** Decodes PNG bytes in the browser. */
export const decodePng: ImageDecoder = (bytes) =>
  createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
