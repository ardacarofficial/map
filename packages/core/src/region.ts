/**
 * Layer content helpers for the selection tools: content bounds, "select
 * this layer's cells", and moving a selected rectangle as one undo step.
 * Plus `tilesetUsage` for the "remove tileset?" confirmation.
 */
import { cellPaletteIndex, EMPTY_CELL } from "./cell";
import { CHUNK_MASK, CHUNK_SHIFT } from "./chunk";
import { selectionContains, type SelectionRect } from "./selectionMask";
import type { MapDocument } from "./document";
import { entityCell } from "./entity";
import type { CellRect } from "./geometry";
import { isEntityLayer, isGridLayer, isTileLayer, type TileLayer } from "./layer";
import type { CellWrite, GridWrite } from "./ops";
import type { MapStore } from "./store";
import type { Stamp } from "./stamp";

/** Tile size (in pixels) used to turn entity positions into cells; `MapInfo` satisfies it. */
export interface TileSize {
  readonly tileWidth: number;
  readonly tileHeight: number;
}

/** Calls `visit` for every non-empty cell of a tile / grid layer (chunk order). */
function forEachCell(layer: TileLayer, visit: (x: number, y: number) => void): void {
  for (const chunk of layer.chunks()) {
    const x0 = chunk.cx << CHUNK_SHIFT;
    const y0 = chunk.cy << CHUNK_SHIFT;
    const data = chunk.data;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== EMPTY_CELL) visit(x0 + (i & CHUNK_MASK), y0 + (i >> CHUNK_SHIFT));
    }
  }
}

/** Cells holding content: non-empty cells, or (entity layers, with `tileSize`) each entity's top-left cell. */
function forEachContentCell(layer: TileLayer, tileSize: TileSize | undefined, visit: (x: number, y: number) => void): void {
  if (isEntityLayer(layer)) {
    if (!tileSize) return;
    for (const e of layer.entities) {
      const { x, y } = entityCell(e, tileSize);
      visit(x, y);
    }
    return;
  }
  forEachCell(layer, visit);
}

/**
 * Smallest cell rectangle holding every non-empty cell of `layer`, or
 * `null` when it is empty. Entity layers: the cells under the entities'
 * top-left corners when `tileSize` is given (pass `document.map`), else `null`.
 */
export function layerContentBounds(layer: TileLayer, tileSize?: TileSize): CellRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  forEachContentCell(layer, tileSize, (x, y) => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  });
  if (x1 < x0) return null;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** The cells of a layer as a selection region: bounding rectangle plus a per-cell mask. */
export interface CellRegion {
  readonly rect: CellRect;
  /** `rect.width × rect.height`, row-major: `mask[(y - rect.y) * rect.width + (x - rect.x)]` is 1 for a cell with content. */
  readonly mask: Uint8Array;
  /** Number of cells set in `mask`. */
  readonly count: number;
}

/**
 * The non-empty cells of `layer` as a {@link CellRegion} ("select what this
 * layer holds"), or `null` when it is empty. Entity layers as in
 * {@link layerContentBounds}.
 */
export function layerCellsAsRegion(layer: TileLayer, tileSize?: TileSize): CellRegion | null {
  const rect = layerContentBounds(layer, tileSize);
  if (!rect) return null;
  const mask = new Uint8Array(rect.width * rect.height);
  let count = 0;
  forEachContentCell(layer, tileSize, (x, y) => {
    const i = (y - rect.y) * rect.width + (x - rect.x);
    if (mask[i] === 0) count++;
    mask[i] = 1;
  });
  return { rect, mask, count };
}

/**
 * Rectangle for "select all content" of layer `layerId`: its content
 * bounds clipped to the map, or `null` when it holds nothing.
 *
 * @throws Error on an unknown layer.
 */
