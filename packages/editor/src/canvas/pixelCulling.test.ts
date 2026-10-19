import { describe, expect, it } from 'vitest';
import { createDocument, MapStore } from '@smap/core';
import { MapScene } from './mapScene';

describe('native pixel artwork visibility', () => {
  it.each([{ x: 31, y: 1, view: [33, 0, 35, 4] }, { x: 2, y: 32, view: [0, 29, 4, 31] }])('keeps owner chunks whose native extent overlaps the viewport (%j)', ({ x, y, view }) => {
    const store = new MapStore(createDocument({ width: 64, height: 64, tileWidth: 16, tileHeight: 16, tilesets: [{ id: 'large', name: 'Large', imagePath: 'large.png', tileWidth: 64, tileHeight: 64, columns: 1, rows: 1, margin: 0, spacing: 0 }] }));
    const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } }), index = store.dispatch({ type: 'addPaletteEntry', tilesetId: 'large', tileId: 0 });
    store.dispatch({ type: 'paintCells', layerId, cells: [{ x, y, cell: index }] });
    const scene = new MapScene(store, () => undefined, () => {});
    scene.updateVisibility(view[0]!, view[1]!, view[2]!, view[3]!); scene.flush();
    expect(scene.metrics.geometryBuilds).toBe(1); scene.destroy();
  });
});
