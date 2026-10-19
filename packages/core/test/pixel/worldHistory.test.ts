import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDocument, MapStore, serializeLevel } from '../../src';
import { WorldHistory } from '../../src/pixel/worldHistory';

function setup() {
  const history = new WorldHistory();
  const maps = Array.from({ length: 3 }, (_, i) => {
    const store = new MapStore(createDocument({ width: 8, height: 8, tilesets: [{ id: 'tiles', name: 'Tiles', imagePath: 'tiles.png', tileWidth: 32, tileHeight: 32, columns: 8, rows: 1, margin: 0, spacing: 0 }] }));
    for (let tileId = 0; tileId < 8; tileId++) store.getOrAddPaletteIndex('tiles', tileId);
    const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
    store.clearHistory();
    history.register(String(i), store);
    return { store, layerId };
  });
  return { history, maps };
}
const snapshots = (maps: ReturnType<typeof setup>['maps']) => maps.map(m => serializeLevel(m.store.document));
function paint(map: ReturnType<typeof setup>['maps'][number], x = 0) {
  map.store.dispatch({ type: 'paintCells', layerId: map.layerId, cells: [{ x, y: 0, cell: x + 1 }] });
}

describe('chronological world history', () => {
  it('round trips interleaved gestures across at least three maps exactly', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 7 })), { maxLength: 60 }), actions => {
      const { history, maps } = setup();
      const initial = snapshots(maps);
      for (const [i, x] of [[0, 0], [1, 0], [2, 0], ...actions] as [number, number][]) paint(maps[i]!, x);
      const final = snapshots(maps), depth = history.undoDepth;
      for (let i = 0; i < depth; i++) expect(history.undo()).not.toBeNull();
      expect(snapshots(maps)).toEqual(initial);
      expect(history.undo()).toBeNull();
      for (let i = 0; i < depth; i++) expect(history.redo()).not.toBeNull();
      expect(snapshots(maps)).toEqual(final);
      expect(history.undoDepth).toBe(depth);
    }), { numRuns: 60 });
  });

  it('clears every local redo tail while preserving earlier undo entries', () => {
    const { history, maps } = setup();
    paint(maps[0]!); paint(maps[1]!); paint(maps[2]!);
    history.undo(); history.undo();
    paint(maps[0]!, 1);
    expect(history.redoDepth).toBe(0);
    expect(maps.map(m => m.store.redoDepth)).toEqual([0, 0, 0]);
    expect(history.undoDepth).toBe(2);
    history.undo(); history.undo();
    expect(maps[0]!.store.document.getLayer(maps[0]!.layerId)!.getCell(0, 0)).toBe(0);
  });

  it('validates all heads before undoing any compound participant, in reverse order', () => {
    const { history, maps } = setup();
    history.compound('0', () => { paint(maps[0]!); paint(maps[1]!); paint(maps[2]!); });
    expect(history.undoDepth).toBe(1);
    const order: string[] = [];
    maps.forEach((m, i) => m.store.subscribe(e => { if (e.cause === 'undo') order.push(String(i)); }));
    expect(history.undo()?.originMapId).toBe('0');
    expect(order).toEqual(['2', '1', '0']);
    history.redo();
    maps[0]!.store.beginTransaction();
    const before = snapshots(maps);
    expect(history.undo()).toBeNull();
    expect(snapshots(maps)).toEqual(before);
    maps[0]!.store.rollback();
    maps[1]!.store.clearHistory();
    expect(history.undoDepth).toBe(0); // explicit local reset invalidates dependencies
  });

  it('resets every dependency on participant deletion and detaches on close', () => {
    const { history, maps } = setup();
    paint(maps[0]!); paint(maps[1]!); history.undo();
    expect(history.dependsOn('1')).toBe(true);
    history.remove('1');
    expect(history.entries()).toEqual([]);
    expect(maps.map(m => m.store.undoDepth + m.store.redoDepth)).toEqual([0, 0, 0]);
    history.dispose(); paint(maps[2]!);
    expect(history.entries()).toEqual([]);
  });
  it('applies nothing when an externally replayed participant no longer matches its recorded head', () => {
    const { history, maps } = setup();
    history.compound('0', () => { paint(maps[0]!); paint(maps[1]!); paint(maps[2]!); });
    maps[0]!.store.undo();
    const before = snapshots(maps), revisions = maps.map(m => m.store.revision);
    expect(history.undo()).toBeNull();
    expect(snapshots(maps)).toEqual(before);
    expect(maps.map(m => m.store.revision)).toEqual(revisions);
  });

  it('includes synchronous project followers in one action with the original id', () => {
    const { history, maps } = setup();
    paint(maps[0]!);
    const id = history.peekUndo()!.id;
    history.includeFollowers('0', () => { paint(maps[1]!); paint(maps[2]!); });
    expect(history.undoDepth).toBe(1);
    expect(history.peekUndo()!.id).toBe(id);
    expect(history.peekUndo()!.participants).toHaveLength(3);
    expect(history.undo()).not.toBeNull();
    expect(maps.every(m => m.store.document.getLayer(m.layerId)!.getCell(0, 0) === 0)).toBe(true);
    expect(history.redo()).not.toBeNull();
  });

  it('clears external redo barriers globally without losing earlier undo actions', () => {
    const { history, maps } = setup();
    paint(maps[0]!); paint(maps[1]!); paint(maps[2]!);
    history.undo(); history.undo();
    maps[1]!.store.clearRedo();
    expect(history.undoDepth).toBe(1);
    expect(history.redoDepth).toBe(0);
    expect(maps.every(m => m.store.redoDepth === 0)).toBe(true);
    expect(history.undo()).not.toBeNull();
  });

  it('trims inaccessible world prefixes when a participant evicts its oldest entry', () => {
    const history = new WorldHistory();
    const store = new MapStore(createDocument({ width: 2, height: 2 }), { historyLimit: 2 });
    history.register('a', store);
    for (const name of ['A', 'B', 'C']) store.dispatch({ type: 'setMapProps', name });
    expect(history.undoDepth).toBe(2);
    expect(history.undo()).not.toBeNull(); expect(history.undo()).not.toBeNull();
    expect(history.undo()).toBeNull();
    expect(store.document.props.name).toBe('A');
  });

  it('matches a document-snapshot oracle through random undo, redo and new-edit branches', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 7 })), { maxLength: 70 }), commands => {
      const { history, maps } = setup();
      const states = [snapshots(maps)];
      let cursor = 0;
      for (const [command, i, x] of [[0, 0, 0], [0, 1, 0], [0, 2, 0], ...commands]) {
        if (command! < 3) {
          const before = history.undoDepth;
          paint(maps[i!]!, x!);
          if (history.undoDepth > before) { states.splice(cursor + 1); states.push(snapshots(maps)); cursor++; }
        } else if (command === 3) {
          expect(history.undo() !== null).toBe(cursor > 0);
          if (cursor > 0) cursor--;
        } else {
          expect(history.redo() !== null).toBe(cursor < states.length - 1);
          if (cursor < states.length - 1) cursor++;
        }
        expect(snapshots(maps)).toEqual(states[cursor]);
        expect([history.undoDepth, history.redoDepth]).toEqual([cursor, states.length - 1 - cursor]);
      }
    }), { numRuns: 60 });
  });

});
