import { cellFlags, cellPaletteIndex } from './cell';
import type { MapDocument } from './document';
import { isTileLayer } from './layer';
import type { PaletteEntry } from './palette';

export interface TileUsage extends PaletteEntry {
  readonly layerId: string;
  readonly layerName: string;
  readonly x: number;
  readonly y: number;
  readonly flags: number;
}

/** Read-only identity search. Flips are facts, not part of tile identity.
 * Each yield examines at most one sparse chunk (1024 cells), even if empty
 * of matches, allowing callers to yield the UI thread between batches.
 * Hidden/locked tile layers count; collision/entity layers do not.
 */
export function* tileUsageBatches(doc: MapDocument, targets: readonly PaletteEntry[]): Generator<TileUsage[]> {
  const indices = new Set<number>();
  for (const target of targets) {
    const index = doc.palette.indexOf(target.tilesetId, target.tileId);
    if (index) indices.add(index);
    // Large multi-tile brushes also give the caller scheduling points.
    yield [];
  }
  if (!indices.size) return;
  for (const layer of doc.layers) {
    if (!isTileLayer(layer)) continue;
    for (const chunk of layer.chunks()) {
      const found: TileUsage[] = [];
      for (let i = 0; i < chunk.data.length; i++) {
        const cell = chunk.data[i]!;
        const index = cellPaletteIndex(cell);
        if (!indices.has(index)) continue;
        const x = (chunk.cx << 5) + (i & 31), y = (chunk.cy << 5) + (i >> 5);
        if (x < 0 || y < 0 || x >= doc.map.width || y >= doc.map.height) continue;
        found.push({ ...doc.palette.get(index)!, layerId: layer.id, layerName: layer.name, x, y, flags: cellFlags(cell) });
      }
      yield found;
    }
  }
}
