import { createDocument, MapStore } from '@smap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRandomBrush } from '../commands/randomBrush';
import { useEditorStore } from '../state/editorStore';
import { useProjectLibrary } from '../io/projectLibrary';
import { LevelWorkspace } from '../io/levelWorkspace';
import { defaultLevels } from '../io/projectIo';
import { commandForEvent, runCommand } from '../commands/registry';
import { effectiveShortcuts, setShortcutOverrides } from '../shortcuts/shortcuts';
import { brushUsageTargets, closeTileUsages, findTileUsages, installUsageActions, jumpToUsage, useTileUsages } from './usageActions';

const deps = vi.hoisted(() => ({ workspace: null as unknown, open: vi.fn(async (_id: string) => true), center: vi.fn(), flash: vi.fn(), view: vi.fn() }));
vi.mock('../io/session', () => ({ getLevelWorkspace: () => deps.workspace, getProjectFolder: () => null, onProjectSaved: () => () => {}, openLevel: (id: string) => deps.open(id) }));
vi.mock('../ui/canvas/canvasHandle', () => ({ getCanvasHandle: () => ({ centerOn: deps.center, flashCell: deps.flash, setView: deps.view }) }));
vi.mock('../platform', () => ({ getPlatform: () => ({ onFileChanged: () => () => {} }) }));

let uninstall: (() => void) | undefined;
afterEach(() => { uninstall?.(); uninstall = undefined; useRandomBrush.setState({ stamps: [] }); closeTileUsages(); useEditorStore.getState().setProject(null); deps.workspace = null; vi.clearAllMocks(); setShortcutOverrides(new Map()); });
function setup() {
  const store = new MapStore(createDocument({ width: 8, height: 8, tilesets: [{ id: 'source', name: 'Source', imagePath: 'tilesets/source.png', tileWidth: 16, tileHeight: 16, columns: 2, rows: 2, margin: 0, spacing: 0 }] }));
  store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
  const levels = defaultLevels('levels/main.json');
  const ws = new LevelWorkspace({ name: 'World', levels, active: { id: levels[0]!.id, store, knownText: null } });
  deps.workspace = ws;
  useEditorStore.getState().setProject({ name: 'World', levelPath: 'levels/main.json', levelId: ws.activeId, store });
  useProjectLibrary.getState().load({ levels, stamps: [] });
  uninstall = installUsageActions();
  return { store, ws };
}
function paint(store: MapStore, x = 1) {
  const cell = store.getOrAddPaletteIndex('source', 0);
  store.dispatch({ type: 'paintCells', layerId: store.document.layers[0]!.id, cells: [{ x, y: 2, cell }] });
}
describe('usage commands', () => {
  it('jumps without operations or selection and invalidates on edit/undo', async () => {
    const { store } = setup(); paint(store);
    const undo = store.undoDepth;
    await findTileUsages([{ tilesetId: 'source', tileId: 0 }]);
    expect(useTileUsages.getState().results).toHaveLength(1);
    await jumpToUsage(0);
    expect(deps.center).toHaveBeenCalledWith(1, 2);
    expect(deps.flash).toHaveBeenCalledWith(1, 2);
    expect(useEditorStore.getState().region).toBeNull();
    expect(store.undoDepth).toBe(undo);
    paint(store, 3);
    expect(useTileUsages.getState().stale).toBe(true);
    deps.center.mockClear();
    await jumpToUsage(0);
    expect(deps.center).not.toHaveBeenCalled();
    runCommand('usage.refresh');
    await vi.waitFor(() => expect(useTileUsages.getState().status).toBe('ready'));
    expect(useTileUsages.getState().results).toHaveLength(2);
    store.undo();
    expect(useTileUsages.getState().stale).toBe(true);
  });
  it('resets results when switching worlds and honours F3 overrides', async () => {
    const { store } = setup(); paint(store);
    await findTileUsages([{ tilesetId: 'source', tileId: 0 }]);
    expect(commandForEvent({ key: 'F3', code: 'F3', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toBe('usage.next');
    expect(commandForEvent({ key: 'F3', code: 'F3', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false })).toBe('usage.previous');
    setShortcutOverrides(new Map([['usage.next', ['Ctrl+F3']]]));
    expect(commandForEvent({ key: 'F3', code: 'F3', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toBeNull();
    expect(commandForEvent({ key: 'F3', code: 'F3', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe('usage.next');
    deps.workspace = null;
    useEditorStore.getState().setProject(null);
    expect(useTileUsages.getState().status).toBe('idle');
  });
  it('has no shortcut collisions with existing global defaults', () => {
    const entries = effectiveShortcuts().filter(s => !s.scope);
    const newCommands = entries.filter(s => s.command.startsWith('bookmark.') || s.command.startsWith('usage.'));
    for (const command of newCommands) for (const key of command.keys) expect(entries.filter(s => s.keys.includes(key))).toEqual([command]);
  });
  it('queries selected brushes and random sets without copying tile data into UI state', () => {
    setup();
    const ref = { tilesetId: 'source', tileId: 0 };
    useEditorStore.getState().setSelection(ref);
    expect(brushUsageTargets()).toEqual([ref]);
    useEditorStore.setState({ stamp: { width: 1, height: 1, palette: [ref], layers: [{ layerId: 'x', name: 'x', cells: new Uint32Array([0x80000001]) }] } });
    expect(brushUsageTargets()).toEqual([ref]);
    useEditorStore.setState({ randomSet: [ref, { tilesetId: 'source', tileId: 3 }] });
    expect(brushUsageTargets()).toHaveLength(2);
    useProjectLibrary.setState({ stamps: [{ id: 'random-room', name: 'Room', width: 1, height: 1, palette: [{ tilesetId: 'source', tileId: 2 }], layers: [{ layerId: 'x', name: 'Ground', cells: new Uint32Array([1]) }] }] });
    useRandomBrush.setState({ stamps: [{ kind: 'stamp', stampId: 'random-room' }] });
    expect(brushUsageTargets()).toEqual([ref, { tilesetId: 'source', tileId: 3 }, { tilesetId: 'source', tileId: 2 }]);
  });
});
