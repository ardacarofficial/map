/**
 * Tileset metadata. Core never loads images; it only knows the grid layout.
 *
 * A tile id is the tile's position in the tileset grid, row-major:
 * `tileId = row * columns + col`. Tiles are only ever appended, so existing
 * ids stay stable (same rule as Tiled and Godot).
 */

export interface Tileset {
  /** Stable, unique id within the project. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
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
