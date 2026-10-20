import { expect, it } from 'vitest';
import fc from 'fast-check';
import { cellPaletteIndex, createDocument, isTileLayer, makeCell, MapStore } from '../src';

it('keeps ownership counts exact through cell, layer, resize, rollback and history operations', () => {
  fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 8 }), fc.nat(1000)), { minLength: 1, maxLength: 60 }), actions => {
    const store = new MapStore(createDocument({ width: 48, height: 48, tilesets: [{ id: 'source', name: 'Source', imagePath: 'tilesets/source.png', tileWidth: 16, tileHeight: 16, columns: 3, rows: 1, margin: 0, spacing: 0 }] }));
    store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
    const indices = [0, 1, 2].map(tileId => store.getOrAddPaletteIndex('source', tileId));
    store.clearHistory();
    for (const [action, value] of actions) {
      const layerId = store.document.layers[0]!.id;
      if (action < 3) store.dispatch({ type: 'paintCells', layerId, cells: [{ x: value % 48, y: (value >> 3) % 48, cell: action === 0 ? 0 : makeCell(indices[value % 3]!, ((value % 8) << 29) >>> 0) }] });
      if (action === 3) store.undo();
      if (action === 4) store.redo();
      if (action === 5) { store.beginTransaction(); store.dispatch({ type: 'paintCells', layerId, cells: [{ x: 0, y: 0, cell: indices[0]! }] }); store.rollback(); }
      if (action === 6) store.dispatch({ type: 'resizeMap', width: value % 2 ? 32 : 48, height: 48 });
      if (action === 7 && store.document.layers.length < 4) store.dispatch({ type: 'duplicateLayer', layerId });
      if (action === 8 && store.document.layers.length > 1) store.dispatch({ type: 'removeLayer', layerId });
      const counts = new Map<number, number>();
      for (const layer of store.document.layers) if (isTileLayer(layer)) for (const chunk of layer.chunks()) for (const cell of chunk.data) {
        const index = cellPaletteIndex(cell); if (index) counts.set(index, (counts.get(index) ?? 0) + 1);
      }
      for (const [tileId, index] of indices.entries()) expect(store.tileUsageCount('source', tileId)).toBe(counts.get(index) ?? 0);
    }
  }), { numRuns: 80 });
});

it('indexes existing loaded chunks and follows undo', () => {
  const original = new MapStore(createDocument({ width: 64, height: 64 }));
  const layerId = original.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
  const slot = original.dispatch({ type: 'allocateEditedTile', tileWidth: 1, tileHeight: 1, pixels: Uint8Array.of(1, 2, 3, 255) });
  original.dispatch({ type: 'remapCells', layerId, cells: [{ x: 40, y: 40 }], tilesetId: slot.assetId, tileId: slot.tileId });
  const loaded = new MapStore(original.document);
  expect(loaded.tileUsageCount(slot.assetId, slot.tileId)).toBe(1);
  expect(loaded.tileUsageCount('missing', 0)).toBe(0);
  loaded.dispatch({ type: 'paintCells', layerId, cells: [{ x: 40, y: 40, cell: 0 }] });
  expect(loaded.tileUsageCount(slot.assetId, slot.tileId)).toBe(0);
  loaded.undo(); expect(loaded.tileUsageCount(slot.assetId, slot.tileId)).toBe(1);
});
