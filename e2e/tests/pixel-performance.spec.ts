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
  await page.evaluate(async () => {
    (window as unknown as { __smap: Hook }).__smap.setCamera(24, 48, 2);
    const { useUiStore } = await import(/* @vite-ignore */ String('/src/ui/uiStore.ts'));
    useUiStore.getState().setActiveTileset('edited-32x32-1');
  });
  await expect(page.locator('[data-tileset-grid="edited-32x32-1"]')).toBeVisible();
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
      await frame(); await frame();
      h.store.undo(); await frame(); await frame();
      h.store.redo(); await frame(); await frame();
      // Move the cursor keyline away before reading the painted framebuffer pixel.
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, button: -1, buttons: 0, clientX: p.x + 100, clientY: p.y + 100 }));
      await frame();
      const raster = h.store.rasterAssets.getTile('edited-32x32-1', 0)!;
      // readPixels needs a fresh rendered frame: idle RAFs may discard the non-preserved drawing buffer.
      h.setCamera(24, 48, 2); await frame();
      const commitAtlasReads = atlasReads;
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

for (const size of [32,512]) test(`first-touch source-cell stroke stays bounded with ${size}-square cached world maps`, async ({ page }) => {
  test.setTimeout(180_000);
  const { open } = await import('../support/pixelHarness'); await open(page);
  await page.evaluate(async size => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    const { getLevelWorkspace } = await import(/* @vite-ignore */ String('/src/io/session.ts'));
    const ws = getLevelWorkspace();
    const { getProjectFolder } = await import(/* @vite-ignore */ String('/src/io/session.ts'));
    await ws.load('b', getProjectFolder().fs);
    const layerId = h.editor.getState().activeLayerId!;
    h.store.dispatch({type:'resizeMap',width:size,height:size});
    const pi = h.store.getOrAddPaletteIndex('source',0);
    const cells = Array.from({length:size*size},(_,i)=>({x:i%size,y:Math.floor(i/size),cell:pi}));
    h.store.dispatch({type:'paintCells',layerId,cells});
    const b = ws.entry('b').store;
    b.dispatch({type:'resizeMap',width:size,height:size}); const index = b.getOrAddPaletteIndex('source',0);
    b.dispatch({type:'paintCells',layerId:b.document.layers[0].id,cells:cells.map(c=>({...c,cell:index}))});
  }, size);
  await key(page,'m'); await expect.poll(() => page.evaluate(() => (window as unknown as {__smap: Hook}).__smap.pixelUi.getState().pending)).toBe(false);
  const result = await page.evaluate(async () => {
    const h = (window as unknown as {__smap: Hook}).__smap;
    const { getLevelWorkspace } = await import(/* @vite-ignore */ String('/src/io/session.ts'));
    const ws = getLevelWorkspace(), restores: (()=>void)[] = [], stacks: string[] = []; let slots = 0;
    for (const id of ws.cachedIds()) for (const layer of ws.entry(id).store.document.layers) {
      const chunks = layer.chunks.bind(layer); restores.push(()=>{layer.chunks=chunks;});
      layer.chunks=function*(){stacks.push(new Error('chunk scan').stack!);for(const chunk of chunks()){slots+=chunk.data.length;yield chunk;}};
    }
    try {
      h.pixelColors.getState().setFg('#123456ff');
      const p=h.cellCenter(0,0), canvas=document.querySelector<HTMLCanvasElement>('canvas[aria-label="map canvas"]')!;
      canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9,button:0,buttons:1,clientX:p.x,clientY:p.y}));
      await new Promise<void>(r=>requestAnimationFrame(()=>r())); slots=0; stacks.length=0;
      const start=performance.now();
      canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9,button:0,buttons:0,clientX:p.x,clientY:p.y}));
      const ms=performance.now()-start, commitSlots=slots;
      await new Promise<void>(r=>requestAnimationFrame(()=>r()));
      return {slots:commitSlots,stacks,ms,assets:h.store.rasterAssets.assetIds().length};
    } finally { for(const restore of restores)restore(); }
  });
  expect(result.slots,result.stacks.join('\n')).toBe(0); expect(result.assets).toBe(1);
  await test.info().attach('first-touch.json',{body:JSON.stringify({size,...result}),contentType:'application/json'});
});
