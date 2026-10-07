/**
 * Project save / open over a `ProjectFileSystem`. No UI, no globals: the
 * caller supplies image bytes and an image decoder, so this runs in tests
 * with an in-memory folder.
 *
 * Folder layout (CLAUDE.md → Dosya düzeni):
 *   project.smap, levels/<level>.json, tilesets/*.png, stamps/, backups/
 */
import {
  levelIdFromPath,
  PROJECT_FILE_NAME,
  parseLevel,
  parseProject,
  serializeLevel,
  serializeProject,
  type LevelRef,
  type MapDocument,
  type ProjectLevel,
  type Stamp,
} from "@smap/core";

import type { TilesetImage } from "../state/tilesetImages";
import { FileNotFoundError, type ProjectFileSystem } from "./fs";
import { loadStamps, saveStamps } from "./stampsIo";

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
  /**
   * The project's level list as loaded (keeps level ids and world positions).
   * The level being saved is added when missing. Defaults to just that level.
   */
  levels?: readonly LevelRef[];
  /**
   * The stamp library. `stamps/` is made to match it (deleted stamps lose
   * their file). `undefined` leaves the stamp files alone.
   */
  stamps?: readonly Stamp[];
  /** Stamp files that could not be read when the project was opened; never deleted. */
  keepStampFiles?: Iterable<string>;
}

/** `levels` with the saved level in it (a level path is listed once). */
export function levelsForSave(levels: readonly LevelRef[] | undefined, levelPath: string): LevelRef[] {
  const list = [...(levels ?? [])];
  if (!list.some((l) => l.path === levelPath)) list.push({ name: levelName(levelPath), path: levelPath });
  return list;
}

/** The level list of a project that was never saved: just its one level. */
export function defaultLevels(levelPath: string): ProjectLevel[] {
  return [{ id: levelIdFromPath(levelPath), name: levelName(levelPath), path: levelPath, world: { x: 0, y: 0 } }];
}

/** One file of a project folder, relative to it. Text is UTF-8. */
export interface ProjectFile {
  readonly path: string;
  readonly data: string | Uint8Array;
}

/**
 * The files a save writes, in write order: tileset images first, then the
 * level, and `project.smap` last, so a project file only ever points at files
 * that exist. Tilesets without bytes are left out. Shared by the save
 * pipeline and the zip export.
 */
export function projectFiles(input: SaveProjectInput): ProjectFile[] {
  const doc = input.document;
  const files: ProjectFile[] = [];
  for (const tileset of doc.tilesets) {
    const bytes = input.tilesetBytes(tileset.id);
    if (bytes) files.push({ path: tileset.imagePath, data: bytes });
  }
  files.push({ path: input.levelPath, data: serializeLevel(doc) });
  files.push({
    path: PROJECT_FILE_NAME,
    data: serializeProject({
      name: input.name,
      levels: [{ name: levelName(input.levelPath), path: input.levelPath }],
      tilesets: doc.tilesets,
    }),
  });
  return files;
}

/**
 * Writes the whole project (see `projectFiles` for the order). Unchanged
 * tileset PNGs are not rewritten. Returns the level text that was written
 * (for backups and change detection).
 */
export async function saveProject(fs: ProjectFileSystem, input: SaveProjectInput): Promise<string> {
  for (const dir of PROJECT_DIRS) await fs.mkdir(dir);

  let levelText = "";
  for (const file of projectFiles(input)) {
    if (typeof file.data === "string") {
      await fs.writeText(file.path, file.data);
      if (file.path === input.levelPath) levelText = file.data;
    } else if (!(await sameFile(fs, file.path, file.data))) {
      await fs.writeBytes(file.path, file.data);
    }
  }
  return levelText;
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
  /** The level file exactly as read (for external change detection). */
  levelText: string;
  /** Decoded tileset images, ready for `setTilesetImage`. */
  images: TilesetImage[];
  /** Image paths that could not be found or decoded (the project still opens). */
  missingImages: string[];
  /** The project's level list (ids, names, world positions). */
  levels: ProjectLevel[];
  /** Saved stamps (`stamps/*.json`), sorted by name. */
  stamps: Stamp[];
  /** Stamp files that could not be read (the project still opens). */
  brokenStamps: string[];
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
  const levelText = await fs.readText(level.path);
  const document = parseLevel(levelText, project.tilesets, project.entityTypes);

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
  const { stamps, broken } = await loadStamps(fs);

  return {
    name: project.name,
    document,
    levelPath: level.path,
    levelText,
    images,
    missingImages,
    levels: [...project.levels],
    stamps,
    brokenStamps: broken,
  };
}

/** Decodes PNG bytes in the browser. */
export const decodePng: ImageDecoder = (bytes) =>
  createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
