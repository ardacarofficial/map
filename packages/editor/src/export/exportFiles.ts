/**
 * Which files an export writes, and writing them into a folder. Pure: the
 * caller supplies the tileset PNG bytes (from the image registry) and a
 * `ProjectFileSystem` for the target folder (browser directory handle today,
 * Tauri in v0.5, an in-memory folder in tests).
 */
import { exportTmj, exportUnityMap, type ExportImage, type ExportWarning, type MapDocument } from "@smap/core";

import { FileNotFoundError, type ProjectFileSystem } from "../io/fs";

/** One file of an export, relative to the target folder. */
export interface ExportFile {
  readonly path: string;
  readonly data: string | Uint8Array;
}

export interface ExportFileSet {
  /** The map file name (`main.smapmap`, `main.tmj`). */
  readonly mapFile: string;
  /** Tileset images first, the map file last (an importer sees the PNGs before the map). */
  readonly files: readonly ExportFile[];
  /** Tileset image paths with no bytes in the registry (not written). */
  readonly missingImages: readonly string[];
  /** Exporter warnings (structured; the dialog translates them). */
  readonly warnings: readonly ExportWarning[];
}

/** Original PNG bytes of a tileset, `undefined` when the image is missing. */
export type TilesetBytes = (tilesetId: string) => Uint8Array | undefined;

function withImages(
  mapFile: string,
  text: string,
  images: readonly ExportImage[],
  bytes: TilesetBytes,
  warnings: readonly ExportWarning[],
): ExportFileSet {
  const files: ExportFile[] = [];
  const missingImages: string[] = [];
  for (const image of images) {
    const data = bytes(image.tileset.id);
    if (data) files.push({ path: image.fileName, data });
    else missingImages.push(image.sourcePath);
  }
  files.push({ path: mapFile, data: text });
  return { mapFile, files, missingImages, warnings };
}

/** `<level>.smapmap` + the tileset PNGs it references (Unity importer). */
export function unityExportFiles(doc: MapDocument, levelName: string, bytes: TilesetBytes): ExportFileSet {
  const result = exportUnityMap(doc, levelName);
  return withImages(result.fileName, result.text, result.images, bytes, result.warnings ?? []);
}

/** `<level>.tmj` + the tileset PNGs next to it (Tiled, Godot, Phaser). */
export function tmjExportFiles(doc: MapDocument, levelName: string, bytes: TilesetBytes): ExportFileSet {
  const result = exportTmj(doc, levelName);
  return withImages(result.fileName, result.text, result.images, bytes, result.warnings);
}

export interface WriteResult {
  /** Paths actually written. */
  readonly written: readonly string[];
  /** Paths skipped because the folder already had the same bytes. */
  readonly unchanged: readonly string[];
}

/**
 * Writes `files` in order. A file whose bytes on disk are already identical
 * is not rewritten, so the Unity watcher does not reimport unchanged PNGs
 * (or a map whose export did not change).
 */
export async function writeExportFiles(fs: ProjectFileSystem, files: readonly ExportFile[]): Promise<WriteResult> {
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const file of files) {
    const bytes = typeof file.data === "string" ? new TextEncoder().encode(file.data) : file.data;
    if (await sameBytes(fs, file.path, bytes)) {
      unchanged.push(file.path);
      continue;
    }
    await fs.writeBytes(file.path, bytes);
    written.push(file.path);
  }
  return { written, unchanged };
}

async function sameBytes(fs: ProjectFileSystem, path: string, bytes: Uint8Array): Promise<boolean> {
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
