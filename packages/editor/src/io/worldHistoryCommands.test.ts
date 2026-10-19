import { createDocument, MapStore } from '@smap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../state/editorStore';
import { LevelWorkspace } from './levelWorkspace';
import { activeWorldHistory, canMoveHistory, moveHistory } from './worldHistoryCommands';

const session = vi.hoisted(() => ({ ws: null as LevelWorkspace | null }));
vi.mock('./session', () => ({
  getLevelWorkspace: () => session.ws,
  publishLevelState: vi.fn(),
  openLevel: async (id: string) => {
    const entry = await session.ws!.activate(id, null), level = session.ws!.level(id)!;
    useEditorStore.getState().switchLevel({ name: 'World', store: entry.store, levelPath: level.path, levelId: id });
    return true;
  },
}));
afterEach(() => { session.ws?.dispose(); session.ws = null; useEditorStore.getState().setProject(null); });
function setup() {
  const store = new MapStore(createDocument({ width: 4, height: 4 }));
  const ws = new LevelWorkspace({ name: 'World', levels: [{ id: 'a', name: 'A', path: 'levels/a.json', world: { x: 0, y: 0 } }], active: { id: 'a', store, knownText: null } });
  session.ws = ws;
  useEditorStore.getState().setProject({ name: 'World', store, levelId: 'a', levelPath: 'levels/a.json' });
  return ws;
}

describe('world history commands', () => {
  it('one command undoes one latest action, activating its origin across three maps', async () => {
    const ws = setup();
    const b = ws.add({ name: 'B', width: 4, height: 4, tileSize: 32, layerName: 'Ground' });
    const c = ws.add({ name: 'C', width: 4, height: 4, tileSize: 32, layerName: 'Ground' });
    for (const id of ['a', b.id, c.id]) ws.entry(id)!.store.dispatch({ type: 'setMapProps', name: id });
    expect(await moveHistory('undo')).toBe(1);
    expect(useEditorStore.getState().project?.levelId).toBe(c.id);
    expect(await moveHistory('undo')).toBe(1);
    expect(useEditorStore.getState().project?.levelId).toBe(b.id);
    expect(await moveHistory('undo')).toBe(1);
    expect(useEditorStore.getState().project?.levelId).toBe('a');
    expect(ws.cachedIds().map(id => ws.entry(id)!.store.document.props.name)).toEqual(['', '', '']);
    expect(canMoveHistory('undo')).toBe(false);
    expect(canMoveHistory('redo')).toBe(true);
    expect(await moveHistory('redo', ws.history.entries().at(-1)!.id)).toBe(3);
    expect(useEditorStore.getState().project?.levelId).toBe(c.id);
  });

  it('leaves world history intact while undoing the stamp temporary document locally', async () => {
    const ws = setup();
    ws.active.store.dispatch({ type: 'setMapProps', name: 'World action' });
    const stamp = new MapStore(createDocument({ width: 2, height: 2 }));
    stamp.dispatch({ type: 'setMapProps', name: 'Stamp action' });
    useEditorStore.getState().switchLevel({ name: 'Stamp', store: stamp, levelId: 'stamp:one', levelPath: '' });
    expect(activeWorldHistory()).toBeNull();
    expect(await moveHistory('undo')).toBe(1);
    expect(stamp.document.props.name).toBe('');
    expect(ws.history.undoDepth).toBe(1);
    expect(ws.active.store.document.props.name).toBe('World action');
  });
});
