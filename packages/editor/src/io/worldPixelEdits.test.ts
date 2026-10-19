import { createDocument, MapStore, serializeLevel, WorldEditError } from '@smap/core';
import { describe, expect, it } from 'vitest';

import { LevelWorkspace } from './levelWorkspace';
import { MemoryFileSystem } from './memoryFs';
import { commitWorldPixelEdit, prepareWorldPixelEdit, type WorldPixelEditRequest } from './worldPixelEdits';

function setup() {
  const store = new MapStore(createDocument({ width: 4, height: 4, tilesets: [{ id: 'tiles', name: 'Tiles', imagePath: 'tiles.png', tileWidth: 32, tileHeight: 32, columns: 1, rows: 1, margin: 0, spacing: 0 }] }));
  const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } }); store.clearHistory();
  const ws = new LevelWorkspace({ name: 'World', levels: [{ id: 'a', name: 'A', path: 'levels/a.json', world: { x: 0, y: 0 } }], active: { id: 'a', store, knownText: null } });
  return { ws, layerId };
}

describe('world pixel edit loading contract', () => {
  it('loads and pins a disk-only participant, remaps its palette and registers one compound entry', async () => {
    const { ws, layerId } = setup(), fs = new MemoryFileSystem();
    const b = ws.add({ name: 'B', width: 4, height: 4, tileSize: 32, layerName: 'Ground' });
    const bLayer = ws.entry(b.id)!.store.document.layers[0]!.id;
    const request: WorldPixelEditRequest = { originMapId: 'a', pixelOperations: [], targets: [
      { mapId: 'a', layerId, cells: [{ x: 0, y: 0 }], tilesetId: 'tiles', tileId: 0 },
      { mapId: b.id, layerId: bLayer, cells: [{ x: 1, y: 0 }], tilesetId: 'tiles', tileId: 0 },
    ] };
    await ws.save(fs, { tilesetBytes: () => new Uint8Array([1]) });
    await ws.activate(b.id, fs); await ws.activate('a', fs);
    expect(ws.entry(b.id)).toBeUndefined();
    const plan = await prepareWorldPixelEdit(ws, fs, request);
    expect(plan.participants.every(p => !p.store.inTransaction)).toBe(true);
    commitWorldPixelEdit(ws, plan);
    expect(ws.history.undoDepth).toBe(1);
    expect(ws.history.peekUndo()!.participants).toHaveLength(2);
    ws.history.undo();
    expect(ws.entry(b.id)!.store.document.getLayer(bLayer)!.getCell(1, 0)).toBe(0);
    ws.history.redo();
    expect(ws.entry(b.id)!.store.document.getLayer(bLayer)!.getCell(1, 0)).not.toBe(0);
  });

  it('collects unreadable, hidden and locked blockers without opening a live transaction', async () => {
    const { ws, layerId } = setup();
    ws.active.store.dispatch({ type: 'setLayerProps', layerId, props: { visible: false, locked: true } });
    const before = serializeLevel(ws.active.store.document), entries = ws.history.entries();
    const request: WorldPixelEditRequest = { originMapId: 'a', pixelOperations: [], targets: [
      { mapId: 'a', layerId, cells: [{ x: 0, y: 0 }], tilesetId: 'tiles', tileId: 0 },
      { mapId: 'unreadable', layerId, cells: [], tilesetId: 'tiles', tileId: 0 },
    ] };
    const error = await prepareWorldPixelEdit(ws, null, request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorldEditError);
    expect((error as WorldEditError).blockers.map(b => b.reason)).toEqual(['load', 'locked', 'hidden']);
    expect(ws.active.store.inTransaction).toBe(false);
    expect(serializeLevel(ws.active.store.document)).toBe(before);
    expect(ws.history.entries()).toEqual(entries);
  });
});
