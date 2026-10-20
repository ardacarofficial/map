/** Map backups wrap the existing project/level codecs; PNGs stay immutable files. */
import { FormatError, parseLevel, parseProject, serializeProject, rasterContentHash, type MapDocument, type Tileset } from "@smap/core";
import type { TilesetImage } from "../state/tilesetImages";
import { EditedAssetError, decodeEditedPng } from "./editedPng";
import type { ProjectFileSystem } from "./fs";
import { contentHash, SNAPSHOT_IMAGE_DIR, writeImmutable } from "./immutableFiles";
import type { ImageDecoder } from "./projectIo";

const encoder = new TextEncoder();

/** The returned bytes are also the dedup key: a pixel-only edit changes it. */
export async function captureLevelBackup(fs: ProjectFileSystem, levelText: string, projectText: string): Promise<string> {
  const project = parseProject(projectText);
  const document = parseLevel(levelText, project.tilesets, project.entityTypes);
  const used = new Set(document.palette.entries().map(entry => entry.tilesetId));
  const tilesets: Tileset[] = [];
  await fs.mkdir(SNAPSHOT_IMAGE_DIR);
  for (const tileset of project.tilesets) if (used.has(tileset.id)) {
    const bytes = await fs.readBytes(tileset.imagePath);
    const path = `${SNAPSHOT_IMAGE_DIR}/${await contentHash(bytes)}.png`;
    await writeImmutable(fs, path, bytes);
    tilesets.push({ ...tileset, imagePath: path });
  }
  return `${JSON.stringify({
    format: "smap-backup",
    backupFormatVersion: 1,
    project: JSON.parse(serializeProject({ ...project, tilesets, generatedRecipes: [] })),
    level: JSON.parse(levelText),
  }, null, 2)}\n`;
}

/** Remap historical assets to independent ids in the current world's raster store. */
export async function restoreLevelBackup(
  fs: ProjectFileSystem, text: string, current: MapDocument, decode: ImageDecoder,
  reservedRasterIds: readonly string[],
): Promise<{ document: MapDocument; images: TilesetImage[] }> {
  const root = JSON.parse(text) as { format?: string; backupFormatVersion?: number; project?: unknown; level?: unknown };
  if (root.format !== "smap-backup") return {
    document: parseLevel(text, current.tilesets, current.entityTypes, { randomSets: current.randomSets, collections: current.collections }), images: [],
  };
  if (root.backupFormatVersion !== 1) throw new FormatError("backupFormatVersion", "Unsupported backup version");
  const historical = parseProject(JSON.stringify(root.project));
  const levelText = JSON.stringify(root.level);
  // Validate before interpreting/remapping palette references.
  parseLevel(levelText, historical.tilesets, historical.entityTypes);
  const tilesets = [...current.tilesets], ids = new Map<string, string>(), images: TilesetImage[] = [];
  // Undo and inactive maps may retain raster slots whose metadata is absent
  // from this map. Never load historical bytes into any occupied identity.
  const occupied = new Set([...tilesets.map(ts => ts.id), ...reservedRasterIds]);
  try {
    for (const tileset of historical.tilesets) {
      const bytes = await fs.readBytes(tileset.imagePath);
      if (tileset.imagePath !== `${SNAPSHOT_IMAGE_DIR}/${await contentHash(bytes)}.png`) throw new EditedAssetError([tileset.imagePath]);
      if (tileset.edited) {
        const r = decodeEditedPng(bytes);
        if (r.width !== tileset.columns * tileset.tileWidth || r.height !== tileset.rows * tileset.tileHeight || rasterContentHash(r.width, r.height, r.data) !== tileset.edited.contentHash) throw new EditedAssetError([tileset.imagePath]);
      }
      // Generated road atlases become frozen ordinary images. Their recipes
      // must never regenerate historical art from today's source PNGs.
      const { generated: _generated, ...frozen } = tileset;
      const base = `restored-${await contentHash(encoder.encode(JSON.stringify(frozen)))}`;
      let id = base;
      for (let n = 2; occupied.has(id); n++) id = `${base}-${n}`;
      occupied.add(id);
      tilesets.push({ ...frozen, id });
      ids.set(tileset.id, id);
      images.push({ tilesetId: id, bytes, bitmap: await decode(bytes) });
    }
    const level = JSON.parse(levelText) as { palette: { tilesetId: string }[] };
    for (const entry of level.palette) entry.tilesetId = ids.get(entry.tilesetId) ?? entry.tilesetId;
    return { document: parseLevel(JSON.stringify(level), tilesets, current.entityTypes, { randomSets: current.randomSets, collections: current.collections }), images };
  } catch (error) {
    for (const image of images) image.bitmap.close();
    throw error;
  }
}
