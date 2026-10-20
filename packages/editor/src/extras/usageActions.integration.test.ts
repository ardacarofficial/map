import { MapStore, createDocument, serializeLevel, serializeProject, type PaletteEntry } from '@smap/core';
import { afterEach, expect, it, vi } from 'vitest';
import { browserPlatform, setPlatform, type ProjectFileChange } from '../platform';
import { MemoryFileSystem } from '../io/memoryFs';
import { closeProject, getLevelWorkspace, openProjectFromPicker, saveCurrentProject } from '../io/session';
import { useEditorStore } from '../state/editorStore';
import { setCanvasHandle } from '../ui/canvas/canvasHandle';
import type { CanvasHandle } from '../canvas';
import { runCommand } from '../commands/registry';
import { findTileUsages, installUsageActions, jumpToUsage, useTileUsages } from './usageActions';

// Node has no Worker/bitmap decoder. Keep filesystem, session, workspace activation and eviction real.
vi.mock('./usageWorker', () => ({ scanUsageFile: async (text: string, refs: readonly PaletteEntry[]) => {
 const { parseLevel, tileUsageBatches } = await import('@smap/core');
 return [...tileUsageBatches(parseLevel(text), refs)].flat();
} }));
let off: (() => void) | undefined;
afterEach(() => { off?.(); off = undefined; closeProject(); setCanvasHandle(null); setPlatform(browserPlatform); vi.unstubAllGlobals(); });

it('keeps results centred, flashed and F3-navigable through real uncached activation and history/cache bookkeeping', async () => {
 const fs = new MemoryFileSystem();
 const ts = { id: 'source', name: 'Source', imagePath: 'tilesets/source.png', tileWidth: 16, tileHeight: 16, columns: 1, rows: 1, margin: 0, spacing: 0 };
 const maps = ['a', 'b'].map(id => ({ id, name: id.toUpperCase(), path: `levels/${id}.json`, world: { x: 0, y: 0 } }));
 for (const [i, map] of maps.entries()) {
  const store = new MapStore(createDocument({ width: 32, height: 32, tileWidth: 16, tileHeight: 16, tilesets: [ts] }));
  const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
  store.dispatch({ type: 'paintCells', layerId, cells: [{ x: 4 + i, y: 7, cell: store.getOrAddPaletteIndex(ts.id, 0) }] });
  await fs.writeText(map.path, serializeLevel(store.document));
 }
 await fs.writeText('project.smap', serializeProject({ name: 'World', levels: maps, tilesets: [ts] }));
 await fs.writeBytes(ts.imagePath, Uint8Array.of(1));
 vi.stubGlobal('createImageBitmap', async () => ({ width: 16, height: 16, close() {} }));
 let diskChanged: ((change: ProjectFileChange) => void) | undefined;
 setPlatform({ ...browserPlatform, openProjectDialog: async () => ({ fs, ref: 'world', label: 'world' }),
  recents: { supported: false, list: async () => [], add: async () => {}, remove: async () => {}, open: async () => null },
  watchProject() {}, onFileChanged: cb => { diskChanged = cb; return () => {}; } });
 await openProjectFromPicker();
 const ws = getLevelWorkspace()!;
 expect(ws.cachedIds()).toEqual(['a']);
 const revision = ws.contentRevision;
 const center = vi.fn(), flash = vi.fn();
 setCanvasHandle({ setView: vi.fn(), centerOn: center, flashCell: flash } as unknown as CanvasHandle);
 off = installUsageActions();
 const search = () => findTileUsages([{ tilesetId: ts.id, tileId: 0 }]);
 await search();expect(useTileUsages.getState().results).toHaveLength(2);
 await jumpToUsage(1);
 expect(ws.activeId).toBe('b');expect(ws.cachedIds()).toEqual(['b']);
 expect(center).toHaveBeenLastCalledWith(5, 7);expect(flash).toHaveBeenLastCalledWith(5, 7);
 expect(useTileUsages.getState().stale).toBe(false);
 runCommand('usage.next');await vi.waitFor(() => expect(ws.activeId).toBe('a'));
 expect(center).toHaveBeenLastCalledWith(4, 7);expect(flash).toHaveBeenLastCalledWith(4, 7);
 runCommand('usage.previous');await vi.waitFor(() => expect(ws.activeId).toBe('b'));
 expect(useTileUsages.getState().stale).toBe(false);
 ws.history.reset();expect(useTileUsages.getState().stale).toBe(false);
 await saveCurrentProject(false);expect(useTileUsages.getState().stale).toBe(false);
 expect(ws.contentRevision).toBe(revision);
 // Content edits in an inactive cached map, including undo, still invalidate.
 await ws.load('a', fs);
 const other = ws.entry('a')!.store;
 other.dispatch({ type: 'paintCells', layerId: other.document.layers[0]!.id, cells: [{ x: 3, y: 3, cell: 1 }] });
 expect(useTileUsages.getState().stale).toBe(true);
 await search();ws.history.undo();expect(useTileUsages.getState().stale).toBe(true);
 await search();ws.rename('a', 'Renamed');expect(useTileUsages.getState().stale).toBe(true);
 await search();diskChanged!({ path: 'levels/a.json', kind: 'modified' });expect(useTileUsages.getState().stale).toBe(true);
 expect(useEditorStore.getState().project!.store).toBe(ws.active.store);
});
