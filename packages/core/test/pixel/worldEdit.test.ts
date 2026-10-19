import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { createDocument, MapStore, RasterAssets, serializeLevel } from '../../src';
import { WorldHistory } from '../../src/pixel/worldHistory';
import { applyWorldEdit, prepareWorldEdit } from '../../src/pixel/worldEdit';

function setup() {
  const rasters = new RasterAssets(), history = new WorldHistory();
  const maps = Array.from({ length: 3 }, (_, i) => {
    const store = new MapStore(createDocument({ width: 4, height: 4, tilesets: [{ id: 'source', name: 'Source', imagePath: 'source.png', tileWidth: 1, tileHeight: 1, columns: 1, rows: 1, margin: 0, spacing: 0 }] }), { rasterAssets: rasters });
    const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Tiles' } });
    store.clearHistory(); history.register(String(i), store);
    return { mapId: String(i), store, layerId };
  });
  return { maps, history, rasters };
}
const pixels = (v: number) => new Uint8Array([v, 2, 3, 255]);

describe('compound world pixel plans', () => {
  it('owns shared patches; one entry restores pixels, palette and cells across three maps', () => {
    const { maps, history, rasters } = setup();
    const owner = maps[0]!;
    const slot = owner.store.dispatch({ type: 'allocateEditedTile', tileWidth: 1, tileHeight: 1, pixels: pixels(4) });
    const ts = owner.store.document.getTileset(slot.assetId)!;
    for (const m of maps.slice(1)) m.store.dispatch({ type: 'addTileset', tileset: ts });
    history.reset();
    const before = maps.map(m => serializeLevel(m.store.document));
    const input = pixels(9);
    const plan = prepareWorldEdit('0', maps.map((m, i) => ({ ...m, operations: [
      ...(i === 0 ? [{ type: 'editTilePixels' as const, assetId: slot.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, before: pixels(4), after: input }] : []),
      { type: 'remapCells' as const, layerId: m.layerId, cells: [{ x: i, y: 0 }], tilesetId: slot.assetId, tileId: 0 },
    ] })));
    input.fill(0);
    applyWorldEdit(history, plan);
    expect(history.undoDepth).toBe(1);
    expect(history.peekUndo()!.participants).toHaveLength(3);
    expect(history.peekUndo()!.pixelPatches).toHaveLength(1);
    const final = maps.map(m => serializeLevel(m.store.document));
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(pixels(9));
    history.undo();
    expect(maps.map(m => serializeLevel(m.store.document))).toEqual(before);
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(pixels(4));
    history.redo();
    expect(maps.map(m => serializeLevel(m.store.document))).toEqual(final);
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(pixels(9));
  });

  it.each(['locked', 'hidden', 'stale', 'invalid'] as const)('rejects %s target without live mutation or redo loss', kind => {
    const { maps, history } = setup();
    maps[0]!.store.dispatch({ type: 'setMapProps', name: 'Edit' }); history.undo();
    if (kind === 'locked') maps[1]!.store.dispatch({ type: 'setLayerProps', layerId: maps[1]!.layerId, props: { locked: true } });
    if (kind === 'hidden') maps[1]!.store.dispatch({ type: 'setLayerProps', layerId: maps[1]!.layerId, props: { visible: false } });
    const before = maps.map(m => serializeLevel(m.store.document)), depth = history.undoDepth, redo = history.redoDepth;
    const events: unknown[] = [];
    maps.forEach(m => m.store.subscribe(e => events.push(e)));
    expect(() => {
      const plan = prepareWorldEdit('0', maps.map(m => ({ ...m, operations: [{ type: 'remapCells', layerId: m.layerId, cells: [{ x: 0, y: 0 }], tilesetId: kind === 'invalid' ? 'missing' : 'source', tileId: 0 }] })));
      applyWorldEdit(history, kind === 'stale' ? { ...plan, participants: plan.participants.map(p => ({ ...p, revision: -1 })) } : plan);
    }).toThrow();
    expect(maps.map(m => serializeLevel(m.store.document))).toEqual(before);
    expect(events).toEqual([]);
    expect([history.undoDepth, history.redoDepth]).toEqual([depth, redo]);
  });
  it('rolls back already-dispatched raster and cell patches if a participant rejects application', () => {
    const { maps, history, rasters } = setup();
    const slot = maps[0]!.store.dispatch({ type: 'allocateEditedTile', tileWidth: 1, tileHeight: 1, pixels: pixels(4) });
    history.reset();
    maps[1]!.store.dispatch({ type: 'setMapProps', name: 'Future' }); history.undo();
    const before = maps.map(m => serializeLevel(m.store.document));
    const plan = prepareWorldEdit('0', maps.map((m, i) => ({ ...m, operations: i === 0 ? [
      { type: 'editTilePixels', assetId: slot.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: pixels(8) },
    ] : [{ type: 'remapCells', layerId: m.layerId, cells: [{ x: i, y: 0 }], tilesetId: 'source', tileId: 0 }] })));
    const off = maps[2]!.store.subscribe(e => { if (e.cause === 'dispatch' && e.cells.length) throw new Error('participant rejected'); });
    expect(() => applyWorldEdit(history, plan)).toThrow('participant rejected');
    off();
    expect(maps.map(m => serializeLevel(m.store.document))).toEqual(before);
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(pixels(4));
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(1);
    expect(maps.every(m => !m.store.inTransaction)).toBe(true);
  });

  it('validates stale revision guards before touching any store', () => {
    const { maps, history } = setup();
    const plan = prepareWorldEdit('0', maps.map(m => ({ ...m, operations: [{ type: 'remapCells', layerId: m.layerId, cells: [{ x: 0, y: 0 }], tilesetId: 'source', tileId: 0 }] })));
    maps[2]!.store.dispatch({ type: 'setMapProps', name: 'Concurrent edit' });
    const before = maps.map(m => serializeLevel(m.store.document)), revisions = maps.map(m => m.store.revision);
    expect(() => applyWorldEdit(history, plan)).toThrow('stale');
    expect(maps.map(m => serializeLevel(m.store.document))).toEqual(before);
    expect(maps.map(m => m.store.revision)).toEqual(revisions);
  });

  it('round trips random interleaved Tile and compound Pixel actions across three maps exactly', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 1, max: 255 }), fc.boolean()), { minLength: 3, maxLength: 20 }), actions => {
      const { maps, history, rasters } = setup();
      const slot = maps[0]!.store.dispatch({ type: 'allocateEditedTile', tileWidth: 1, tileHeight: 1, pixels: pixels(0) });
      for (const m of maps.slice(1)) m.store.dispatch({ type: 'addTileset', tileset: maps[0]!.store.document.getTileset(slot.assetId)! });
      history.reset();
      const snapshot = () => ({ maps: maps.map(m => ({ level: serializeLevel(m.store.document), tilesets: JSON.stringify(m.store.document.tilesets) })), bytes: rasters.getTile(slot.assetId, 0)!.data });
      const initial = snapshot();
      for (const [mapId, value, compound] of actions) {
        if (compound) applyWorldEdit(history, prepareWorldEdit(String(mapId), [maps[mapId]!, ...maps.filter((_, i) => i !== mapId)].map((m, i) => ({ ...m, operations: [
          ...(i === 0 ? [{ type: 'editTilePixels' as const, assetId: slot.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: pixels(value) }] : []),
          { type: 'remapCells' as const, layerId: m.layerId, cells: [{ x: value & 3, y: (value >> 2) & 3 }], tilesetId: slot.assetId, tileId: 0 },
        ] }))));
        else {
          const m = maps[mapId]!;
          m.store.beginTransaction();
          const index = m.store.dispatch({ type: 'addPaletteEntry', tilesetId: 'source', tileId: 0, undoable: true });
          m.store.dispatch({ type: 'paintCells', layerId: m.layerId, cells: [{ x: value & 3, y: (value >> 2) & 3, cell: index }] });
          m.store.commit();
        }
      }
      const final = snapshot(), count = history.undoDepth;
      for (let i = 0; i < count; i++) expect(history.undo()).not.toBeNull();
      expect(snapshot()).toEqual(initial);
      for (let i = 0; i < count; i++) expect(history.redo()).not.toBeNull();
      expect(snapshot()).toEqual(final);
    }), { numRuns: 30 });
  });

  it('allocates one shared atlas and journals every participant palette and metadata in one step', () => {
    const { maps, history, rasters } = setup();
    const initial = maps.map(m => ({ level: serializeLevel(m.store.document), tilesets: JSON.stringify(m.store.document.tilesets) }));
    const plan = prepareWorldEdit('0', maps.map((m, i) => ({ ...m, operations: [
      ...(i === 0 ? [{ type: 'allocateEditedTile' as const, tileWidth: 1, tileHeight: 1, pixels: pixels(7) }] : []),
      { type: 'remapCells' as const, layerId: m.layerId, cells: [{ x: i, y: 0 }], tilesetId: 'edited-1x1-1', tileId: 0 },
    ] })));
    applyWorldEdit(history, plan);
    expect(history.undoDepth).toBe(1);
    const final = maps.map(m => ({ level: serializeLevel(m.store.document), tilesets: JSON.stringify(m.store.document.tilesets) }));
    expect(rasters.assetIds()).toEqual(['edited-1x1-1']);
    history.undo();
    expect(maps.map(m => ({ level: serializeLevel(m.store.document), tilesets: JSON.stringify(m.store.document.tilesets) }))).toEqual(initial);
    expect(rasters.assetIds()).toEqual([]);
    history.redo();
    expect(maps.map(m => ({ level: serializeLevel(m.store.document), tilesets: JSON.stringify(m.store.document.tilesets) }))).toEqual(final);
    expect(rasters.getTile('edited-1x1-1', 0)!.data).toEqual(pixels(7));
  });

  it('keeps prepared byte buffers private and rejects a new shared asset after preparation', () => {
    const { maps, history, rasters } = setup();
    const slot = maps[0]!.store.dispatch({ type: 'allocateEditedTile', tileWidth: 1, tileHeight: 1, pixels: pixels(4) });
    history.reset();
    const plan = prepareWorldEdit('0', [{ ...maps[0]!, operations: [{ type: 'editTilePixels', assetId: slot.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: pixels(8) }] }]);
    const exposed = plan.participants[0]!.operations.find(op => op.type === 'editTilePixels')!;
    if (exposed.type === 'editTilePixels') exposed.after.fill(0);
    applyWorldEdit(history, plan);
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(pixels(8));
    const next = prepareWorldEdit('0', [{ ...maps[0]!, operations: [{ type: 'editTilePixels', assetId: slot.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: pixels(9) }] }]);
    maps[2]!.store.dispatch({ type: 'allocateEditedTile', tileWidth: 2, tileHeight: 1, pixels: new Uint8Array(8) });
    const revision = maps[0]!.store.revision;
    expect(() => applyWorldEdit(history, next)).toThrow('stale');
    expect(maps[0]!.store.revision).toBe(revision);
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(pixels(8));
  });

  it('synchronizes only edited assets and preserves a peer map’s newer unrelated metadata', () => {
    const { maps, history } = setup();
    const owner = maps[0]!.store, peer = maps[1]!.store;
    const unrelated = owner.dispatch({ type: 'allocateEditedTile', tileWidth: 1, tileHeight: 1, pixels: pixels(4) });
    const edited = owner.dispatch({ type: 'allocateEditedTile', tileWidth: 2, tileHeight: 1, pixels: new Uint8Array([...pixels(5), ...pixels(6)]) });
    for (const tileset of owner.document.tilesets) if (tileset.edited) peer.dispatch({ type: 'addTileset', tileset });
    peer.dispatch({ type: 'editTilePixels', assetId: unrelated.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: pixels(9) });
    const newer = peer.document.getTileset(unrelated.assetId);
    const plan = prepareWorldEdit('0', [
      { ...maps[0]!, operations: [{ type: 'editTilePixels', assetId: edited.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: pixels(8) }] },
      { ...maps[1]!, operations: [{ type: 'remapCells', layerId: maps[1]!.layerId, cells: [{ x: 0, y: 0 }], tilesetId: edited.assetId, tileId: 0 }] },
    ]);
    applyWorldEdit(history, plan);
    expect(peer.document.getTileset(unrelated.assetId)).toEqual(newer);
    history.undo();
    expect(peer.document.getTileset(unrelated.assetId)).toEqual(newer);
    expect(peer.rasterAssets.getTile(unrelated.assetId, 0)!.data).toEqual(pixels(9));
  });

});

it('prepares raster-only edits without enumerating unrelated map layers/chunks', () => {
  const { maps, history } = setup(), origin = maps[0]!;
  const slot = origin.store.dispatch({ type: 'allocateEditedTile', tileWidth: 1, tileHeight: 1, pixels: pixels(4) });
  history.reset();
  const layers = vi.spyOn(origin.store.document, 'layers', 'get');
  const plan = prepareWorldEdit(origin.mapId, [{ mapId: origin.mapId, store: origin.store, operations: [{ type: 'editTilePixels', assetId: slot.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: pixels(9) }] }]);
  expect(layers).not.toHaveBeenCalled(); layers.mockRestore();
  applyWorldEdit(history, plan); expect(origin.store.rasterAssets.getTile(slot.assetId, 0)!.data).toEqual(pixels(9));
  history.undo(); expect(origin.store.rasterAssets.getTile(slot.assetId, 0)!.data).toEqual(pixels(4));
});
