import { createDocument, makeCell, MapStore } from '@smap/core';
import { describe, expect, it, vi } from 'vitest';
import { scanWorldUsages } from './usageScan';

const target = { tilesetId: 'edited', tileId: 7 };
function store() {
  const s = new MapStore(createDocument({ width: 70, height: 40, tilesets: [{ id: 'edited', name: 'Edited', imagePath: 'tilesets/edited.png', tileWidth: 16, tileHeight: 16, columns: 8, rows: 8, margin: 0, spacing: 0 }] }));
  s.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
  const index = s.getOrAddPaletteIndex(target.tilesetId, target.tileId);
  s.dispatch({ type: 'paintCells', layerId: s.document.layers[0]!.id, cells: [{ x: 33, y: 4, cell: makeCell(index, 0x80000000) }] });
  return s;
}
describe('world usage scan', () => {
  it('uses live edits for cached maps and read-only file scanning for unloaded maps', async () => {
    const s = store(), before = s.undoDepth;
    const scanFile = vi.fn(async () => [{ ...target, layerId: 'l', layerName: 'Below', x: 2, y: 3, flags: 0 }]);
    const pause = vi.fn(async () => {});
    const results = await scanWorldUsages({ maps: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], cached: id => id === 'a' ? s.document : undefined, scanFile }, [target], new AbortController().signal, pause);
    expect(results.map(r => [r.mapName, r.x, r.flags])).toEqual([['A', 33, 0x80000000], ['B', 2, 0]]);
    expect(scanFile).toHaveBeenCalledOnce();
    expect(s.undoDepth).toBe(before);
    expect(pause).toHaveBeenCalled();
  });
  it('discards a scan cancelled while loading a map', async () => {
    const cancel = new AbortController();
    const result = await scanWorldUsages({ maps: [{ id: 'a', name: 'A' }], cached: () => undefined, scanFile: async () => { cancel.abort(); return []; } }, [target], cancel.signal);
    expect(result).toEqual([]);
  });
  it('reports unreadable files as failure instead of misleading empty counts', async () => {
    await expect(scanWorldUsages({ maps: [{ id: 'a', name: 'A' }], cached: () => undefined, scanFile: async () => { throw Error('missing'); } }, [target], new AbortController().signal)).rejects.toThrow('missing');
  });
});

it('yields on bounded chunk batches even when there are no matching cells', async () => {
  const s = store();
  // A full 70-cell row spans three chunks; only one target cell matches.
  const other = s.getOrAddPaletteIndex('edited', 1);
  s.dispatch({ type: 'paintCells', layerId: s.document.layers[0]!.id, cells: Array.from({ length: 70 }, (_, x) => ({ x, y: 35, cell: other })) });
  const clock = vi.spyOn(performance, 'now');
  let now = 0;
  clock.mockImplementation(() => now += 5);
  const pause = vi.fn(async () => {});
  try {
    const results = await scanWorldUsages({ maps: [{ id: 'm', name: 'Map' }], cached: () => s.document, scanFile: async () => [] }, [target], new AbortController().signal, pause);
    expect(results).toHaveLength(1);
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(5);
  } finally { clock.mockRestore(); }
});
