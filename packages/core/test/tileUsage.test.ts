import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDocument } from '../src/document';
import { MapStore } from '../src/store';
import { cellFlags, cellPaletteIndex, makeCell } from '../src/cell';
import { parseLevel, serializeLevel } from '../src/serialize';
import { tileUsageBatches } from '../src/tileUsage';

const targets = [{ tilesetId: 'source', tileId: 0 }, { tilesetId: 'edited', tileId: 7 }, { tilesetId: 'generated', tileId: 0 }];
describe('tile usage index', () => {
  it('matches a naive scan across random maps, layers, identities and all flip combinations', () => {
    fc.assert(fc.property(fc.array(fc.array(fc.record({ x: fc.integer({ min: 0, max: 66 }), y: fc.integer({ min: 0, max: 34 }), tile: fc.integer({ min: 0, max: 4 }), flip: fc.integer({ min: 0, max: 7 }), layer: fc.integer({ min: 0, max: 1 }) }), { maxLength: 130 }), { minLength: 2, maxLength: 4 }), maps => {
      for (const cells of maps) {
        const store = new MapStore(createDocument({ width: 67, height: 35, tilesets: ['source', 'edited', 'generated', 'other'].map(id => ({ id, name: id, imagePath: `tilesets/${id}.png`, tileWidth: 32, tileHeight: 32, columns: 8, rows: 8, margin: 0, spacing: 0 })) }));
        store.dispatch({ type: 'addLayer', layer: { name: 'A' } });
        store.dispatch({ type: 'addLayer', layer: { name: 'B', visible: false, locked: true } });
        // Grid cells can have the same numeric values; they must never count as tiles.
        store.dispatch({ type: 'addLayer', layer: { name: 'Collision', type: 'grid', role: 'collision' } });
        const refs = [...targets, { tilesetId: 'other', tileId: 0 }];
        const indices = refs.map(r => store.getOrAddPaletteIndex(r.tilesetId, r.tileId));
        for (const c of cells) {
          const layer = store.document.layers[c.layer]!;
          // Unlock only for the operation; visibility has no effect on search.
          store.dispatch({ type: 'setLayerProps', layerId: layer.id, props: { locked: false } });
          store.dispatch({ type: 'paintCells', layerId: layer.id, cells: [{ x: c.x, y: c.y, cell: makeCell(indices[c.tile] ?? 0, c.flip * 0x20000000) }] });
        }
        store.dispatch({ type: 'paintGrid', layerId: store.document.layers[2]!.id, cells: [{ x: 0, y: 0, value: 1 }] });
        const before = serializeLevel(store.document), undo = store.undoDepth;
        const actual = [...tileUsageBatches(store.document, [...targets, targets[0]!])].flat();
        const naive = [];
        for (const l of store.document.layers.filter(l => l.type === 'tile')) for (let y = 0; y < 35; y++) for (let x = 0; x < 67; x++) {
          const cell = l.getCell(x, y), ref = store.document.palette.get(cellPaletteIndex(cell));
          if (ref && targets.some(r => r.tilesetId === ref.tilesetId && r.tileId === ref.tileId)) naive.push({ layerId: l.id, layerName: l.name, x, y, flags: cellFlags(cell), ...ref });
        }
        const sort = (a: {layerId: string; x: number; y: number}, b: typeof a) => a.layerId.localeCompare(b.layerId) || a.y - b.y || a.x - b.x;
        expect(actual.sort(sort)).toEqual(naive.sort(sort));
        expect([...tileUsageBatches(parseLevel(before), targets)].flat().sort(sort)).toEqual(naive);
        expect([...tileUsageBatches(store.document, targets)].every(b => b.length <= 1024)).toBe(true);
        expect(serializeLevel(store.document)).toBe(before);
        expect(store.undoDepth).toBe(undo);
      }
    }), { numRuns: 70 });
  });
});
