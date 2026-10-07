import { builtinEntityType, BUILTIN_ENTITY_TYPES, entityTypesProblem, normalizeEntityType, SPAWN_TYPE_ID, type Entity, type EntityType } from "./entity";
import { isEntityLayer, isGridLayer, type EntityLayer, type GridLayer, type TileLayer } from "./layer";
import { Palette } from "./palette";
import type { Terrain } from "./terrain";
import { normalizeTileset, type Tileset } from "./tileset";

/** The single file-format version number for project and level files. */
export const DOCUMENT_FORMAT_VERSION = 1;
/** Default tile size in pixels. */
export const DEFAULT_TILE_SIZE = 32;
/**
 * Largest allowed map width/height in cells (4096 → 16.7 M cells; at 32 px
 * tiles a 131 072 px side). CLAUDE.md targets ordinary 2D game maps split
 * into separate levels ("ayrı bölgeler", v1.0 multi-level), not one giant
 * open world, and whole-map operations (flood fill, resize, collision
 * derivation, TMJ / game export, minimap) allocate per cell: at the old
 * 65536 bound a single fill or export could need gigabytes. Larger worlds
 * are several levels on the world map.
 */
export const MAX_MAP_SIZE = 4096;

/** Map dimensions. Cells are addressed `0 ≤ x < width`, `0 ≤ y < height`, y pointing down. */
export interface MapInfo {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
}

export interface CreateDocumentOptions {
  width: number;
  height: number;
  /** Defaults to 32. */
  tileWidth?: number;
  /** Defaults to 32. */
  tileHeight?: number;
  /** Tilesets known to the project. */
  tilesets?: readonly Tileset[];
  /** Variant seed (see {@link MapDocument.seed}). Defaults to 0. */
  seed?: number;
  /** User-defined entity types of the project (v0.6). Built-in types are always present. */
  entityTypes?: readonly EntityType[];
}

/** True when `seed` is an integer in `[0, 2^32)`. */
export function isValidSeed(seed: unknown): seed is number {
  return typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff;
}

/**
 * One level: map bounds, palette, tilesets and layers (bottom to top).
 *
 * Treat it as read-only outside core; every change goes through `MapStore`.
 */
export class MapDocument {
  readonly documentFormatVersion = DOCUMENT_FORMAT_VERSION;
  #map: MapInfo;
  readonly palette = new Palette();
  readonly #tilesets: Tileset[] = [];
  readonly #layers: TileLayer[] = [];
  #entityTypes: readonly EntityType[] = Object.freeze([]);
  readonly #seed: number;
  /** terrain id → terrain (rebuilt lazily after tileset changes). */
  #terrains: Map<number, Terrain> | null = null;

  constructor(map: MapInfo, seed = 0) {
    const problem = mapInfoProblem(map);
    if (problem) throw new RangeError(`Invalid map: ${problem}`);
    if (!isValidSeed(seed)) throw new RangeError(`Invalid seed: must be an integer in [0, 2^32), got ${String(seed)}`);
    this.#map = Object.freeze({ ...map });
    this.#seed = seed;
  }

  /**
   * Seed for terrain variant selection: a cell with several candidate tiles
   * shows `candidates[hash(seed, x, y) % n]`. Saved with the level.
   */
  get seed(): number {
    return this.#seed;
  }

  /** Map dimensions. Replaced (never mutated) by a `resizeMap` op. */
  get map(): MapInfo {
    return this.#map;
  }

  /** Tilesets in project order. */
  get tilesets(): readonly Tileset[] {
    return this.#tilesets;
  }

  /**
   * User-defined entity types (project-level data, like `tilesets`), in
   * project order. Built-in types (`spawn`, `portal`) are not listed here;
   * see {@link allEntityTypes}.
   */
  get entityTypes(): readonly EntityType[] {
    return this.#entityTypes;
  }

