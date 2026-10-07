/**
 * Selection / clipboard data: copy a rectangle of one or more layers into a
 * self-contained {@link TileClip}, paste it back (into the same or another
 * document), cut, and flip. Clips serialize with `serializeClip` / `parseClip`.
 */
import {
  CELL_FLAG_MASK,
  EMPTY_CELL,
  FLIP_H,
  FLIP_V,
  cellFlags,
  cellPaletteIndex,
  makeCell,
  type Cell,
} from "./cell";
import type { MapDocument } from "./document";
import type { CellRect, CellPoint } from "./geometry";
import { isEntityLayer, isGridLayer, type GridRole } from "./layer";
import type { CellWrite, GridWrite, LayerPatch } from "./ops";
import type { PaletteEntry } from "./palette";
import type { MapStore } from "./store";
import { isValidTileId } from "./tileset";

/** One layer's cells inside a clip. */
export interface ClipLayer {
  /** Id of the layer it was copied from (the key for `pasteClip`'s layer mapping). */
  readonly layerId: string;
  /** Name of the source layer (informational). */
  readonly name: string;
  /**
   * `width × height` cells, row-major: cell (`x`, `y`) is `cells[y * width + x]`.
   * Palette indices refer to the clip's own `palette` (index `i` → `palette[i - 1]`);
   * flip flags are kept as-is. `0` is empty.
   * For a grid layer (`grid: true`) the values are raw grid values (terrain
   * ids / collision kinds) and do not use the palette.
   */
  readonly cells: Uint32Array;
  /** True when copied from a grid layer. Grid clip layers paste only into grid layers. */
  readonly grid?: boolean;
  /** Grid layers: role of the source layer (v0.6; used by `placeStamp` to match or create layers). */
  readonly role?: GridRole;
}

/**
 * A self-contained block of cells: it carries the tiles it references, so it
 * pastes correctly into a document whose palette differs.
 */
export interface TileClip {
  readonly width: number;
  readonly height: number;
  /** Clip-local palette: index `i` (1-based) → `palette[i - 1]`. Only entries the cells use. */
  readonly palette: readonly PaletteEntry[];
  /** Layers bottom to top, in the order they were copied. */
  readonly layers: readonly ClipLayer[];
}

/**
 * Where each clip layer goes when pasting: clip `layerId` → target layer id.
 * Clip layers without a mapping are skipped. `null` maps every clip layer to
 * the target layer with the same id (skipping ids the target does not have).
 */
export type LayerMapping = ReadonlyMap<string, string> | Readonly<Record<string, string>> | null;

export interface PasteOptions {
  /**
   * What empty clip cells do: `"skip"` (default) leaves the target cell
   * alone, `"erase"` clears it.
   */
  readonly emptyCells?: "skip" | "erase";
}

/**
 * Copies `rect` of the given layers. Cells outside the map read as empty.
 * Entity layers hold no cells and are left out of the clip.
 * The clip palette lists referenced tiles in first-use order (layers in the
 * given order, then row-major), so the same input always gives the same clip.
 *
 * @throws Error on an unknown layer id or an invalid rectangle.
 */
