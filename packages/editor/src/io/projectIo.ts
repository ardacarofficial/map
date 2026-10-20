import { decodeEditedPng, EditedAssetError } from "./editedPng";
import { rasterContentHash } from "@smap/core";
import type { ColorPalette } from "@smap/core";
import { generatedRecipePath, loadGeneratedRecipes, type GeneratedRecipe } from "./smartStampRecipes";
/**
 * Project save / open over a `ProjectFileSystem`. No UI, no globals: the
 * caller supplies image bytes and an image decoder, so this runs in tests
 * with an in-memory folder.
 *
 * Folder layout (CLAUDE.md → Dosya düzeni):
 *   project.smap, levels/<level>.json, tilesets/*.png, stamps/, backups/
 */
import {
  DOCUMENT_FORMAT_VERSION,
  fileFormatVersion,
  levelIdFromPath,
  PROJECT_FILE_NAME,
  parseLevel,
  parseProject,
  serializeLevel,
  serializeProject,
  serializeStamp,
  stampPath,
  type LevelRef,
  type MapDocument,
  type ProjectLevel,
  type ProjectSettings,
  type Stamp,
} from "@smap/core";

import type { TilesetImage } from "../state/tilesetImages";
import { resolveFileData, type FileData, type PngBytes } from "./fileData";
import { FileNotFoundError, splitPath, type ProjectFileSystem } from "./fs";
import { loadStamps, removeStaleStamps } from "./stampsIo";
import { discardSaveBackups, protectSavedProject, recoverSavedProject } from "./saveRecovery";

/** The single level of a v0.1 project. */
export const DEFAULT_LEVEL_PATH = "levels/main.json";
/** Folders every project has (created empty when unused). */
export const PROJECT_DIRS = ["levels", "tilesets", "stamps", "backups"] as const;

export interface SaveProjectInput {
  name: string;
  colorPalettes?: readonly ColorPalette[];
  document: MapDocument;
  levelPath: string;
  /** Original PNG bytes of a tileset; `undefined` keeps whatever file is on disk. */
  tilesetBytes(tilesetId: string): PngBytes | undefined;
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
  generatedRecipes?: readonly GeneratedRecipe[];
  /** Stamp files that could not be read when the project was opened; never deleted. */
  keepStampFiles?: Iterable<string>;
  /**
   * v1.0: further levels to write with this save (dirty levels other than
   * `document`). Written after `levelPath`, before `project.smap`.
   */
  otherLevels?: readonly { readonly path: string; readonly document: MapDocument }[];
  /** v1.0: ids of removed levels (kept in project.smap so they are never reused). */
  retiredLevelIds?: readonly string[];
  /** v1.0: level files to delete after `project.smap` is written (removed levels). */
  removeFiles?: readonly string[];
  /** Round 4: project settings (written only when they differ from the defaults). */
  settings?: ProjectSettings;
}

/** `levels` with the saved level in it (a level path is listed once). */
export function levelsForSave(levels: readonly LevelRef[] | undefined, levelPath: string): LevelRef[] {
  const list = [...(levels ?? [])];
  if (!list.some((l) => l.path === levelPath)) list.push({ name: levelName(levelPath), path: levelPath });
  return list;
}

/** The level list of a project that was never saved: just its one level. */
export function defaultLevels(levelPath: string, name?: string): ProjectLevel[] {
  return [{ id: levelIdFromPath(levelPath), name: name ?? levelName(levelPath), path: levelPath, world: { x: 0, y: 0 } }];
}

/** One file of a project folder, relative to it. Text is UTF-8. */
export interface ProjectFile {
  readonly path: string;
  readonly data: FileData;
}

/**
 * The new files a save writes, in write order: tileset images first, then the
 * level, and `project.smap` last, so a project file only ever points at files
 * that exist. Tilesets without bytes are left out. Shared by the save
 * pipeline and the zip export. The folder writer first publishes a complete
 * backup of an existing project (see saveRecovery.ts), so replacing a level
 * never invalidates the previously committed root.
 */