  /** Built-in types followed by the user-defined ones (what a type picker shows). */
  allEntityTypes(): readonly EntityType[] {
    return [...BUILTIN_ENTITY_TYPES, ...this.#entityTypes];
  }

  /** Entity type by id (built-in or user-defined), or `undefined`. */
  getEntityType(id: string): EntityType | undefined {
    return builtinEntityType(id) ?? this.#entityTypes.find((t) => t.id === id);
  }

  /** Entity layers, bottom to top. */
  entityLayers(): EntityLayer[] {
    return this.#layers.filter(isEntityLayer);
  }

  /** Entity by id with the layer that holds it, or `undefined`. */
  findEntity(id: string): { layer: EntityLayer; entity: Entity; index: number } | undefined {
    for (const layer of this.#layers) {
      if (!isEntityLayer(layer)) continue;
      const index = layer.entities.findIndex((e) => e.id === id);
      if (index >= 0) return { layer, entity: layer.entities[index]!, index };
    }
    return undefined;
  }

  /**
   * The level's spawn point: the (only) entity of the built-in `spawn` type,
   * or `null`. The game starts the player there.
   */
  spawn(): Entity | null {
    for (const layer of this.#layers) {
      if (!isEntityLayer(layer)) continue;
      const found = layer.entities.find((e) => e.typeId === SPAWN_TYPE_ID);
      if (found) return found;
    }
    return null;
  }

  /** Layers from bottom to top. */
  get layers(): readonly TileLayer[] {
    return this.#layers;
  }

  getLayer(id: string): TileLayer | undefined {
    return this.#layers.find((layer) => layer.id === id);
  }

  getTileset(id: string): Tileset | undefined {
    return this.#tilesets.find((tileset) => tileset.id === id);
  }

  /** Grid layer by id (`undefined` when missing or not a grid layer). */
  getGridLayer(id: string): GridLayer | undefined {
    const layer = this.getLayer(id);
    return isGridLayer(layer) ? layer : undefined;
  }

  /** Terrain by id, searched in every tileset. */
  getTerrain(id: number): Terrain | undefined {
    return this.terrainMap().get(id);
  }

  /** All terrains of all tilesets, keyed by id. Do not mutate. */
  terrainMap(): ReadonlyMap<number, Terrain> {
    if (!this.#terrains) {
      const map = new Map<number, Terrain>();
      for (const tileset of this.#tilesets) for (const t of tileset.terrains ?? []) map.set(t.id, t);
      this.#terrains = map;
    }
    return this.#terrains;
  }

  /** True when (`x`, `y`) is an integer cell inside the map bounds. */
  inBounds(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.map.width &&
      y < this.map.height
    );
  }

  /** @internal */
  _addTileset(tileset: Tileset): void {
    this.#tilesets.push(normalizeTileset(tileset));
    this.#terrains = null;
  }

  /** @internal Replaces the tileset with the same id (validated by the caller). */
  _replaceTileset(tileset: Tileset): void {
    const index = this.#tilesets.findIndex((t) => t.id === tileset.id);
    if (index < 0) throw new Error(`no tileset "${tileset.id}"`);
    this.#tilesets[index] = normalizeTileset(tileset);
    this.#terrains = null;
  }

  /** @internal Replaces the user-defined entity types (validated by the caller). */
  _setEntityTypes(types: readonly EntityType[]): void {
    this.#entityTypes = Object.freeze(types.map((t) => (Object.isFrozen(t) ? t : normalizeEntityType(t))));
  }

  /** Position of layer `id` from the bottom, or `-1`. */
  indexOfLayer(id: string): number {
    return this.#layers.findIndex((layer) => layer.id === id);
  }

  /** @internal */
  _insertLayer(layer: TileLayer, index: number): void {
    this.#layers.splice(index, 0, layer);
  }

  /** @internal Removes the layer at `index` and returns it. */
  _removeLayerAt(index: number): TileLayer {
    const [layer] = this.#layers.splice(index, 1);
    if (!layer) throw new RangeError(`no layer at index ${index}`);
    return layer;
  }

  /** @internal Replaces the map dimensions (bounds checked by the caller). */
  _setMap(map: MapInfo): void {
    this.#map = Object.freeze({ ...map });
  }
}

/** Creates an empty document (no layers). */
export function createDocument(options: CreateDocumentOptions): MapDocument {
  const doc = new MapDocument(
    {
      width: options.width,
      height: options.height,
      tileWidth: options.tileWidth ?? DEFAULT_TILE_SIZE,
      tileHeight: options.tileHeight ?? DEFAULT_TILE_SIZE,
    },
    options.seed ?? 0,
  );
  for (const tileset of options.tilesets ?? []) doc._addTileset(tileset);
  if (options.entityTypes) {
    const problem = entityTypesProblem(options.entityTypes);
    if (problem) throw new Error(`createDocument: ${problem}`);
    doc._setEntityTypes(options.entityTypes);
  }
  return doc;
}

/** Returns a description of what is wrong with `map`, or `null`. */
export function mapInfoProblem(map: MapInfo): string | null {
  for (const key of ["width", "height"] as const) {
    const v = map[key];
    if (!Number.isInteger(v) || v < 1 || v > MAX_MAP_SIZE) {
      return `${key} must be an integer in [1, ${MAX_MAP_SIZE}], got ${String(v)}`;
    }
  }
  for (const key of ["tileWidth", "tileHeight"] as const) {
    const v = map[key];
    if (!Number.isInteger(v) || v < 1) return `${key} must be a positive integer, got ${String(v)}`;
  }
  return null;
}
