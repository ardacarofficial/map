import { inflateRawSync } from "node:zlib";
import { readFileSync } from 'node:fs';
import { expect, readOpfsText, test } from '../support/fixtures';
import { open, point, click, drag, color, rgba, gpuPixel, depth, key, type Hook } from '../support/pixelHarness';
test('pixel tools, HEX, COW, one undo per stroke, persistence, PNG export and source immutability', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const original = await open(page);
  await key(page, 'm'); await expect(page.getByRole('radio', { name: 'Piksel', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelUi.getState().pending)).toBe(false);
  await color(page, '#ff0044ff');
  const before = await depth(page); await drag(page, 1, 1, 4, 1);
  await expect.poll(() => rgba(page, 0, 0, 2, 1)).toEqual([255, 0, 68, 255]); expect(await depth(page)).toBe(before + 1); expect(await gpuPixel(page, 2, 1)).toEqual([255, 0, 68, 255]);
  expect(await rgba(page, 1, 0, 2, 1)).toEqual([255, 255, 255, 255]);
  await page.getByRole('spinbutton', { name: 'Boyut', exact: true }).fill('3'); await key(page, 'b'); await click(page, 8, 8);
  expect(await rgba(page, 0, 0, 7, 7)).toEqual([255, 0, 68, 255]);
  await key(page, 'e'); await click(page, 8, 8); expect(await rgba(page, 0, 0, 8, 8)).toEqual([0, 0, 0, 0]);
  await key(page, 'Control+z'); expect(await rgba(page, 0, 0, 8, 8)).toEqual([255, 0, 68, 255]);
  await key(page, 'Control+Shift+z'); expect(await rgba(page, 0, 0, 8, 8)).toEqual([0, 0, 0, 0]);
  await key(page, 'r'); await drag(page, 2, 2, 4, 4);
  await key(page, 'l'); await page.getByRole('spinbutton', { name: 'Boyut', exact: true }).fill('1'); await drag(page, 8, 0, 8, 15);
  await key(page, 'f'); await color(page, '#2244ffff'); await page.getByRole('radio', { name: 'Bitişik', exact: true }).click(); await click(page, 0, 0);
  expect(await rgba(page, 0, 0, 0, 0)).toEqual([34, 68, 255, 255]); expect(await rgba(page, 0, 0, 3, 3)).toEqual([255, 255, 255, 255]); expect(await rgba(page, 0, 0, 15, 15)).toEqual([255, 255, 255, 255]);
  await color(page, '#00ff88ff'); await page.getByRole('radio', { name: 'Tümü', exact: true }).click(); await click(page, 3, 3); expect(await rgba(page, 0, 0, 15, 15)).toEqual([0, 255, 136, 255]);
  await key(page, 'l'); await page.getByRole('spinbutton', { name: 'Boyut', exact: true }).fill('1'); await color(page, '#ff0044ff'); await drag(page, 2, 10, 6, 10); expect(await rgba(page, 0, 0, 4, 10)).toEqual([255, 0, 68, 255]);
  await key(page, 'r'); await drag(page, 10, 10, 13, 13); expect(await rgba(page, 0, 0, 11, 10)).toEqual([255, 0, 68, 255]);
  await page.getByRole('radio', { name: 'Dolu', exact: true }).click(); await drag(page, 10, 10, 13, 13); expect(await rgba(page, 0, 0, 11, 11)).toEqual([255, 0, 68, 255]);
  await key(page, 'i'); await click(page, 3, 1); expect(await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelColors.getState().fg)).toBe('#ff0044ff');
  await key(page, 'b'); await color(page, '#12345607'); await click(page, 14, 14); expect(await rgba(page, 0, 0, 14, 14)).toEqual([18, 52, 86, 7]);
  const savedPath = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.getTileset('edited-16x16-1')!.imagePath);
  await key(page, 'Control+s'); await expect.poll(() => readOpfsText(page, 'project.smap')).toContain(savedPath);
  const expected = await page.evaluate(() => { const h = (window as unknown as { __smap: Hook }).__smap; return [...h.store.rasterAssets.getTile('edited-16x16-1', 0)!.data]; });
  await page.reload(); await page.getByRole('button', { name: /^Aç/ }).click(); await expect(page.locator('canvas[aria-label="map canvas"]').first()).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __smap?: Hook }).__smap?.store);
  expect(await page.evaluate(() => [...(window as unknown as { __smap: Hook }).__smap.store.rasterAssets.getTile('edited-16x16-1', 0)!.data])).toEqual(expected);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelColors.getState().fg)).toBe('#12345607');
  await key(page, 'Control+e'); const dialog = page.getByRole('dialog'); await dialog.getByRole('radio', { name: 'PNG', exact: true }).click(); const download = page.waitForEvent('download'); await dialog.getByTestId('export-submit').click(); const png = [...readFileSync((await (await download).path())!)];
  expect(await page.evaluate(async bytes => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' })); const c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); return [...ctx.getImageData(3, 1, 1, 1).data]; }, png)).toEqual([255, 0, 68, 255]);
  expect(await page.evaluate(async () => { const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle('tilesets'); return [...new Uint8Array(await (await (await dir.getFileHandle('source.png')).getFile()).arrayBuffer())]; })).toEqual(original);
  await key(page, 'm'); await key(page, 'm'); await expect(page.getByRole('radio', { name: 'Tile', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('world scope updates another map atomically and blocked layers reject the entire stroke', async ({ page }) => {
  test.setTimeout(120_000); await open(page); await key(page, 'm'); await color(page, '#eedd11ff');
  await page.getByRole('combobox', { name: 'Kapsam', exact: true }).selectOption('world'); await click(page, 1, 1);
  expect(await rgba(page, 0, 0, 1, 1)).toEqual([238, 221, 17, 255]); expect(await rgba(page, 1, 0, 1, 1)).toEqual([238, 221, 17, 255]);
  await page.locator('[data-library-tab-button="project"]').click(); const maps = page.getByRole('listbox', { name: 'Haritalar' }); await maps.getByRole('option', { name: 'B', exact: true }).dblclick();
  await expect.poll(() => rgba(page, 0, 0, 1, 1)).toEqual([238, 221, 17, 255]);
  await page.evaluate(() => { const h = (window as unknown as { __smap: Hook }).__smap; h.store.dispatch({ type: 'setLayerProps', layerId: h.editor.getState().activeLayerId!, props: { locked: true } }); });
  await maps.getByRole('option', { name: 'A', exact: true }).dblclick(); await color(page, '#1122ffff'); await click(page, 2, 2);
  expect(await rgba(page, 0, 0, 2, 2)).toEqual([255, 255, 255, 255]); await expect(page.getByText(/B.*Katman kilitli/)).toBeVisible();
  await key(page, 'Control+z');
  await key(page, 'Control+z'); await expect.poll(() => rgba(page, 0, 0, 1, 1)).toEqual([255, 255, 255, 255]);
  await key(page, 'Control+Shift+z'); expect(await rgba(page, 0, 0, 1, 1)).toEqual([238, 221, 17, 255]);
});

test('warm 1/8/32 px strokes keep atlas UVs and pure pixel geometry stable', async ({ page }) => {
  test.setTimeout(120_000); await open(page); await key(page, 'm');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelUi.getState().pending)).toBe(false);
  const metrics = await page.evaluate(async () => {
    const h = (window as unknown as { __smap: Hook }).__smap, canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="map canvas"]')!;
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const results = [];
    for (const size of [1, 8, 32]) {
      h.pixelUi.getState().setSize(size);
      const p = h.cellCenter(2, 2), q = h.cellCenter(3, 2), scale = (q.x - p.x) / 16;
      for (let i = 0; i < 15; i++) {
        h.pixelColors.getState().setFg(i % 2 ? '#ee2244ff' : '#22ee44ff');
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 5, button: 0, buttons: 1, clientX: p.x, clientY: p.y }));
        canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 5, button: -1, buttons: 1, clientX: p.x + scale, clientY: p.y }));
        await frame();
        canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 5, button: 0, buttons: 0, clientX: p.x + scale, clientY: p.y }));
        await frame();
      }
      const m = h.pixelMetrics, commits = m.commitMs.slice(-10).sort((a, b) => a - b), plans = m.planMs.slice(-10).sort((a, b) => a - b);
      results.push({ size, planP50: plans[5], planP95: plans[9], commitP50: commits[5], commitP95: commits[9], bytes: m.pageBytesTouched, geometry: m.geometryBuilds });
    }
    const before = h.pixelMetrics.geometryBuilds; h.pixelColors.getState().setFg('#ffffffff');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 5, button: 0, buttons: 1, clientX: h.cellCenter(2, 2).x, clientY: h.cellCenter(2, 2).y }));
    await frame();
    canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 5 })); await frame();
    return { results, before, after: h.pixelMetrics.geometryBuilds };
  });
  console.log('PX1 warm strokes:', JSON.stringify(metrics));
  expect(metrics.after).toBe(metrics.before);
  // The strict time budget is measured against the production build in perf/pixel.perf.ts.
  for (const result of metrics.results) { expect(result.bytes).toBeGreaterThan(0); expect(Number.isFinite(result.planP50)).toBe(true); }
});

