/** Turning a dropped PNG file into core tileset metadata (pure helpers). */
import { DEFAULT_TILE_SIZE, gridCount, type TileGridSpec, type Tileset } from "@smap/core";

const TURKISH: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", İ: "i" };

/** File name without extension: "Grass Tiles.png" → "Grass Tiles". */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** "Çimen Kenarı 32.png" → "cimen-kenari-32" (safe as an id and a file name). */
export function slugify(fileName: string): string {
  const slug = baseName(fileName)
    .replace(/[çğıöşüİ]/gi, (c) => TURKISH[c] ?? TURKISH[c.toLowerCase()] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "tileset";
}

/** `base`, or `base-2`, `base-3`, ... — whichever is not in `taken`. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

const COMMON_TILE_SIZES = [8, 16, 24, 32, 48, 64, 128];

/**
 * Tile size for a tileset dropped on the welcome screen (no project yet):
 * 1. a trailing number in the file name that divides the image ("dungeon-16.png" → 16),
 * 2. otherwise 32, or 16 if the image divides by 16 but not by 32.
 */
export function inferTileSize(width: number, height: number, fileName = ""): number {
  const divides = (n: number) => width % n === 0 && height % n === 0 && width >= n && height >= n;
  const hint = /(?:^|[^0-9])([0-9]{1,3})(?:px)?$/i.exec(baseName(fileName))?.[1];
  const hinted = hint ? Number(hint) : NaN;
  if (COMMON_TILE_SIZES.includes(hinted) && divides(hinted)) return hinted;
  if (divides(DEFAULT_TILE_SIZE)) return DEFAULT_TILE_SIZE;
  if (divides(16)) return 16;
  return DEFAULT_TILE_SIZE;
}

/** True for "image/png" files or a ".png" name (some drags carry no MIME type). */
export function looksLikePng(file: { name: string; type: string }): boolean {
  return file.type === "image/png" || (file.type === "" && /\.png$/i.test(file.name));
}

/** True when the bytes start with the PNG signature. */
export function hasPngSignature(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => bytes[i] === b);
}

export interface TilesetPlan {
  tileset: Tileset;
  /** True when the image size is not a whole number of tiles (edge pixels unused). */
  uneven: boolean;
}

/**
 * Tileset metadata for an image. Returns `null` when not even one tile fits.
 * The id is a unique slug of the file name; the image goes to `tilesets/<id>.png`.
 */
export function planTileset(
  fileName: string,
  imageWidth: number,
  imageHeight: number,
  tileSize: number,
  takenIds: ReadonlySet<string>,
): TilesetPlan | null {
  const columns = gridCount(imageWidth, tileSize);
  const rows = gridCount(imageHeight, tileSize);
  if (columns < 1 || rows < 1) return null;
  const id = uniqueId(slugify(fileName), takenIds);
  return {
    tileset: {
      id,
      name: baseName(fileName),
      imagePath: `tilesets/${id}.png`,
      tileWidth: tileSize,
      tileHeight: tileSize,
      columns,
      rows,
      margin: 0,
      spacing: 0,
    },
    uneven: imageWidth % tileSize !== 0 || imageHeight % tileSize !== 0,
  };
}

/**
 * Tileset metadata for an image sliced with `spec` (tile size, margin,
 * spacing). Returns `null` when not even one tile fits. Leftover pixels on
 * the right / bottom are allowed (the import card shows them).
 */
export function planTilesetGrid(
  name: string,
  fileName: string,
  imageWidth: number,
  imageHeight: number,
  spec: TileGridSpec,
  takenIds: ReadonlySet<string>,
): Tileset | null {
  const columns = gridCount(imageWidth, spec.tileWidth, spec.margin, spec.spacing);
  const rows = gridCount(imageHeight, spec.tileHeight, spec.margin, spec.spacing);
  if (columns < 1 || rows < 1) return null;
  const id = uniqueId(slugify(fileName), takenIds);
  return {
    id,
    name: name.trim() || baseName(fileName),
    imagePath: `tilesets/${id}.png`,
    tileWidth: spec.tileWidth,
    tileHeight: spec.tileHeight,
    columns,
    rows,
    margin: spec.margin,
    spacing: spec.spacing,
  };
}
