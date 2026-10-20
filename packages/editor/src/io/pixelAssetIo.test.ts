import { expect, it, vi } from 'vitest';
import { createDocument, MapStore } from '@smap/core';
import { installPixelAssets } from './pixelAssetIo';
import { clearTilesetImages, tilesetPngSource } from '../state/tilesetImages';
import { decodeEditedPng } from './editedPng';

it('publishes dirty pixel revisions without a full canvas and encodes the captured pages after later edits', async () => {
  const createElement = vi.fn(); vi.stubGlobal('document', { createElement });
  try {
    const store = new MapStore(createDocument({ width: 1, height: 1 }));
    const off = installPixelAssets(store);
    const slot = store.dispatch({ type: 'allocateEditedTile', tileWidth: 32, tileHeight: 32, pixels: new Uint8Array(32 * 32 * 4).fill(255) });
    const first = tilesetPngSource(slot.assetId);
    store.dispatch({ type: 'editTilePixels', assetId: slot.assetId, tileId: slot.tileId, x: 0, y: 0, width: 1, height: 1, after: Uint8Array.of(1, 2, 3, 7) });
    expect(createElement).not.toHaveBeenCalled();
    if (typeof first !== 'function') throw new Error('missing deferred snapshot');
    expect([...decodeEditedPng(await first()).data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    const last = tilesetPngSource(slot.assetId);
    if (typeof last !== 'function') throw new Error('missing deferred snapshot');
    expect([...decodeEditedPng(await last()).data.slice(0, 4)]).toEqual([1, 2, 3, 7]);
    off();
  } finally { clearTilesetImages(); vi.unstubAllGlobals(); }
});
