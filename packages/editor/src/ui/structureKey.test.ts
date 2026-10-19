import { expect, it } from 'vitest';
import type { Tileset } from '@smap/core';
import { tilesetStructureKey } from './structureKey';
it('ignores edited content hashes while retaining layout, names and source paths', () => {
  const ts: Tileset = { id: 'edited-16x16-1', name: 'Edited', imagePath: 'tilesets/a.png', tileWidth: 16, tileHeight: 16, columns: 16, rows: 1, margin: 0, spacing: 0, edited: { kind: 'pixel', layoutVersion: 1, nextTileId: 1, contentHash: 'a'.repeat(64), origins: [] } };
  const key = tilesetStructureKey([ts]);
  expect(tilesetStructureKey([{ ...ts, imagePath: 'tilesets/b.png', edited: { ...ts.edited!, contentHash: 'b'.repeat(64) } }])).toBe(key);
  for (const change of [{ name: 'New' }, { rows: 2 }, { edited: { ...ts.edited!, nextTileId: 2 } }]) expect(tilesetStructureKey([{ ...ts, ...change }])).not.toBe(key);
  const { edited: _, ...source } = ts;
  expect(tilesetStructureKey([source])).not.toBe(tilesetStructureKey([{ ...source, imagePath: 'other.png' }]));
});
