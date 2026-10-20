import { expect, it, vi } from 'vitest';
import { createDocument, MapStore, RasterAssets, rasterContentHash, prepareWorldEdit, applyWorldEdit, WorldHistory } from '../src';

const host = globalThis as unknown as { process: { cpuUsage(): { user: number; system: number } } };
const cpuMs = () => { const cpu = host.process.cpuUsage(); return (cpu.user + cpu.system) / 1000; };

it('patches a 1024-tile atlas without materializing it in dispatch or world simulation', () => {
  const data = new Uint8Array(512 * 2048 * 4).fill(255), id = 'edited-32x32-1';
  const hash = rasterContentHash(512, 2048, data);
  const ts = { id, name: 'Edited', imagePath: `tilesets/${id}-${hash}.png`, tileWidth: 32, tileHeight: 32, columns: 16, rows: 64, margin: 0, spacing: 0, edited: { kind: 'pixel' as const, layoutVersion: 1 as const, nextTileId: 1024, contentHash: hash, origins: Array.from({ length: 1024 }, (_, tileId) => ({ tileId, sourceTilesetId: 'source', sourceTileId: 0, sourcePixelHash: 'source-revision' })) } };
  const rasters = new RasterAssets(), store = new MapStore(createDocument({ width: 4, height: 4, tilesets: [ts] }), { rasterAssets: rasters });
  store.dispatch({ type: 'loadRasterAsset', asset: { assetId: id, tileWidth: 32, tileHeight: 32, columns: 16, rows: 64, data } });
  const history = new WorldHistory(); history.register('a', store);
  const materialize = vi.spyOn(RasterAssets.prototype, 'getAsset');
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const before = store.rasterAssets.getTile(id, 0)!.data.slice(0, 4), after = Uint8Array.of(i + 1, 2, 3, 255);
    const start = cpuMs();
    applyWorldEdit(history, prepareWorldEdit('a', [{ mapId: 'a', store, operations: [{ type: 'patchPixels', patches: [{ assetId: id, tileId: 0, x: 0, y: 0, width: 1, height: 1, before, after }] }] }]));
    if (i >= 4) samples.push(cpuMs() - start);
  }
  expect(materialize).not.toHaveBeenCalled(); materialize.mockRestore();
  // Warm commit p95 CPU budget, excluding load/first-touch source cloning and OS descheduling.
  expect(samples.sort((a, b) => a - b)[Math.floor(samples.length * .95)]).toBeLessThan(16);
  const current = store.document.getTileset(id)!;
  history.undo(); history.redo();
  expect(current.edited!.contentHash).toBe(rasterContentHash(512, 2048, store.rasterAssets.getAsset(id)!.data));
  expect(current.imagePath).toContain(current.edited!.contentHash);
});
