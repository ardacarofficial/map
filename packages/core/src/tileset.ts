import { normalizeRoadProfile, roadProfileProblem, type RoadProfile } from "./smartStamp/roadProfile";
/**
 * Tileset metadata. Core never loads images; it only knows the grid layout.
 *
 * A tile id is the tile's position in the tileset grid, row-major:
 * `tileId = row * columns + col`. Tiles are only ever appended, so existing
 * ids stay stable (same rule as Tiled and Godot).
 *
 * Format 3 optionally records generated PNG provenance and source image hashes.
 * User PNGs remain read-only; explicit regeneration updates a separate generated
 * image at its existing id/path and preserves the append-only slot layout.
 */
import { CELL_FLAG_MASK } from "./cell";
import type { NineSliceInnerCorner } from "./nineSlice";

/** Content identity of an input PNG at the last successful bake. Hash actual PNG bytes (e.g. SHA-256), not file paths or mtimes. */
export interface GeneratedTilesetSource {
  readonly tilesetId: string;
  readonly imageHash: string;
}

/**
 * Provenance of a separate generated PNG. Missing metadata means an ordinary user asset, including migrated v1/v2 assets.
 * UI groups these under Üretilen by this marker, not by an editable display group/name. PNG regeneration retains the
 * generated tileset id/path and the immutable layout-1 slot prefix; source dimension changes require a new asset id.
 */
export interface GeneratedTilesetMetadata {
  readonly kind: "nineSlice";
  readonly stampId: string;
  readonly layerId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly layoutVersion: 1;
  /** Authored inner art must survive reopen, so PNG regeneration can repeat the same quarter recipe. */
  readonly innerCorner?: NineSliceInnerCorner;
  /** Unique source ids, sorted by code-unit order; includes an optional authored inner-corner PNG. */
  readonly sources: readonly GeneratedTilesetSource[];
}

/** Validates persisted generated-asset provenance without loading images or the stamp library. */
export function generatedTilesetMetadataProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") return "generated metadata must be an object";
  const g = value as Record<string, unknown>;
  if (g["kind"] !== "nineSlice" || g["layoutVersion"] !== 1) return "unsupported generated kind or layout version";
  for (const key of ["stampId", "layerId"]) if (typeof g[key] !== "string" || !g[key]) return `generated ${key} must be nonempty`;
  for (const key of ["sourceWidth", "sourceHeight"]) if (typeof g[key] !== "number" || !Number.isSafeInteger(g[key]) || (g[key] as number) < 3) return `generated ${key} must be an integer >= 3`;
  if (!Array.isArray(g["sources"])) return "generated sources must be an array";
  const ids = new Set<string>();
  for (const entry of g["sources"]) {
    if (!entry || typeof entry !== "object" || typeof entry.tilesetId !== "string" || !entry.tilesetId || typeof entry.imageHash !== "string" || !entry.imageHash || ids.has(entry.tilesetId)) return "generated sources require unique tileset ids and nonempty image hashes";
    ids.add(entry.tilesetId);
  }
  if (g["innerCorner"] !== undefined) {
    const inner = g["innerCorner"] as Partial<NineSliceInnerCorner> | null;
    if (!inner || typeof inner !== "object" || !inner.tile || typeof inner.tile.tilesetId !== "string" || !ids.has(inner.tile.tilesetId) || !Number.isInteger(inner.tile.tileId) || inner.tile.tileId < 0) return "generated innerCorner requires a source tile reference";
    const flags = inner.flags === undefined ? 0 : inner.flags;
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xffff_ffff || ((flags & CELL_FLAG_MASK) >>> 0) !== flags) return "generated innerCorner flags must be unsigned H/V/D bits";
  }
  return null;
}

/** Deeply frozen provenance, with fixed key order and sources sorted independently of discovery order. */
export function normalizeGeneratedTilesetMetadata(value: GeneratedTilesetMetadata): GeneratedTilesetMetadata {
  const problem = generatedTilesetMetadataProblem(value);
  if (problem) throw new Error(problem);
  return Object.freeze({ kind: "nineSlice", stampId: value.stampId, layerId: value.layerId, sourceWidth: value.sourceWidth, sourceHeight: value.sourceHeight, layoutVersion: 1, ...(value.innerCorner ? { innerCorner: Object.freeze({ tile: Object.freeze({ tilesetId: value.innerCorner.tile.tilesetId, tileId: value.innerCorner.tile.tileId }), ...(value.innerCorner.flags ? { flags: value.innerCorner.flags } : {}) }) } : {}), sources: Object.freeze([...value.sources].sort((a, b) => a.tilesetId < b.tilesetId ? -1 : a.tilesetId > b.tilesetId ? 1 : 0).map(s => Object.freeze({ tilesetId: s.tilesetId, imageHash: s.imageHash }))) });
}

/** False for user assets; true when a generated asset has a changed or missing input PNG hash. Does not mutate freshness. */
export function generatedTilesetStale(tileset: Tileset, imageHashes: ReadonlyMap<string, string>): boolean {
  return tileset.generated?.sources.some(s => imageHashes.get(s.tilesetId) !== s.imageHash) ?? false;
}

