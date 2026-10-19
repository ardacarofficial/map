import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Tileset } from '@smap/core';
import { TilesetAtlas } from './tilesetAtlas';

const ts: Tileset = { id: 'edited-16x16-1', name: 'Edited', imagePath: 'tilesets/a.png', tileWidth: 16, tileHeight: 16, columns: 16, rows: 1, margin: 0, spacing: 0, edited: { kind: 'pixel', layoutVersion: 1, nextTileId: 1, contentHash: '0'.repeat(64), origins: [] } };
afterEach(() => vi.unstubAllGlobals());
describe('incremental edited atlas', () => {
  it('keeps texture/UV identity on append and updates only touched slots with all extrusion edges', () => {
    const contexts: { drawImage: ReturnType<typeof vi.fn>; clearRect: ReturnType<typeof vi.fn>; imageSmoothingEnabled: boolean }[] = [];
    vi.stubGlobal('document', { createElement: () => { const context = { drawImage: vi.fn(), clearRect: vi.fn(), imageSmoothingEnabled: false }; contexts.push(context); return { width: 0, height: 0, getContext: () => context }; } });
    const image = {} as CanvasImageSource, atlas = new TilesetAtlas(ts, image);
    const uv = atlas.uv(0), page = atlas.pages[0];
    contexts[0]!.drawImage.mockClear();
    const bytes = atlas.updateTiles([{ assetId: ts.id, tileId: 1, x: 3, y: 4, width: 1, height: 1 }], { ...ts, edited: { ...ts.edited!, nextTileId: 2 } }, image);
    expect(atlas.pages[0]).toBe(page); expect(atlas.uv(0)).toEqual(uv);
    expect(contexts[0]!.drawImage).toHaveBeenCalledTimes(1);
    expect(contexts[0]!.clearRect).toHaveBeenCalledTimes(1);
    expect(bytes).toBeLessThanOrEqual(1024 * 1024 * 4);
    expect(atlas.layout.pages.every(p => p.width <= 1024 && p.height <= 1024)).toBe(true);
    atlas.destroy();
  });
});
