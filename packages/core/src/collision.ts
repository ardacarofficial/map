/**
 * Collision is computed, not painted (CLAUDE.md v0.3: "Duvar çizilince
 * collision kendiliğinden gelir; aynı şey iki kere çizilmez").
 *
 * A cell is solid when
 * 1. the topmost collision grid layer with a non-zero value there says so
 *    (`COLLISION_SOLID` = force solid, `COLLISION_PASSABLE` = force
 *    passable) — exceptions win; otherwise
 * 2. any tile layer (visible or hidden, derived terrain layers included)
 *    has a tile there that its tileset marks solid.
 *
 * Flip flags do not matter. Exporters (v0.4) call these functions.
 */
import { cellPaletteIndex } from "./cell";
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT } from "./chunk";
import type { MapDocument } from "./document";
import { COLLISION_PASSABLE, COLLISION_SOLID, isGridLayer } from "./layer";
import { isTileSolid } from "./tileset";

/** Derived collision of a whole map. */
export interface CollisionGrid {
  readonly width: number;
  readonly height: number;
  /** `width × height`, row-major; 1 = solid, 0 = passable. */
  readonly data: Uint8Array;
}

/** `solid[paletteIndex]` = 1 when that palette entry's tile is solid. */
export function solidPaletteMask(doc: MapDocument): Uint8Array {
  const palette = doc.palette;
  const mask = new Uint8Array(palette.size + 1);
  palette.entries().forEach((entry, i) => {
    const tileset = doc.getTileset(entry.tilesetId);
    if (tileset && isTileSolid(tileset, entry.tileId)) mask[i + 1] = 1;
  });
  return mask;
}

/** True when cell (`x`, `y`) is solid. Cells outside the map are not solid. */
export function collisionAt(doc: MapDocument, x: number, y: number): boolean {
  if (!doc.inBounds(x, y)) return false;
  const layers = doc.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    if (!isGridLayer(layer) || layer.role !== "collision") continue;
    const v = layer.getCell(x, y);
    if (v === COLLISION_SOLID) return true;
    if (v === COLLISION_PASSABLE) return false;
  }
  for (const layer of layers) {
    if (isGridLayer(layer)) continue;
    const cell = layer.getCell(x, y);
    if (cell === 0) continue;
    const entry = doc.palette.get(cellPaletteIndex(cell));
    const tileset = entry && doc.getTileset(entry.tilesetId);
    if (entry && tileset && isTileSolid(tileset, entry.tileId)) return true;
  }
  return false;
}

/** Collision of every cell of the map (same rules as {@link collisionAt}). */
export function deriveCollision(doc: MapDocument): CollisionGrid {
  const { width, height } = doc.map;
  const data = new Uint8Array(width * height);
  const solid = solidPaletteMask(doc);
  const forEachCell = (chunkData: Uint32Array, cx: number, cy: number, fn: (index: number, value: number) => void) => {
    const x0 = cx << CHUNK_SHIFT;
    const y0 = cy << CHUNK_SHIFT;
    for (let i = 0; i < CHUNK_AREA; i++) {
      const v = chunkData[i]!;
      if (v === 0) continue;
      const x = x0 + (i & CHUNK_MASK);
      const y = y0 + (i >> CHUNK_SHIFT);
      if (x < width && y < height) fn(y * width + x, v);
    }
  };
  for (const layer of doc.layers) {
    if (isGridLayer(layer)) continue;
    for (const chunk of layer.chunks()) {
      forEachCell(chunk.data, chunk.cx, chunk.cy, (index, cell) => {
        if (solid[cellPaletteIndex(cell)] === 1) data[index] = 1;
      });
    }
  }
  // Exceptions: bottom to top, so the topmost collision layer wins.
  for (const layer of doc.layers) {
    if (!isGridLayer(layer) || layer.role !== "collision") continue;
    for (const chunk of layer.chunks()) {
      forEachCell(chunk.data, chunk.cx, chunk.cy, (index, v) => {
        if (v === COLLISION_SOLID) data[index] = 1;
        else if (v === COLLISION_PASSABLE) data[index] = 0;
      });
    }
  }
  return { width, height, data };
}