export function copyRegion(doc: MapDocument, layerIds: readonly string[], rect: CellRect): TileClip {
  assertRect(rect, "copyRegion");
  const remap = new Map<number, number>();
  const palette: PaletteEntry[] = [];
  const sources = layerIds.map((id) => {
    const layer = doc.getLayer(id);
    if (!layer) throw new Error(`copyRegion: unknown layer "${id}"`);
    return layer;
  });
  const layers = sources.filter((layer) => !isEntityLayer(layer)).map((layer): ClipLayer => {
    const cells = new Uint32Array(rect.width * rect.height);
    if (isGridLayer(layer)) {
      for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) cells[y * rect.width + x] = layer.getCell(rect.x + x, rect.y + y);
      }
      return Object.freeze({ layerId: layer.id, name: layer.name, grid: true, role: layer.role, cells });
    }
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const cell = layer.getCell(rect.x + x, rect.y + y);
        if (cell === EMPTY_CELL) continue;
        const index = cellPaletteIndex(cell);
        let local = remap.get(index);
        if (local === undefined) {
          const entry = doc.palette.get(index);
          if (!entry) throw new Error(`copyRegion: palette index ${index} does not exist`);
          palette.push(Object.freeze({ tilesetId: entry.tilesetId, tileId: entry.tileId }));
          local = palette.length;
          remap.set(index, local);
        }
        cells[y * rect.width + x] = makeCell(local, cellFlags(cell));
      }
    }
    return Object.freeze({ layerId: layer.id, name: layer.name, cells });
  });
  return Object.freeze({
    width: rect.width,
    height: rect.height,
    palette: Object.freeze(palette),
    layers: Object.freeze(layers),
  });
}

/**
 * Pastes `clip` with its top-left corner at (`x`, `y`) as one undo step
 * (nested into an open transaction if there is one). Everything is validated
 * before the first write. Palette indices are
 * remapped through `getOrAddPaletteIndex`; flip flags are preserved. Cells
 * outside the map and cells on locked layers are skipped (as with `paintCells`).
 *
 * Grid clip layers (`grid: true`) paste into grid layers with `paintTerrain`;
 * tile clip layers into tile layers. A kind mismatch throws for an explicit
 * mapping and is skipped for `null`.
 *
 * Derived tile layers (the target of a terrain grid layer) never receive the
 * clip's raw tiles: they are owned by their grid. After the grid writes,
 * every terrain layer whose grid or target was pasted into is re-derived over
 * the pasted rectangle plus a one-cell border, in the same undo step, so the
 * derived tiles always equal `deriveTerrainTiles` (the copied tiles were
 * derived in the source's context — edges and neighbours differ here).
 *
 * @returns the patches of the layers that changed.
 * @throws Error before changing anything when a mapped target layer does not
 * exist, kinds differ, a grid value does not fit the target, or a referenced
 * tile is not in the target document's tilesets.
 */
