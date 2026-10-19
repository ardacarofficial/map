import { describe, expect, it } from 'vitest';
import { createDocument, MapStore } from '../../src';

describe('world coordinator MapStore APIs', () => {
  it('drops only redo, retaining stable undo ids and emitting a history notification', () => {
    const store = new MapStore(createDocument({ width: 2, height: 2 }));
    store.dispatch({ type: 'setMapProps', name: 'A' });
    const id = store.peekUndo()!.id;
    store.dispatch({ type: 'setMapProps', name: 'B' }); store.undo();
    const revision = store.revision;
    let events = 0; store.subscribe(e => { if (e.historyChanged) events++; });
    store.clearRedo();
    expect([store.undoDepth, store.redoDepth, store.peekUndo()!.id]).toEqual([1, 0, id]);
    expect(store.revision).toBe(revision); expect(events).toBe(1);
    store.undo(); expect(store.document.props.name).toBe('');
  });

  it('syncs metadata in place and creates siblings over exactly one raster dependency', () => {
    const store = new MapStore(createDocument({ width: 2, height: 2 }));
    store.dispatch({ type: 'setMapProps', name: 'Local A' });
    store.dispatch({ type: 'setMapProps', name: 'Local B' }); store.undo();
    const entries = store.historyEntries(), doc = store.document;
    const sibling = store.createSibling(createDocument({ width: 2, height: 2 }));
    sibling.dispatch({ type: 'addTileset', tileset: { id: 't', name: 'Meadow', imagePath: 't.png', tileWidth: 1, tileHeight: 1, columns: 1, rows: 1, margin: 0, spacing: 0 } });
    store.syncProjectData(sibling.document);
    expect(store.document).toBe(doc);
    expect(store.historyEntries()).toEqual(entries);
    expect(store.document.tilesets).toEqual(sibling.document.tilesets);
    expect(store.rasterAssets).toBe(sibling.rasterAssets);
    store.redo(); expect(store.document.props.name).toBe('Local B');
    store.undo(); store.undo(); expect(store.document.props.name).toBe('');
  });
});
