import type { TileLayer } from "./layer";
import { Palette } from "./palette";
import type { Tileset } from "./tileset";

/** The single file-format version number for project and level files. */
export const DOCUMENT_FORMAT_VERSION = 1;
/** Default tile size in pixels. */
export const DEFAULT_TILE_SIZE = 32;
/** Largest allowed map width/height in cells. */
export const MAX_MAP_SIZE = 65536;

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

  constructor(map: MapInfo) {
    const problem = mapInfoProblem(map);
    if (problem) throw new RangeError(`Invalid map: ${problem}`);
    this.#map = Object.freeze({ ...map });
  }

  /** Map dimensions. Replaced (never mutated) by a `resizeMap` op. */
  get map(): MapInfo {
    return this.#map;
  }

  /** Tilesets in project order. */
  get tilesets(): readonly Tileset[] {
    return this.#tilesets;
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
    this.#tilesets.push(Object.freeze({ ...tileset }));
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
  const doc = new MapDocument({
    width: options.width,
    height: options.height,
    tileWidth: options.tileWidth ?? DEFAULT_TILE_SIZE,
    tileHeight: options.tileHeight ?? DEFAULT_TILE_SIZE,
  });
  for (const tileset of options.tilesets ?? []) doc._addTileset(tileset);
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