export function pasteClip(
  store: MapStore,
  clip: TileClip,
  layerMapping: LayerMapping,
  x: number,
  y: number,
  options: PasteOptions = {},
): LayerPatch[] {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new TypeError(`pasteClip: position must be integers, got (${x}, ${y})`);
  }
  const doc = store.document;
  const erase = options.emptyCells === "erase";
  const targets: { layer: ClipLayer; targetId: string }[] = [];
  for (const layer of clip.layers) {
    const targetId = mappedLayer(layerMapping, layer.layerId);
    if (targetId === undefined) continue;
    const target = doc.getLayer(targetId);
    if (!target) {
      if (layerMapping === null) continue;
      throw new Error(`pasteClip: unknown target layer "${targetId}"`);
    }
    if (isEntityLayer(target)) {
      if (layerMapping === null) continue;
      throw new Error(`pasteClip: target layer "${targetId}" is an entity layer`);
    }
    if (isGridLayer(target) !== (layer.grid === true)) {
      if (layerMapping === null) continue;
      throw new Error(`pasteClip: clip layer "${layer.layerId}" and target layer "${targetId}" are of different kinds`);
    }
    if (isGridLayer(target)) {
      for (const v of layer.cells) {
        if (v > target.maxValue) throw new RangeError(`pasteClip: grid value ${v} does not fit layer "${targetId}"`);
      }
    }
    targets.push({ layer, targetId });
  }

  // Validate every referenced tile before adding palette entries.
  const used = new Set<number>();
  for (const { layer, targetId } of targets) {
    if (layer.grid || terrainLayersOf(doc, targetId).length > 0) continue;
    for (const cell of layer.cells) if (cell !== EMPTY_CELL) used.add(cellPaletteIndex(cell));
  }
  for (const index of used) {
    const entry = clip.palette[index - 1];
    if (!entry) throw new Error(`pasteClip: clip palette index ${index} does not exist`);
    const tileset = doc.getTileset(entry.tilesetId);
    if (!tileset) throw new Error(`pasteClip: unknown tileset "${entry.tilesetId}"`);
    if (!isValidTileId(tileset, entry.tileId)) {
      throw new RangeError(`pasteClip: tile id ${entry.tileId} is outside tileset "${entry.tilesetId}"`);
    }
  }
  const remap = new Map<number, number>();
  for (const index of [...used].sort((a, b) => a - b)) {
    const entry = clip.palette[index - 1]!;
    remap.set(index, store.getOrAddPaletteIndex(entry.tilesetId, entry.tileId));
  }

  const patches: LayerPatch[] = [];
  const rect: CellRect = { x, y, width: clip.width, height: clip.height };
  const derive = new Set<string>();
  store.beginTransaction();
  try {
    for (const { layer, targetId } of targets) {
      const owners = terrainLayersOf(doc, targetId);
      for (const id of owners) derive.add(id);
      if (!layer.grid && owners.length > 0) continue; // derived tile layer: re-derived below
      if (layer.grid) {
        const writes: GridWrite[] = [];
        for (let cy = 0; cy < clip.height; cy++) {
          for (let cx = 0; cx < clip.width; cx++) {
            const value = layer.cells[cy * clip.width + cx] ?? 0;
            if (value === 0 && !erase) continue;
            writes.push({ x: x + cx, y: y + cy, value });
          }
        }
        const patch = store.dispatch({ type: "paintTerrain", layerId: targetId, cells: writes });
        if (patch.cells.length > 0) patches.push(patch);
        continue;
      }
      const cells: CellWrite[] = [];
      for (let cy = 0; cy < clip.height; cy++) {
        for (let cx = 0; cx < clip.width; cx++) {
          const cell = layer.cells[cy * clip.width + cx] ?? EMPTY_CELL;
          if (cell === EMPTY_CELL) {
            if (erase) cells.push({ x: x + cx, y: y + cy, cell: EMPTY_CELL });
            continue;
          }
          const index = remap.get(cellPaletteIndex(cell))!;
          cells.push({ x: x + cx, y: y + cy, cell: makeCell(index, cellFlags(cell)) });
        }
      }
      const patch = store.dispatch({ type: "paintCells", layerId: targetId, cells });
      if (patch.cells.length > 0) patches.push(patch);
    }
    patches.push(...rederive(store, derive, rect));
  } finally {
    store.commit();
  }
  return patches;
}

/**
 * Terrain grid layers tied to layer `layerId`: the layer itself when it is a
 * terrain grid, or the terrain grid deriving into it when it is a tile layer.
 */
function terrainLayersOf(doc: MapDocument, layerId: string): string[] {
  const layer = doc.getLayer(layerId);
  if (isGridLayer(layer)) return layer.role === "terrain" ? [layer.id] : [];
  return doc.layers.filter((l) => isGridLayer(l) && l.role === "terrain" && l.targetLayerId === layerId).map((l) => l.id);
}

/** Re-derives `rect` plus a one-cell border of each terrain layer; returns the non-empty patches. */
function rederive(store: MapStore, gridIds: Iterable<string>, rect: CellRect): LayerPatch[] {
  const out: LayerPatch[] = [];
  const border = { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 };
  for (const layerId of gridIds) {
    if (!store.document.getLayer(layerId)) continue;
    const patch = store.dispatch({ type: "deriveTerrain", layerId, rect: border });
    if (patch.cells.length > 0) out.push(patch);
  }
  return out;
}

/**
 * Cut: copies `rect` of the layers, then clears it, as one undo step.
 * Locked layers are copied but not cleared; entity layers are skipped.
 * Derived tile layers are copied but not cleared by hand: their terrain
 * layers are re-derived over `rect` plus a one-cell border instead (so
 * cutting the grid clears its tiles, and the tiles stay consistent).
 */
