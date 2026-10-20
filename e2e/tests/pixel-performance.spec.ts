import { fileURLToPath } from 'node:url';
import { expect, test } from '../support/fixtures';
import type * as Core from '../../packages/core/src/index';
import { key, type Hook } from '../support/pixelHarness';

const corePath = `/@fs${fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))}`;

test('dense-map previews and scaled-atlas commits stay bounded and save the same pixels', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.evaluate(async path => {
    const c = await import(/* @vite-ignore */ path) as typeof Core;
    const id = 'edited-32x32-1', data = new Uint8Array(512 * 2048 * 4).fill(255), hash = c.rasterContentHash(512, 2048, data);
    const edited = { id, name: 'Edited', imagePath: c.editedImagePath(id, hash), tileWidth: 32, tileHeight: 32, columns: 16, rows: 64, margin: 0, spacing: 0, edited: { kind: 'pixel' as const, layoutVersion: 1 as const, nextTileId: 1024, contentHash: hash, origins: [] } };
    const source = { id: 'source', name: 'Source', imagePath: 'tilesets/source.png', tileWidth: 32, tileHeight: 32, columns: 1, rows: 1, margin: 0, spacing: 0 };
    const store = new c.MapStore(c.createDocument({ width: 512, height: 512, tileWidth: 32, tileHeight: 32, tilesets: [source, edited] }));
    const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } }), pi = store.getOrAddPaletteIndex('source', 0), ei = store.getOrAddPaletteIndex(id, 0), cells = [];
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) cells.push({ x, y, cell: x === 1 && y === 1 ? ei : pi });
    store.dispatch({ type: 'paintCells', layerId, cells });
    const files = [['project.smap', c.serializeProject({ name: 'Scaled pixels', levels: [{ id: 'a', name: 'A', path: 'levels/main.json' }], tilesets: [source, edited] })], ['levels/main.json', c.serializeLevel(store.document)], [source.imagePath, c.encodeRgbaPng(32, 32, new Uint8Array(32 * 32 * 4).fill(255))], [edited.imagePath, c.encodeRgbaPng(512, 2048, data)]] as const;
    for (const [path, bytes] of files) {
      const parts = path.split('/'), name = parts.pop()!; let dir = await navigator.storage.getDirectory();
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writer.write(typeof bytes === 'string' ? bytes : new Uint8Array(bytes)); await writer.close();
    }
  }, corePath);
  await page.keyboard.press('Control+o');
  await page.waitForFunction(() => !!(window as unknown as { __smap?: Hook }).__smap?.store);
  await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.setCamera(24, 48, 2));
  await key(page, 'm');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelUi.getState().pending)).toBe(false);
  const work = await page.evaluate(async path => {
    const c = await import(/* @vite-ignore */ path) as typeof Core;
    const h = (window as unknown as { __smap: Hook }).__smap, canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="map canvas"]')!;
    h.pixelColors.getState().setFg('#123456ff');
    const layer = h.store.document.getLayer(h.editor.getState().activeLayerId!)!, chunks = layer.chunks.bind(layer), getAsset = c.RasterAssets.prototype.getAsset;
    let scans = 0, atlasReads = 0; const reads: string[] = [];
    layer.chunks = function* () { scans++; yield* chunks(); };
    c.RasterAssets.prototype.getAsset = function (id) { atlasReads++; reads.push(new Error('atlas read').stack!); return getAsset.call(this, id); };
    try {
      const p = h.cellCenter(1, 1), frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, button: 0, buttons: 1, clientX: p.x, clientY: p.y }));
      await frame();
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, button: -1, buttons: 1, clientX: p.x + 2, clientY: p.y }));
      await frame(); const previewScans = scans;
      atlasReads = 0; reads.length = 0;
      canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, button: 0, buttons: 0, clientX: p.x + 2, clientY: p.y }));
      const commitAtlasReads = atlasReads;
      // Move the cursor keyline away before reading the painted framebuffer pixel.
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, button: -1, buttons: 0, clientX: p.x + 100, clientY: p.y + 100 }));
      await frame();
      const raster = h.store.rasterAssets.getTile('edited-32x32-1', 0)!;
      const gl = canvas.getContext('webgl2')!, pixel = new Uint8Array(4), box = canvas.getBoundingClientRect(), scale = canvas.width / box.width;
      gl.readPixels(Math.floor((p.x + 2 - box.left) * scale), canvas.height - 1 - Math.floor((p.y - box.top) * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return { previewScans, commitAtlasReads, reads, rgba: [...raster.data.slice((16 * 32 + 17) * 4, (16 * 32 + 18) * 4)], gpu: [...pixel], slots: h.store.document.getTileset('edited-32x32-1')!.edited!.nextTileId };
    } finally { layer.chunks = chunks; c.RasterAssets.prototype.getAsset = getAsset; }
  }, corePath);
  expect(work.previewScans).toBe(0); expect(work.commitAtlasReads, work.reads.join("\n")).toBe(0);
  expect(work.rgba).toEqual([18, 52, 86, 255]); expect(work.gpu).toEqual(work.rgba); expect(work.slots).toBe(1024);
  await key(page, 'Control+z');
  expect(await page.evaluate(() => [...(window as unknown as { __smap: Hook }).__smap.store.rasterAssets.getTile('edited-32x32-1', 0)!.data.slice((16 * 32 + 17) * 4, (16 * 32 + 18) * 4)])).toEqual([255, 255, 255, 255]);
  await key(page, 'Control+Shift+z'); await key(page, 'Control+s');
  const saved = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.getTileset('edited-32x32-1')!.imagePath);
  await expect.poll(async () => page.evaluate(async () => JSON.parse(await (await (await navigator.storage.getDirectory()).getFileHandle('project.smap')).getFile().then(f => f.text())).tilesets[1].imagePath)).toBe(saved);
  await page.reload(); await page.getByRole('button', { name: /^Aç/ }).click();
  await page.waitForFunction(() => !!(window as unknown as { __smap?: Hook }).__smap?.store);
  expect(await page.evaluate(() => [...(window as unknown as { __smap: Hook }).__smap.store.rasterAssets.getTile('edited-32x32-1', 0)!.data.slice((16 * 32 + 17) * 4, (16 * 32 + 18) * 4)])).toEqual(work.rgba);
});