test('mode memory, stroke cancellation, background button, Alt/Shift sampling and blocked feedback', async ({ page }) => {
  test.setTimeout(120_000); await open(page); await key(page, 'm'); await color(page, '#ff0000ff');
  await key(page, 'b'); const initial = await depth(page), p = await point(page, 3, 3);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.keyboard.press('m'); await page.mouse.up();
  expect(await depth(page)).toBe(initial); expect(await rgba(page, 0, 0, 3, 3)).toEqual([255, 255, 255, 255]); expect(await gpuPixel(page, 3, 3)).toEqual([255, 255, 255, 255]);
  await key(page, 'm'); await page.getByRole('spinbutton', { name: 'Boyut', exact: true }).fill('3'); await key(page, 'e'); await key(page, 'm'); await key(page, 'm');
  await expect(page.locator('[data-tool-button="eraser"]')).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByRole('spinbutton', { name: 'Boyut', exact: true })).toHaveValue('3');
  await key(page, 'b'); await page.getByRole('radio', { name: 'Daire', exact: true }).click(); await click(page, 5, 5); expect(await rgba(page, 0, 0, 4, 4)).toEqual([255, 255, 255, 255]); await page.getByRole('radio', { name: 'Kare', exact: true }).click(); await page.getByRole('spinbutton', { name: 'Boyut', exact: true }).fill('1');
  await key(page, 'Shift+x'); expect(await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelColors.getState().bg)).toBe('#ff0000ff');
  await key(page, 'e'); await click(page, 6, 6, 'right'); expect(await rgba(page, 0, 0, 6, 6)).toEqual([255, 0, 0, 255]);
  await key(page, 'd'); expect(await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelColors.getState().fg)).toBe('#000000ff');
  await page.keyboard.down('Alt'); await page.keyboard.down('Shift'); await click(page, 5, 5); await page.keyboard.up('Shift'); await page.keyboard.up('Alt');
  expect(await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelColors.getState().fg)).toBe('#ff0000ff');
  await page.getByRole('switch', { name: 'Yatay eksen', exact: true }).click(); await page.getByRole('switch', { name: 'Dikey eksen', exact: true }).click(); await key(page, 'b'); await click(page, 7, 7);
  expect(await rgba(page, 3, 3, 8, 8)).toEqual([255, 0, 0, 255]); await color(page, '#0000ffff'); await key(page, 'f'); await click(page, 7, 7); expect(await rgba(page, 3, 3, 8, 8)).toEqual([0, 0, 255, 255]); expect(await gpuPixel(page, 56, 56)).toEqual([0, 0, 255, 255]);
  await page.evaluate(() => { const h = (window as unknown as { __smap: Hook }).__smap; h.store.dispatch({ type: 'setLayerProps', layerId: h.editor.getState().activeLayerId!, props: { locked: true } }); });
  const lockedDepth = await depth(page); await key(page, 'b'); await click(page, 9, 9); expect(await depth(page)).toBe(lockedDepth); expect(await rgba(page, 0, 0, 9, 9)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: { hintText: string } }).__smap.hintText)).toMatch(/kilitli/i);
  await key(page, 'h'); const hover = await point(page, 14, 12); await page.mouse.move(hover.x, hover.y); await expect(page.locator('[data-status-bar]')).toContainText('Piksel 14, 12');
});


