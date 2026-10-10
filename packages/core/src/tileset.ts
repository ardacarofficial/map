/**
 * Tileset metadata. Core never loads images; it only knows the grid layout.
 *
 * A tile id is the tile's position in the tileset grid, row-major:
 * `tileId = row * columns + col`. Tiles are only ever appended, so existing
 * ids stay stable (same rule as Tiled and Godot).
 *
 * Since v0.3 a tileset also carries per-tile metadata that lives in the
 * project file: which tiles are solid (collision is derived from it) and the
 * terrains (autotile blocks) defined on it. Both are optional; a missing
 * field means "none". Change them with the `setTileSolid` / `defineTerrain` /
 * `removeTerrain` ops (undoable).
 */
import { normalizeTerrain, terrainProblem, type Terrain } from "./terrain";
import { normalizeTerrainSet, terrainSetsProblem, type TerrainSet } from "./terrainSet";

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
  /** Tile ids marked solid ("katı"), ascending, no duplicates. Missing = none. */
  readonly solidTiles?: readonly number[];
  /**
   * @deprecated Legacy (v0.3 grid-layer) terrains, sorted by id. Read from old
   * files and converted to {@link terrainSets} on load; no longer written.
   * Kept only so the old terrain API compiles until the editor migrates.
   */
  readonly terrains?: readonly Terrain[];
  /**
   * Terrain sets: terrain tags on this tileset's tiles (see `terrainSet.ts`),
   * in display order. Missing = none.
   */
  readonly terrainSets?: readonly TerrainSet[];
}

/** True when `tileId` is marked solid in `tileset`. */
export function isTileSolid(tileset: Tileset, tileId: number): boolean {
  const solid = tileset.solidTiles;
  if (!solid || solid.length === 0) return false;
  // Binary search: the list is kept sorted.
  let lo = 0;
  let hi = solid.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = solid[mid]!;
    if (v === tileId) return true;
    if (v < tileId) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/**
 * Frozen copy with canonical metadata: `solidTiles` sorted and de-duplicated,
 * terrains sorted by id and normalized; empty lists are omitted, so a tileset
 * without metadata looks exactly as before v0.3.
 */
export function normalizeTileset(tileset: Tileset): Tileset {
  const base: Tileset = {
    id: tileset.id,
    name: tileset.name,
    ...(tileset.group !== undefined && tileset.group !== "" ? { group: tileset.group } : {}),
    imagePath: tileset.imagePath,
    tileWidth: tileset.tileWidth,
    tileHeight: tileset.tileHeight,
    columns: tileset.columns,
    rows: tileset.rows,
    margin: tileset.margin,
    spacing: tileset.spacing,
  };
  const solid = [...new Set(tileset.solidTiles ?? [])].sort((a, b) => a - b);
  const terrains = (tileset.terrains ?? []).map(normalizeTerrain).sort((a, b) => a.id - b.id);
  const terrainSets = (tileset.terrainSets ?? []).map((s) => (Object.isFrozen(s) ? s : normalizeTerrainSet(s)));
  return Object.freeze({
    ...base,
    ...(solid.length > 0 ? { solidTiles: Object.freeze(solid) } : {}),
    ...(terrains.length > 0 ? { terrains: Object.freeze(terrains) } : {}),
    ...(terrainSets.length > 0 ? { terrainSets: Object.freeze(terrainSets) } : {}),
  });
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
  if (tileset.solidTiles !== undefined) {
    if (!Array.isArray(tileset.solidTiles)) return "solidTiles must be an array";
    const seen = new Set<number>();
    for (const id of tileset.solidTiles) {
      if (!isValidTileId(tileset, id)) return `solid tile id ${String(id)} is outside the tileset`;
      if (seen.has(id)) return `duplicate solid tile id ${id}`;
      seen.add(id);
    }
  }
  if (tileset.terrains !== undefined) {
    if (!Array.isArray(tileset.terrains)) return "terrains must be an array";
    const ids = new Set<number>();
    for (const terrain of tileset.terrains) {
      const problem = terrainProblem(tileset, terrain);
      if (problem) return problem;
      if (ids.has(terrain.id)) return `duplicate terrain id ${terrain.id}`;
      ids.add(terrain.id);
    }
  }
  if (tileset.terrainSets !== undefined) {
    const problem = terrainSetsProblem(tileset, tileset.terrainSets);
    if (problem) return problem;
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