export function projectFiles(input: SaveProjectInput): ProjectFile[] {
  const doc = input.document;
  const files: ProjectFile[] = [];
  for (const tileset of doc.tilesets) {
    const bytes = input.tilesetBytes(tileset.id);
    if (bytes) files.push({ path: tileset.imagePath, data: bytes });
  }
  for (const recipe of input.generatedRecipes ?? []) if (doc.getTileset(recipe.tilesetId)?.generated) files.push({ path: generatedRecipePath(recipe.tilesetId), data: serializeStamp(recipe.stamp) });
  for (const stamp of input.stamps ?? []) files.push({ path: stampPath(stamp.id), data: serializeStamp(stamp) });
  files.push({ path: input.levelPath, data: serializeLevel(doc) });
  for (const level of input.otherLevels ?? []) {
    if (level.path !== input.levelPath) files.push({ path: level.path, data: serializeLevel(level.document) });
  }
  files.push({
    path: PROJECT_FILE_NAME,
    data: serializeProject({
      name: input.name,
      levels: levelsForSave(input.levels, input.levelPath),
      tilesets: doc.tilesets,
      entityTypes: doc.entityTypes,
      randomSets: doc.randomSets,
      collections: doc.collections,
      colorPalettes: input.colorPalettes ?? [],
      ...(input.retiredLevelIds && input.retiredLevelIds.length > 0 ? { retiredLevelIds: input.retiredLevelIds } : {}),
      ...(input.settings ? { settings: input.settings } : {}),
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
  return (await saveProjectLevels(fs, input)).get(input.levelPath) ?? "";
}

/**
 * Like {@link saveProject}, returning the text written for every level
 * (`levelPath` and `otherLevels`), keyed by path. Removed level files
 * (`removeFiles`) are deleted after `project.smap` no longer lists them.
 */
export async function saveProjectLevels(fs: ProjectFileSystem, input: SaveProjectInput): Promise<Map<string, string>> {
  // Serialize before the first await: cells, raster revisions and metadata belong
  // to the same logical save, even if editing continues during IO.
  const files = projectFiles(input);
  const sourcePaths = new Set(input.document.tilesets.filter(ts => !ts.generated && !ts.edited).map(ts => ts.imagePath));
  const dirs = new Set<string>(PROJECT_DIRS);
  for (const file of files) {
    const parent = splitPath(file.path).dirs.join("/");
    if (parent) dirs.add(parent);
  }
  for (const dir of dirs) await fs.mkdir(dir);

  await protectSavedProject(fs);

  const levelTexts = new Map<string, string>();
  const levelPaths = new Set([input.levelPath, ...(input.otherLevels ?? []).map((l) => l.path)]);
  const stampFiles = new Set((input.stamps ?? []).map((s) => stampPath(s.id)));
  for (const file of files) {
    // Existing user sources belong to the disk, including external edits that
    // the watcher has not delivered yet. Only confirmed PNG write-back may
    // replace them. Imports and image replacements use new revision paths.
    if (sourcePaths.has(file.path) && typeof file.data !== "string") {
      try { await fs.readBytes(file.path); continue; }
      catch (error) { if (!(error instanceof FileNotFoundError)) throw error; }
    }
    const data = await resolveFileData(file.data);
    if (typeof data === "string") {
      // Unchanged stamp files are not rewritten (a library can hold many).
      if (stampFiles.has(file.path) && (await sameText(fs, file.path, data))) continue;
      await fs.writeText(file.path, data);
      if (levelPaths.has(file.path)) levelTexts.set(file.path, data);
    } else if (!(await sameFile(fs, file.path, data))) {
      await fs.writeBytes(file.path, data);
    }
  }
  // Removed levels lose their file only now: project.smap no longer lists them.
  for (const path of input.removeFiles ?? []) {
    if (!levelPaths.has(path)) await fs.remove(path);
  }
  // Deleted stamps lose their file (after project.smap, which never refers to stamps).
  if (input.stamps) await removeStaleStamps(fs, input.stamps, input.keepStampFiles);
  await discardSaveBackups(fs);
  return levelTexts;
}

async function sameText(fs: ProjectFileSystem, path: string, text: string): Promise<boolean> {
  try {
    return (await fs.readText(path)) === text;
  } catch (error) {
    if (error instanceof FileNotFoundError) return false;
    throw error;
  }
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
  /** Exact approved root bytes, for external-change echo detection. */
  projectText: string;
  name: string;
  colorPalettes?: readonly ColorPalette[];
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
  /** Id of the opened level (`levels` entry whose path is `levelPath`). */
  levelId: string;
  /** Ids of removed levels (never handed out again). */
  retiredLevelIds: string[];
  /** Saved stamps (`stamps/*.json`), sorted by name. */
  stamps: Stamp[];
  generatedRecipes: GeneratedRecipe[];
  /** Stamp files that could not be read (the project still opens). */
  brokenStamps: string[];
  /** Round 4: project settings (defaults when the file has none). */
  settings: ProjectSettings;
}

export type ImageDecoder = (bytes: Uint8Array) => Promise<ImageBitmap>;

/**
 * Reads a project folder.
 * @throws ProjectOpenError, FormatError (malformed files), FileNotFoundError (level missing).
 */
export async function loadProject(
  fs: ProjectFileSystem,
  decode: ImageDecoder,
  options: { readonly levelId?: string } = {},
): Promise<LoadedProject> {
  await recoverSavedProject(fs);
  let projectText: string;
  try {
    projectText = await fs.readText(PROJECT_FILE_NAME);
  } catch (error) {
    if (error instanceof FileNotFoundError) throw new ProjectOpenError("noProjectFile");
    throw error;
  }
  const project = parseProject(projectText);
  // The requested level (reload keeps the open one), else the first.
  const level = project.levels.find((l) => l.id === options.levelId) ?? project.levels[0];
  if (!level) throw new ProjectOpenError("noLevel");
  const levelText = await fs.readText(level.path);
  const document = parseLevel(levelText, project.tilesets, project.entityTypes, {
    randomSets: project.randomSets,
    collections: project.collections,
  });

  if (fileFormatVersion(projectText)! < DOCUMENT_FORMAT_VERSION && document.migrations.length === 0) document._setMigrations(["format.migrated"]);

  const images: TilesetImage[] = [];
  const missingImages: string[] = [];
  const invalidEdited: string[] = [];
  await Promise.all(
    project.tilesets.map(async (tileset) => {
      try {
        const bytes = await fs.readBytes(tileset.imagePath);
        if (tileset.edited) {
          const raster = decodeEditedPng(bytes);
          if (raster.width !== tileset.columns * tileset.tileWidth || raster.height !== tileset.rows * tileset.tileHeight || rasterContentHash(raster.width, raster.height, raster.data) !== tileset.edited.contentHash) throw new EditedAssetError([tileset.imagePath]);
        }
        images.push({ tilesetId: tileset.id, bitmap: await decode(bytes), bytes });
      } catch {
        (tileset.edited ? invalidEdited : missingImages).push(tileset.imagePath);
      }
    }),
  );
  if (invalidEdited.length) { for (const image of images) image.bitmap.close(); throw new EditedAssetError(invalidEdited.sort()); }
  // Keep project order regardless of which read finished first.
  const order = new Map(project.tilesets.map((t, i) => [t.id, i]));
  images.sort((a, b) => (order.get(a.tilesetId) ?? 0) - (order.get(b.tilesetId) ?? 0));
  missingImages.sort();
  const { stamps, broken } = await loadStamps(fs, project.tilesets);

  return {
    projectText,
    name: project.name,
    colorPalettes: project.colorPalettes ?? [],
    document,
    levelPath: level.path,
    levelText,
    images,
    missingImages,
    levels: [...project.levels],
    levelId: level.id,
    retiredLevelIds: [...project.retiredLevelIds],
    stamps,
    // The parsed project tilesets retain migration-only family lookups until
    // external legacy recipes are converted. Document tilesets are normalized copies.
    generatedRecipes: await loadGeneratedRecipes(fs, project.tilesets, [...(project.generatedRecipes ?? []), ...stamps], broken),
    brokenStamps: broken,
    settings: project.settings,
  };
}

/** Decodes PNG bytes in the browser. */
export const decodePng: ImageDecoder = (bytes) =>
  createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
