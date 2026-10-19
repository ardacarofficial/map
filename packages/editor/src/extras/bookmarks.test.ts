import { describe, expect, it } from 'vitest';
import { BookmarkRepository, clampBookmarkView } from './bookmarks';

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}
describe('camera bookmarks', () => {
  it('persists add, rename and delete per world and stable map id', () => {
    const s = storage(), r = new BookmarkRepository(s);
    r.write('world-a', 'map-id', [{ id: '1', name: 'Room', cx: 200, cy: 300, zoom: 2 }]);
    expect(new BookmarkRepository(s).read('world-a', 'map-id')[0]?.name).toBe('Room');
    expect(r.read('world-b', 'map-id')).toEqual([]);
    expect(r.read('world-a', 'another-id')).toEqual([]);
    r.write('world-a', 'map-id', [{ ...r.read('world-a', 'map-id')[0]!, name: 'Hall' }]);
    expect(new BookmarkRepository(s).read('world-a', 'map-id')[0]?.name).toBe('Hall');
    r.write('world-a', 'map-id', []);
    expect(new BookmarkRepository(s).read('world-a', 'map-id')).toEqual([]);
  });
  it('tolerates corrupt and unavailable storage, including invalid numeric views', () => {
    const s = storage(), r = new BookmarkRepository(s);
    r.write('w', 'm', []);
    const key = [...s.data.keys()][0]!;
    for (const value of ['{', 'null', '{}', '[null,{}, {"id":"x","name":"x","cx":0,"cy":0,"zoom":0}]']) {
      s.data.set(key, value);
      expect(new BookmarkRepository(s).read('w', 'm')).toEqual([]);
    }
    const blocked = new BookmarkRepository({ getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } });
    expect(blocked.read('w', 'm')).toEqual([]);
    expect(blocked.write('w', 'm', [{ id: 'x', name: 'Room', cx: 0, cy: 0, zoom: 1 }])).toBe(false);
    expect(blocked.read('w', 'm')).toHaveLength(1);
  });
  it('clamps a saved centre to resized map cell centres and clamps zoom', () => {
    expect(clampBookmarkView({ cx: 2000, cy: -20, zoom: 100 }, { width: 10, height: 6, tileWidth: 32, tileHeight: 16 })).toEqual({ cx: 304, cy: 8, zoom: 16 });
    expect(clampBookmarkView({ cx: 40, cy: 32, zoom: 2 }, { width: 10, height: 6, tileWidth: 32, tileHeight: 16 })).toEqual({ cx: 40, cy: 32, zoom: 2 });
  });
});