test('Save As and project Zip include edited PNG revisions and every map', async ({ page }) => {
  test.setTimeout(120_000); await open(page); await key(page, 'm'); await color(page, '#118855ff'); await click(page, 1, 1); await key(page, 'Control+s');
  await expect.poll(() => readOpfsText(page, 'project.smap')).toContain('edited-16x16-1-');
  const project = JSON.parse((await readOpfsText(page, 'project.smap'))!) as { tilesets: { edited?: object; imagePath: string }[] };
  const path = project.tilesets.find(t => t.edited)!.imagePath;
  await key(page, 'Control+e'); const dialog = page.getByRole('dialog'); await dialog.getByRole('radio', { name: /zip/i }).click(); const downloading = page.waitForEvent('download'); await dialog.getByTestId('export-submit').click(); const archive = readFileSync((await (await downloading).path())!);
  const entries = new Map<string, Buffer>();
  for (let p = 0; archive.readUInt32LE(p) === 0x04034b50;) {
    const method = archive.readUInt16LE(p + 8), size = archive.readUInt32LE(p + 18), nameSize = archive.readUInt16LE(p + 26), extra = archive.readUInt16LE(p + 28), name = archive.subarray(p + 30, p + 30 + nameSize).toString(), start = p + 30 + nameSize + extra, body = archive.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(body) : body); p = start + size;
  }
  expect(entries.has(path)).toBe(true); expect(entries.has('levels/b.json')).toBe(true);
  await page.evaluate(() => { (window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('save-as', { create: true }); });
  await key(page, 'Control+Shift+s'); await expect.poll(() => readOpfsText(page, 'save-as/project.smap')).not.toBeNull(); expect(await readOpfsText(page, 'save-as/levels/b.json')).not.toBeNull();
  const copied = await page.evaluate(async path => { let dir = await navigator.storage.getDirectory(); for (const p of ['save-as', ...path.split('/').slice(0, -1)]) dir = await dir.getDirectoryHandle(p); const file = await (await dir.getFileHandle(path.split('/').at(-1)!)).getFile(); return [...new Uint8Array(await file.arrayBuffer())]; }, path);
  expect(copied).toEqual([...entries.get(path)!]);
});
