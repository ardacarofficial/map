import { cellPaletteIndex, withPaletteIndex } from "./cell";
import type { MapDocument } from "./document";
import type { CellRect } from "./geometry";
import { isTileLayer } from "./layer";
import type { CellWrite } from "./ops";
import type { PaletteEntry } from "./palette";
import { isValidTileId } from "./tileset";

export interface TileReplacementOptions {
  readonly from: PaletteEntry;
  readonly to: PaletteEntry;
  readonly layerIds: readonly string[];
  /** Omit for the whole layer. */
  readonly region?: CellRect;
}

export interface TileReplacementWrites {
  readonly layerId: string;
  readonly cells: CellWrite[];
}

/**
 * Pure replacement plan, matching tile identity through the document palette.
 * A new target uses the next palette slot: the caller must getOrAdd that tile
 * before dispatching the plan (or replan after adding it). No palette mutation
 * is needed for a live count. Only visible, unlocked tile layers participate.
 */
export function planTileReplacement(doc: MapDocument, options: TileReplacementOptions): TileReplacementWrites[] {
  const { from, to, region } = options;
  if (from.tilesetId === to.tilesetId && from.tileId === to.tileId) return [];
  const target = doc.getTileset(to.tilesetId);
  if (!target || !isValidTileId(target, to.tileId)) return [];
  const sourceIndex = doc.palette.indexOf(from.tilesetId, from.tileId);
  if (sourceIndex === 0) return [];
  const targetIndex = doc.palette.indexOf(to.tilesetId, to.tileId) || doc.palette.size + 1;
  const x0 = Math.max(0, region?.x ?? 0);
  const y0 = Math.max(0, region?.y ?? 0);
  const x1 = Math.min(doc.map.width, region ? region.x + region.width : doc.map.width);
  const y1 = Math.min(doc.map.height, region ? region.y + region.height : doc.map.height);
  const plans: TileReplacementWrites[] = [];
  for (const layerId of new Set(options.layerIds)) {
    const layer = doc.getLayer(layerId);
    if (!isTileLayer(layer) || layer.locked || !layer.visible) continue;
    const cells: CellWrite[] = [];
    for (const chunk of layer.chunks()) {
      const left = chunk.cx << 5;
      const top = chunk.cy << 5;
      if (left >= x1 || top >= y1 || left + 32 <= x0 || top + 32 <= y0) continue;
      for (let y = Math.max(y0, top); y < Math.min(y1, top + 32); y++) {
        for (let x = Math.max(x0, left); x < Math.min(x1, left + 32); x++) {
          const cell = chunk.data[((y & 31) << 5) | (x & 31)]!;
          if (cellPaletteIndex(cell) === sourceIndex) cells.push({ x, y, cell: withPaletteIndex(cell, targetIndex) });
        }
      }
    }
    if (cells.length) plans.push({ layerId, cells });
  }
  return plans;
}