export interface Tileset {
  /** Stable, unique id within the project. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /**
   * Library group the tileset is shown under (e.g. `"Zindan"`). Missing =
   * ungrouped. Display only; written to the project file only when set.
   * Change it with the `setTilesetMeta` op.
   */
  readonly group?: string;
  /** Generated PNG provenance. Omitted = user-owned PNG; never overwrite a user asset to bake or regenerate. */
  readonly generated?: GeneratedTilesetMetadata;
  /** Smart-owned complete road family, including archived custom variants. */
  readonly roadProfile?: RoadProfile;
  /** Image path relative to the project folder, `/`-separated, e.g. `"tilesets/grass.png"`. */
  readonly imagePath: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly columns: number;
  readonly rows: number;
  /** Pixels around the outer edge of the image. */
  readonly margin: number;
  /** Pixels between adjacent tiles. */
  readonly spacing: number;

}

export function normalizeTileset(tileset: Tileset): Tileset {
  const base: Tileset = {
    id: tileset.id,
    name: tileset.name,
    ...(tileset.group !== undefined && tileset.group !== "" ? { group: tileset.group } : {}),
    ...(tileset.generated !== undefined ? { generated: normalizeGeneratedTilesetMetadata(tileset.generated) } : {}),
    ...(tileset.roadProfile ? { roadProfile: normalizeRoadProfile(tileset.roadProfile) } : {}),
    imagePath: tileset.imagePath,
    tileWidth: tileset.tileWidth,
    tileHeight: tileset.tileHeight,
    columns: tileset.columns,
    rows: tileset.rows,
    margin: tileset.margin,
    spacing: tileset.spacing,
  };

  return Object.freeze(base);
}

/** Pixel rectangle of a tile inside its tileset image. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Number of tiles in the tileset. */
export function tileCount(tileset: Tileset): number {
  return tileset.columns * tileset.rows;
}

/** Tile id at grid position (`col`, `row`). */
export function tileIdAt(tileset: Tileset, col: number, row: number): number {
  return row * tileset.columns + col;
}

/** Grid position of a tile id. */
export function tilePosition(tileset: Tileset, tileId: number): { col: number; row: number } {
  return { col: tileId % tileset.columns, row: Math.floor(tileId / tileset.columns) };
}

/** True when `tileId` is an integer addressing a tile of `tileset`. */
export function isValidTileId(tileset: Tileset, tileId: number): boolean {
  return Number.isInteger(tileId) && tileId >= 0 && tileId < tileCount(tileset);
}

/** Pixel rectangle of `tileId` in the tileset image (respects margin and spacing). */
export function tileRect(tileset: Tileset, tileId: number): TileRect {
  const { col, row } = tilePosition(tileset, tileId);
  return {
    x: tileset.margin + col * (tileset.tileWidth + tileset.spacing),
    y: tileset.margin + row * (tileset.tileHeight + tileset.spacing),
    width: tileset.tileWidth,
    height: tileset.tileHeight,
  };
}

/**
 * How many whole tiles fit along one image axis.
 * Used when a PNG is dropped: `columns = gridCount(imageWidth, tileWidth, margin, spacing)`.
 */
export function gridCount(imageSize: number, tileSize: number, margin = 0, spacing = 0): number {
  const usable = imageSize - 2 * margin + spacing;
  if (tileSize <= 0 || usable <= 0) return 0;
  return Math.floor(usable / (tileSize + spacing));
}

/**
 * Returns a description of what is wrong with `tileset`, or `null` when valid.
 * Checks integer sizes, a non-empty grid and a safe relative `imagePath`.
 */
export function tilesetProblem(tileset: Tileset): string | null {
  if (typeof tileset.id !== "string" || tileset.id.length === 0) return "id must be a non-empty string";
  if (typeof tileset.name !== "string") return "name must be a string";
  if (tileset.group !== undefined && typeof tileset.group !== "string") return "group must be a string";
  const pathProblem = relativePathProblem(tileset.imagePath);
  if (pathProblem) return `imagePath ${pathProblem}`;
  for (const key of ["tileWidth", "tileHeight", "columns", "rows"] as const) {
    const v = tileset[key];
    if (!Number.isInteger(v) || v < 1) return `${key} must be a positive integer, got ${String(v)}`;
  }
  for (const key of ["margin", "spacing"] as const) {
    const v = tileset[key];
    if (!Number.isInteger(v) || v < 0) return `${key} must be a non-negative integer, got ${String(v)}`;
  }
  if (tileset.generated !== undefined) {
    const problem = generatedTilesetMetadataProblem(tileset.generated);
    if (problem) return problem;
    if (!/^tilesets\/.+\.png$/i.test(tileset.imagePath)) return "generated imagePath must be a separate PNG under tilesets/";
    if (tileset.generated.sources.some(s => s.tilesetId === tileset.id)) return "generated asset cannot be its own source";
    const { sourceWidth: w, sourceHeight: h } = tileset.generated;
    if (!Number.isSafeInteger(w * h + w + h + 48) || tileset.columns * tileset.rows < w * h + w + h + 48) return "generated grid is smaller than its fixed slot layout";
  }
  if (tileset.roadProfile) {
    const problem = roadProfileProblem(tileset.roadProfile);
    if (problem) return problem;
    if (tileset.roadProfile.tiles.some(t => !isValidTileId(tileset, t.tileId))) return "road profile tile outside tileset";
  }
  return null;
}

/** Validates a project-relative path; returns a problem description or `null`. */
export function relativePathProblem(path: unknown): string | null {
  if (typeof path !== "string" || path.length === 0) return "must be a non-empty string";
  if (path.includes("\\")) return `must use "/" separators, got "${path}"`;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return `must be relative, got "${path}"`;
  if (path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    return `must not contain empty, "." or ".." segments, got "${path}"`;
  }
  return null;
}
