import { builtinEntityType, BUILTIN_ENTITY_TYPES, entityTypesProblem, normalizeEntityType, SPAWN_TYPE_ID, type Entity, type EntityType } from "./entity";
import { isEntityLayer, isGridLayer, type EntityLayer, type GridLayer, type TileLayer } from "./layer";
import { collectionsProblem, normalizeCollection, type Collection } from "./collection";
import { Palette } from "./palette";
import { normalizeRandomSet, randomSetsProblem, type RandomSet } from "./randomSet";
import { normalizeTileset, type Tileset } from "./tileset";

/** Editor project/level/stamp/clip format. Legacy conversion is raw JSON and preserves stored tile cells. */
export const DOCUMENT_FORMAT_VERSION = 6;
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
  /** Saved random sets of the project (round 4). */
  randomSets?: readonly RandomSet[];
  /** Collections (palettes) of the project (round 4). */
  collections?: readonly Collection[];
  /** Level background colour `#rrggbb` (round 4); default none. */
  background?: string | null;
  /** Level display name kept in the level file (round 4); default `""`. */
  name?: string;
}

/** Level properties changed by `setMapProps` (round 4). */
export interface MapProps {
  /** Canvas / export background `#rrggbb` (lowercase), or `null` = none (theme colour / project default). */
  readonly background: string | null;
  /**
   * Display name stored in the level file, `""` when unset. The project
   * file's level list stays authoritative for the level name in the UI;
   * this is for documents outside the level list (e.g. a stamp being edited).
   */
  readonly name: string;
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
  #randomSets: readonly RandomSet[] = Object.freeze([]);
  #collections: readonly Collection[] = Object.freeze([]);
  #props: MapProps = Object.freeze({ background: null, name: "" });
  readonly #seed: number;
  #migrations: readonly string[] = Object.freeze([]);

  constructor(map: MapInfo, seed = 0) {
    const problem = mapInfoProblem(map);
    if (problem) throw new RangeError(`Invalid map: ${problem}`);
    if (!isValidSeed(seed)) throw new RangeError(`Invalid seed: must be an integer in [0, 2^32), got ${String(seed)}`);
    this.#map = Object.freeze({ ...map });
    this.#seed = seed;
  }

  /**
   * Seed for coordinate variant selection: a cell with several candidate tiles
   * shows `candidates[hash(seed, x, y) % n]`. Saved with the level.
   */
  get seed(): number {
    return this.#seed;
  }

  get migrations(): readonly string[] {
    return this.#migrations;
  }

  /** @internal Set by the parser. */
  _setMigrations(notes: readonly string[]): void {
    this.#migrations = Object.freeze([...notes]);
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

  /** Saved random sets (project-level data, like `entityTypes`), in project order. */
  get randomSets(): readonly RandomSet[] {
    return this.#randomSets;
  }

  /** Random set by id, or `undefined`. */
  getRandomSet(id: string): RandomSet | undefined {
    return this.#randomSets.find((s) => s.id === id);
  }

  /** Collections / palettes (project-level data, like `entityTypes`), in project order. */
  get collections(): readonly Collection[] {
    return this.#collections;
  }

  /** Collection by id, or `undefined`. */
  getCollection(id: string): Collection | undefined {
    return this.#collections.find((c) => c.id === id);
  }

  /** Level properties (background, name). Replaced (never mutated) by `setMapProps`. */
  get props(): MapProps {
    return this.#props;
  }

  /** Level background `#rrggbb`, or `null`. Shorthand for `props.background`. */
  get background(): string | null {
    return this.#props.background;
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
  }

  /** @internal Replaces the tileset with the same id (validated by the caller). */
  _replaceTileset(tileset: Tileset): void {
    const index = this.#tilesets.findIndex((t) => t.id === tileset.id);
    if (index < 0) throw new Error(`no tileset "${tileset.id}"`);
    this.#tilesets[index] = normalizeTileset(tileset);
  }

  /** @internal Replaces the whole tileset list (order = display order; validated by the caller). */
  _setTilesets(tilesets: readonly Tileset[]): void {
    this.#tilesets.length = 0;
    for (const tileset of tilesets) this.#tilesets.push(Object.isFrozen(tileset) ? tileset : normalizeTileset(tileset));
  }

  /** @internal Replaces the user-defined entity types (validated by the caller). */
  _setEntityTypes(types: readonly EntityType[]): void {
    this.#entityTypes = Object.freeze(types.map((t) => (Object.isFrozen(t) ? t : normalizeEntityType(t))));
  }

  /** @internal Replaces the random sets (validated by the caller). */
  _setRandomSets(sets: readonly RandomSet[]): void {
    this.#randomSets = Object.freeze(sets.map((s) => (Object.isFrozen(s) ? s : normalizeRandomSet(s))));
  }

  /** @internal Replaces the collections (validated by the caller). */
  _setCollections(collections: readonly Collection[]): void {
    this.#collections = Object.freeze(collections.map((c) => (Object.isFrozen(c) ? c : normalizeCollection(c))));
  }

  /** @internal Replaces the level properties (validated by the caller). */
  _setProps(props: MapProps): void {
    this.#props = Object.isFrozen(props) ? props : Object.freeze({ background: props.background, name: props.name });
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
  if (options.randomSets) {
    const problem = randomSetsProblem(options.randomSets);
    if (problem) throw new Error(`createDocument: ${problem}`);
    doc._setRandomSets(options.randomSets.map(normalizeRandomSet));
  }
  if (options.collections) {
    const problem = collectionsProblem(options.collections);
    if (problem) throw new Error(`createDocument: ${problem}`);
    doc._setCollections(options.collections.map(normalizeCollection));
  }
  if (options.background != null || options.name) {
    const props = mapPropsFrom(options.background ?? null, options.name ?? "");
    doc._setProps(props);
  }
  return doc;
}

/**
 * `base` when no layer of `doc` (and nothing in `taken`) uses it, otherwise
 * the first free "base 2", "base 3", ... Layer names are unique within a
 * level so exports (which name objects after layers) never clash.
 */
export function uniqueLayerName(doc: MapDocument, base: string, taken: Iterable<string> = []): string {
  const names = new Set(doc.layers.map((l) => l.name));
  for (const name of taken) names.add(name);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!names.has(name)) return name;
  }
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

/**
 * Validated, frozen level properties.
 * @throws RangeError on a background that is not `#rrggbb` / `null`, or a non-string name.
 */
export function mapPropsFrom(background: string | null, name: string): MapProps {
  if (background !== null && !(typeof background === "string" && /^#[0-9a-fA-F]{6}$/.test(background))) {
    throw new RangeError(`background must be "#rrggbb" or null, got ${JSON.stringify(background)}`);
  }
  if (typeof name !== "string") throw new RangeError("name must be a string");
  return Object.freeze({ background: background === null ? null : background.toLowerCase(), name });
}