export function selectAllContent(doc: MapDocument, layerId: string): CellRect | null {
  const layer = doc.getLayer(layerId);
  if (!layer) throw new Error(`selectAllContent: unknown layer "${layerId}"`);
  const rect = layerContentBounds(layer, doc.map);
  if (!rect) return null;
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(doc.map.width, rect.x + rect.width);
  const y1 = Math.min(doc.map.height, rect.y + rect.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Result of {@link moveRegion}. */
export interface MoveRegionResult {
  /** `rect` moved by (`dx`, `dy`); not clipped to the map (content that left the map is gone). */
  readonly rect: SelectionRect;
}

export function moveRegion(store: MapStore, layerIds: readonly string[], rect: SelectionRect, dx: number, dy: number): MoveRegionResult {
  const ok =
    [rect.x, rect.y, rect.width, rect.height, dx, dy].every(Number.isInteger) && rect.width >= 1 && rect.height >= 1;
  if (!ok) throw new RangeError("moveRegion: rect must have integer position and positive integer size; offsets must be integers");
  const doc = store.document;
  const moved: SelectionRect = { ...rect, x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
  const ids: string[] = [];
  const add = (id: string): void => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const id of layerIds) {
    const layer = doc.getLayer(id);
    if (!layer) throw new Error(`moveRegion: unknown layer "${id}"`);
    add(id);
  }
  if (dx === 0 && dy === 0) return { rect: moved };

  const { width, height, tileWidth, tileHeight } = doc.map;
  const inside = (x: number, y: number) => selectionContains(rect, x, y);
  const nested = store.inTransaction;
  store.beginTransaction();
  try {
    for (const id of ids) {
      const layer = doc.getLayer(id)!;
      if (layer.locked) continue;
      if (isEntityLayer(layer)) {
        for (const entity of [...layer.entities]) {
          const cell = entityCell(entity, doc.map);
          if (!inside(cell.x, cell.y)) continue;
          const x = entity.x + dx * tileWidth;
          const y = entity.y + dy * tileHeight;
          const nx = Math.floor(x / tileWidth);
          const ny = Math.floor(y / tileHeight);
          if (x < 0 || y < 0 || nx >= width || ny >= height) store.dispatch({ type: "removeEntity", entityId: entity.id });
          else store.dispatch({ type: "moveEntity", entityId: entity.id, x, y });
        }
        continue;
      }
      // Clear the source first, then write the block: within one op the last write of a cell wins.
      const block: { x: number; y: number; v: number }[] = [];
      const clears: { x: number; y: number }[] = [];
      for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.height); y++) {
        for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.width); x++) {
          if (!selectionContains(rect, x, y)) continue;
          const v = layer.getCell(x, y);
          if (v === EMPTY_CELL) continue;
          clears.push({ x, y });
          block.push({ x: x + dx, y: y + dy, v });
        }
      }
      if (clears.length === 0) continue;
      if (isGridLayer(layer)) {
        const cells: GridWrite[] = [...clears.map((c) => ({ ...c, value: 0 })), ...block.map((b) => ({ x: b.x, y: b.y, value: b.v }))];
        store.dispatch({ type: "paintGrid", layerId: id, cells });
      } else {
        const cells: CellWrite[] = [...clears.map((c) => ({ ...c, cell: EMPTY_CELL })), ...block.map((b) => ({ x: b.x, y: b.y, cell: b.v }))];
        store.dispatch({ type: "paintCells", layerId: id, cells });
      }
    }
  } catch (error) {
    // Only a transaction of our own may be rolled back (rollback closes every level).
    if (nested) store.commit();
    else store.rollback();
    throw error;
  }
  store.commit();
  return { rect: moved };
}

/** What removing a tileset would clear (see `removeTileset`). */
export interface TilesetUsage {
  /** Tile-layer cells that show a tile of the tileset. */
  readonly cells: number;

  readonly layers: string[];
}

export function tilesetUsage(doc: MapDocument, tilesetId: string): TilesetUsage {
  const indices = new Set<number>();
  doc.palette.entries().forEach((entry, i) => {
    if (entry.tilesetId === tilesetId) indices.add(i + 1);
  });
  let cells = 0;
  const layers: string[] = [];
  for (const layer of doc.layers) {
    let n = 0;
    if (isTileLayer(layer) && indices.size > 0) {
      for (const chunk of layer.chunks()) for (const cell of chunk.data) if (cell !== EMPTY_CELL && indices.has(cellPaletteIndex(cell))) n++;
      cells += n;
    }
    if (n > 0) layers.push(layer.id);
  }
  return { cells, layers };
}

/** Stamp references to a tileset. Counts actual tile cells separately from smart bake/profile dependencies. */
export interface StampTilesetUsage {
  readonly cells: number;
  /** Source tile layers with at least one matching cell, in stamp order; raw grids never count. */
  readonly layers: readonly string[];
  /** nineSlice layers whose generated bank uses the tileset (even if their source cells do not). */
  readonly bakedLayers: readonly string[];
  readonly road: boolean;
}

/**
 * Pure counterpart to tilesetUsage for library stamps. Ignores unused palette entries and all grid values,
 * preserves flip bits when identifying palette indices, and reports baked/profile references separately.
 * For removal confirmation sum tilesetUsage over levels and this helper over stamps; a bank reference is
 * a usage even when cells is zero. No stamp or document is mutated.
 */
export function stampTilesetUsage(stamp: Stamp, tilesetId: string): StampTilesetUsage {
  const indices = new Set<number>();
  stamp.palette.forEach((entry, i) => { if (entry.tilesetId === tilesetId) indices.add(i + 1); });
  let cells = 0;
  const layers: string[] = [];
  for (const layer of stamp.layers) {
    if (layer.grid) continue;
    let count = 0;
    for (const cell of layer.cells) if (cell !== EMPTY_CELL && indices.has(cellPaletteIndex(cell))) count++;
    if (count) { cells += count; layers.push(layer.layerId); }
  }
  return { cells, layers, bakedLayers: (stamp.nineSlice?.tileLayers ?? []).filter(l => l.tilesetId === tilesetId).map(l => l.layerId), road: stamp.nineSlice?.road?.tilesetId === tilesetId };
}
