import { expect, it } from 'vitest';
import fc from 'fast-check';
import { ColorPaletteStore, parseColorPalette, serializeColorPalette } from '../src/pixel/palettes';
import { WorldHistory } from '../src/pixel/worldHistory';
import { createDocument } from '../src/document';
import { MapStore } from '../src/store';

it('palette operations undo/redo and deterministic save/load preserve ordered colours', () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 0xffffff }), { maxLength: 24 }), values => {
    const colors = values.map(n => `#${n.toString(16).padStart(6, '0')}ff`);
    const store = new ColorPaletteStore([]), history = new WorldHistory();
    history.register('a', new MapStore(createDocument({ width: 2, height: 2 })));
    store.dispatch({ type: 'add', palette: { name: 'Palette', colors } }, history, 'a', 'Palette');
    const saved = serializeColorPalette(store.palettes[0]!);
    expect(parseColorPalette(saved)).toEqual({ name: 'Palette', colors });
    expect(serializeColorPalette(parseColorPalette(saved))).toBe(saved);
    history.undo(); expect(store.palettes).toEqual([]);
    history.redo(); expect(serializeColorPalette(store.palettes[0]!)).toBe(saved);
  }));
});
it('palette edits interleave with map actions and discard redo chronologically', () => {
  const palettes = new ColorPaletteStore([]), history = new WorldHistory();
  const map = new MapStore(createDocument({ width: 2, height: 2 })); history.register('a', map);
  palettes.dispatch({ type: 'add', palette: { name: 'A', colors: ['#123456ff', '#ffffffff'] } }, history, 'a');
  map.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
  palettes.dispatch({ type: 'replace', index: 0, palette: { name: 'B', colors: ['#ffffffff', '#123456ff'] } }, history, 'a');
  history.undo(); expect(palettes.palettes[0]!.name).toBe('A');
  history.undo(); expect(map.document.layers).toHaveLength(0);
  history.undo(); expect(palettes.palettes).toEqual([]);
  history.redo(); history.redo(); history.redo(); expect(palettes.palettes[0]!.name).toBe('B');
  palettes.dispatch({ type: 'remove', index: 0 }, history, 'a'); history.undo();
  palettes.dispatch({ type: 'replace', index: 0, palette: { name: 'C', colors: [] } }, history, 'a');
  expect(history.canRedo).toBe(false);
});
it('rejects corrupt files and invalid operations without changing palettes or history', () => {
  const store = new ColorPaletteStore([]), history = new WorldHistory();
  for (const text of ['{', '{}', '{"version":2}', '{"version":1,"name":"","colors":[]}', '{"version":1,"name":"A","colors":["#bad"]}']) expect(() => parseColorPalette(text)).toThrow();
  expect(() => store.dispatch({ type: 'remove', index: 0 }, history, 'a')).toThrow();
  expect(store.palettes).toEqual([]); expect(history.undoDepth).toBe(0);
});

it('arbitrary palette edit sequences undo exactly and redo deterministically', () => {
  fc.assert(fc.property(fc.array(fc.record({ kind: fc.integer({ min: 0, max: 2 }), color: fc.integer({ min: 0, max: 0xffffff }) }), { maxLength: 40 }), operations => {
    const run = () => {
      const palettes = new ColorPaletteStore([]), history = new WorldHistory();
      history.register('a', new MapStore(createDocument({ width: 2, height: 2 })));
      for (const [i, op] of operations.entries()) {
        const palette = { name: `P${i}`, colors: [`#${op.color.toString(16).padStart(6, '0')}ff`] };
        palettes.dispatch(!palettes.palettes.length || op.kind === 0 ? { type: 'add', palette } : op.kind === 1 ? { type: 'replace', index: 0, palette } : { type: 'remove', index: 0 }, history, 'a');
      }
      const result = JSON.stringify(palettes.palettes), depth = history.undoDepth;
      for (let i = 0; i < depth; i++) expect(history.undo()).not.toBeNull();
      expect(palettes.palettes).toEqual([]);
      for (let i = 0; i < depth; i++) expect(history.redo()).not.toBeNull();
      expect(JSON.stringify(palettes.palettes)).toBe(result);
      return result;
    };
    expect(run()).toBe(run());
  }));
});