export function cutRegion(store: MapStore, layerIds: readonly string[], rect: CellRect): TileClip {
  const clip = copyRegion(store.document, layerIds, rect);
  const cells: CellWrite[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) cells.push({ x, y, cell: EMPTY_CELL });
  }
  const values: GridWrite[] = cells.map((c) => ({ x: c.x, y: c.y, value: 0 }));
  const derive = new Set<string>();
  store.beginTransaction();
  try {
    for (const layerId of layerIds) {
      const doc = store.document;
      if (isEntityLayer(doc.getLayer(layerId))) continue;
      const owners = terrainLayersOf(doc, layerId);
      for (const id of owners) derive.add(id);
      if (isGridLayer(doc.getLayer(layerId))) store.dispatch({ type: "paintTerrain", layerId, cells: values });
      else if (owners.length === 0) store.dispatch({ type: "paintCells", layerId, cells });
    }
    rederive(store, derive, rect);
  } finally {
    store.commit();
  }
  return clip;
}

/**
 * Mirrors a clip: `"x"` swaps left/right and toggles `FLIP_H` on every
 * non-empty cell, `"y"` swaps top/bottom and toggles `FLIP_V`. Grid clip
 * layers are only mirrored (their values have no flags). Returns a new clip.
 */
export function flipClip(clip: TileClip, axis: "x" | "y"): TileClip {
  const { width, height } = clip;
  const flag = axis === "x" ? FLIP_H : FLIP_V;
  const layers = clip.layers.map((layer): ClipLayer => {
    const cells = new Uint32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = layer.cells[y * width + x] ?? EMPTY_CELL;
        if (cell === EMPTY_CELL) continue;
        const tx = axis === "x" ? width - 1 - x : x;
        const ty = axis === "y" ? height - 1 - y : y;
        cells[ty * width + tx] = layer.grid ? cell : toggleFlag(cell, flag);
      }
    }
    return Object.freeze(
      layer.grid
        ? { layerId: layer.layerId, name: layer.name, grid: true, ...(layer.role ? { role: layer.role } : {}), cells }
        : { layerId: layer.layerId, name: layer.name, cells },
    );
  });
  return Object.freeze({ width, height, palette: clip.palette, layers: Object.freeze(layers) });
}

/** Non-empty cells of one clip layer as (clip-relative) points, row-major. Handy for paste previews. */
export function clipLayerPoints(clip: TileClip, layerIndex: number): (CellPoint & { cell: Cell })[] {
  const layer = clip.layers[layerIndex];
  if (!layer) return [];
  const out: (CellPoint & { cell: Cell })[] = [];
  for (let i = 0; i < layer.cells.length; i++) {
    const cell = layer.cells[i]!;
    if (cell !== EMPTY_CELL) out.push({ x: i % clip.width, y: Math.floor(i / clip.width), cell });
  }
  return out;
}

function toggleFlag(cell: Cell, flag: number): Cell {
  return ((cell & ~CELL_FLAG_MASK) | ((cell ^ flag) & CELL_FLAG_MASK)) >>> 0;
}

function mappedLayer(mapping: LayerMapping, clipLayerId: string): string | undefined {
  if (mapping === null) return clipLayerId;
  if (mapping instanceof Map) return mapping.get(clipLayerId);
  const record = mapping as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(record, clipLayerId) ? record[clipLayerId] : undefined;
}

function assertRect(rect: CellRect, what: string): void {
  const ok =
    Number.isInteger(rect.x) &&
    Number.isInteger(rect.y) &&
    Number.isInteger(rect.width) &&
    Number.isInteger(rect.height) &&
    rect.width >= 1 &&
    rect.height >= 1;
  if (!ok) throw new RangeError(`${what}: rect must have integer position and positive integer size`);
}
