import type { Page } from '@playwright/test';
import { confirmTilesetCard, dropFile, expect, readOpfsText, sampleBytes, test } from '../support/fixtures';

test.setTimeout(120_000);

const editorPath = '/src/state/editorStore.ts';
const sessionPath = '/src/io/session.ts';
async function prepare(page: Page) {
  await page.goto('/');
  await dropFile(page, 'body', 'overworld-32.png', sampleBytes('tilesets/overworld-32.png'));
  await confirmTilesetCard(page);
  await page.locator('[data-tileset-grid]').first().click({ position: { x: 16, y: 16 } });
}
async function paint(page: Page, x = 32, y = 24) {
  await page.keyboard.press('b');
  const point = await page.evaluate(({ x, y }) => {
    const hook = (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number; y: number } } }).__smap;
    return hook.cellCenter(x, y);
  }, { x, y });
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(async ({ path, x, y }) => {
    const { useEditorStore } = await import(/* @vite-ignore */ path);
    return useEditorStore.getState().project.store.document.layers[0].getCell(x, y);
  }, { path: editorPath, x, y })).not.toBe(0);
}
async function palette(page: Page, query: string) {
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill(query);
}
async function activeMap(page: Page) {
  return page.evaluate(async path => { const { useEditorStore } = await import(/* @vite-ignore */ path); return useEditorStore.getState().project.levelId; }, editorPath);
}
async function snapshot(page: Page) {
  return page.evaluate(async path => {
    const { useEditorStore } = await import(/* @vite-ignore */ path);
    const s = useEditorStore.getState();
    return { map: s.project.levelId, dirty: s.dirty, undo: s.project.store.undoDepth, region: s.region, entity: s.selectedEntityId };
  }, editorPath);
}
async function centred(page: Page, x: number, y: number) {
  await expect.poll(() => page.evaluate(({ x, y }) => {
    const hook = (window as unknown as { __smap: { handle: { captureView(): { cx: number; cy: number } }; store: { document: { map: { tileWidth: number; tileHeight: number } } } } }).__smap;
    const v = hook.handle.captureView(), m = hook.store.document.map;
    return Math.abs(v.cx - (x + 0.5) * m.tileWidth) + Math.abs(v.cy - (y + 0.5) * m.tileHeight);
  }, { x, y })).toBeLessThan(1);
}
async function addBookmark(page: Page, name: string) {
  await page.keyboard.press('Control+Shift+d');
  const dialog = page.locator('[data-dialog=text-prompt]');
  await dialog.getByLabel('Ad', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Ekle', exact: true }).click();
}

test('usages across two maps: context menu, counts, Enter/click, F3, stale refresh and no edit history', async ({ page }) => {
  await prepare(page);
  await paint(page);
  const a = await activeMap(page);
  await page.locator('[data-library-tab-button=project]').click();
  await page.getByRole('button', { name: 'Yeni harita', exact: true }).first().click();
  const dialog = page.locator('[data-dialog=new-level]');
  await dialog.getByLabel('Ad', { exact: true }).fill('Diğer oda');
  await dialog.getByRole('button', { name: 'Oluştur' }).click();
  const b = await activeMap(page);
  await paint(page);
  await page.keyboard.press('x');
  await paint(page, 33, 24);
  const before = await snapshot(page);
  await page.getByRole('tab', { name: 'Tileset', exact: true }).click();
  await page.locator('[data-tileset-grid]').first().click({ button: 'right', position: { x: 16, y: 16 } });
  await page.locator('[data-tile-menu-item=find-usages]').click();
  const results = page.locator('[data-tile-usages]');
  await expect(results.locator('[data-usage-result]')).toHaveCount(3);
  await expect(results).toContainText('Ana harita · 1 kullanım');
  await expect(results).toContainText('Diğer oda · 2 kullanım');
  await expect(results).toContainText('Yatay çevrilmiş');
  expect(await snapshot(page)).toEqual(before);
  await results.locator(`[data-usage-map="${a}"]`).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => activeMap(page)).toBe(a);
  await centred(page, 32, 24);
  await page.keyboard.press('F3');
  await expect.poll(() => activeMap(page)).toBe(b);
  await centred(page, 32, 24);
  await page.keyboard.press('F3');
  await centred(page, 33, 24);
  await page.keyboard.press('Shift+F3');
  await centred(page, 32, 24);
  await results.locator(`[data-usage-map="${a}"]`).click();
  await expect.poll(() => activeMap(page)).toBe(a);
  await paint(page, 31, 24);
  await expect(results).toContainText('Değişti — yenile');
  await expect(results.locator('[data-usage-result]').first()).toBeDisabled();
  await results.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(results.locator('[data-usage-result]')).toHaveCount(4);
  await results.getByRole('button', { name: 'Kapat', exact: true }).click();
  await palette(page, 'Kullanımları bul');
  await page.getByRole('option').filter({ hasText: 'Kullanımları bul…' }).click();
  await expect(results.locator('[data-usage-result]')).toHaveCount(4);
});

test('bookmarks: add, pan, quick jump, menu rename, reload, palette jump and delete; isolated per map', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const hook = (window as unknown as { __smap: { handle: { centerOn(x: number, y: number): void } } }).__smap;
    hook.handle.centerOn(20, 15);
  });
  const before = await snapshot(page);
  await addBookmark(page, 'Giriş');
  expect(await snapshot(page)).toEqual(before);
  // A real middle-button drag changes the camera.
  const canvas = page.locator('[data-canvas-host]');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' }); await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 80, { steps: 4 }); await page.mouse.up({ button: 'middle' });
  await page.keyboard.press('Control+1');
  await centred(page, 20, 15);
  await page.locator('[data-menu=view]').click();
  await page.locator('[data-submenu=bookmarks]').hover();
  await page.locator('[data-bookmark]').hover();
  await page.locator('[data-bookmark-action=rename]').click();
  const rename = page.locator('[data-dialog=text-prompt]');
  await rename.getByLabel('Ad', { exact: true }).fill('Ana giriş');
  await rename.getByRole('button', { name: 'Kaydet', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press('Control+s');
  await expect.poll(() => readOpfsText(page, 'project.smap')).not.toBeNull();
  await expect(page.getByLabel('Tüm değişiklikler kaydedildi')).toBeVisible();
  const mapFile = await readOpfsText(page, 'levels/main.json');
  expect(mapFile).not.toContain('Ana giriş');
  await page.reload();
  await page.getByRole('button', { name: /^Aç/ }).click();
  await expect.poll(() => page.evaluate(() => Object.hasOwn(window, '__smap'))).toBe(true);
  await palette(page, 'Yer imi Ana giriş');
  await page.locator('[role="option"][id^="command-bookmark:"]').filter({ hasText: 'Ana giriş' }).click();
  await centred(page, 20, 15);
  const clean = await snapshot(page);
  await page.locator('[data-library-tab-button=project]').click();
  await page.getByRole('button', { name: 'Yeni harita', exact: true }).first().click();
  const dialog = page.locator('[data-dialog=new-level]');
  await dialog.getByLabel('Ad', { exact: true }).fill('Boş oda');
  await dialog.getByRole('button', { name: 'Oluştur' }).click();
  await palette(page, 'Yer imi Ana giriş');
  await expect(page.locator('[role="option"][id^="command-bookmark:"]').filter({ hasText: 'Ana giriş' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('listbox', { name: 'Haritalar' }).getByRole('option', { name: 'Ana harita', exact: true }).dblclick();
  await palette(page, 'Yer imini sil Ana giriş');
  await page.locator('[role="option"][id^="command-bookmark-delete:"]').filter({ hasText: 'Ana giriş' }).click();
  await palette(page, 'Yer imi Ana giriş');
  await expect(page.locator('[role="option"][id^="command-bookmark:"]').filter({ hasText: 'Ana giriş' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await snapshot(page)).undo).toBe(clean.undo);
  // Persisted removal, including after a second reopen.
  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Tüm değişiklikler kaydedildi')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: /^Aç/ }).click();
  await expect.poll(() => page.evaluate(() => Object.hasOwn(window, '__smap'))).toBe(true);
  await palette(page, 'Yer imi Ana giriş');
  await expect(page.locator('[role="option"][id^="command-bookmark:"]').filter({ hasText: 'Ana giriş' })).toHaveCount(0);
});

test('unloaded maps scan in a worker, and palette slots expose the same usage search', async ({ page }) => {
  await prepare(page); await paint(page);
  await page.locator('[data-library-tab-button=project]').click();
  await page.getByRole('button', { name: 'Yeni harita', exact: true }).first().click();
  const dialog = page.locator('[data-dialog=new-level]');
  await dialog.getByLabel('Ad', { exact: true }).fill('Diskteki oda');
  await dialog.getByRole('button', { name: 'Oluştur' }).click();
  await paint(page);
  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Tüm değişiklikler kaydedildi')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: /^Aç/ }).click();
  await expect.poll(() => page.evaluate(() => Object.hasOwn(window, '__smap'))).toBe(true);
  // Reopening loads only the first map; preserve that cache throughout search.
  const cached = await page.evaluate(async path => { const { getLevelWorkspace } = await import(/* @vite-ignore */ path); return getLevelWorkspace().cachedIds(); }, sessionPath);
  expect(cached).toHaveLength(1);
  await page.getByRole('tab', { name: 'Tileset', exact: true }).click();
  await page.locator('[data-tileset-grid]').first().click({ position: { x: 16, y: 16 } });
  await palette(page, 'Kullanımları bul');
  await page.getByRole('option').filter({ hasText: 'Kullanımları bul…' }).click();
  await expect(page.locator('[data-usage-result]')).toHaveCount(2);
  expect(await page.evaluate(async path => { const { getLevelWorkspace } = await import(/* @vite-ignore */ path); return getLevelWorkspace().cachedIds(); }, sessionPath)).toEqual(cached);
  // Review #8: jump through real uncached activation and clean-store eviction.
  const results = page.locator('[data-tile-usages]');
  const target = await results.locator('[data-usage-result]').nth(1).getAttribute('data-usage-map');
  await results.locator('[data-usage-result]').nth(1).click();
  await expect.poll(() => activeMap(page)).toBe(target);
  await centred(page, 32, 24);
  await expect(results).not.toContainText('Değişti — yenile');
  await expect(results.locator('[data-usage-result]').first()).toBeEnabled();
  await page.keyboard.press('F3');await expect.poll(() => activeMap(page)).toBe(cached[0]);await centred(page,32,24);
  await page.keyboard.press('Shift+F3');await expect.poll(() => activeMap(page)).toBe(target);await centred(page,32,24);
  // Create a reference palette through the existing tileset menu.
  await page.locator('[data-tileset-grid]').first().click({ button: 'right', position: { x: 16, y: 16 } });
  await page.getByRole('menuitem', { name: /Palete ekle/ }).hover();
  await page.getByRole('menuitem', { name: /Yeni palet/ }).click();
  const prompt = page.locator('[data-dialog=text-prompt]');
  await prompt.getByLabel('Palet adı', { exact: true }).fill('Kısayollar');
  await prompt.getByRole('button', { name: /Oluştur/ }).click();
  await page.locator('[data-palette-grid]').first().click({ button: 'right', position: { x: 16, y: 16 } });
  await page.locator('[data-palette-menu-item=find-usages]').click();
  await expect(page.locator('[data-usage-result]')).toHaveCount(2);
});

test('bookmark jumps clamp after resizing, retain zoom, and are available in English', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void; handle: { centerOn(x: number, y: number): void } } }).__smap;
    h.setCamera(0, 0, 2); h.handle.centerOn(60, 44);
  });
  await palette(page, 'Yer imi ekle');
  await page.getByRole('option').filter({ hasText: 'Yer imi ekle…' }).click();
  const dialog = page.locator('[data-dialog=text-prompt]');
  await dialog.getByLabel('Ad', { exact: true }).fill('Uzak oda');
  await dialog.getByRole('button', { name: 'Ekle', exact: true }).click();
  await page.evaluate(async path => {
    const { useEditorStore } = await import(/* @vite-ignore */ path);
    useEditorStore.getState().project.store.dispatch({ type: 'resizeMap', width: 10, height: 8, offsetX: 0, offsetY: 0 });
  }, editorPath);
  const before = await snapshot(page);
  await page.keyboard.press('Control+1');
  await centred(page, 9, 7);
  expect(await snapshot(page)).toEqual(before);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: { handle: { captureView(): { zoom: number } } } }).__smap.handle.captureView().zoom)).toBe(2);
  await page.evaluate(async path => { const { setLocale } = await import(/* @vite-ignore */ path); setLocale('en'); }, '/src/i18n/index.ts');
  await page.locator('[data-menu=view]').click();
  await page.getByRole('menuitem', { name: 'Bookmarks', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: /Add bookmark/ })).toBeVisible();
  await page.locator('[data-bookmark]').hover();
  await page.getByRole('menuitem', { name: 'Go to bookmark', exact: true }).click();
  await centred(page, 9, 7);
});

test('selection searches mount bounded result pages and F3 crosses the page boundary', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async path => {
    const { useEditorStore } = await import(/* @vite-ignore */ path);
    const store = useEditorStore.getState().project.store;
    const id = store.document.tilesets[0].id;
    const cells = Array.from({ length: 64 }, (_, x) => ({ x, y: 24, cell: store.getOrAddPaletteIndex(id, x % 2) }));
    store.dispatch({ type: 'paintCells', layerId: store.document.layers[0].id, cells });
  }, editorPath);
  const grid = page.locator('[data-tileset-grid]').first();
  const box = (await grid.boundingBox())!;
  const scale = Number(await grid.getAttribute('data-tileset-scale'));
  await page.mouse.move(box.x + 16 * scale, box.y + 16 * scale);
  await page.mouse.down(); await page.mouse.move(box.x + 48 * scale, box.y + 16 * scale, { steps: 3 }); await page.mouse.up();
  await grid.click({ button: 'right', position: { x: 16 * scale, y: 16 * scale } });
  await page.locator('[data-tile-menu-item=find-usages]').click();
  const results = page.locator('[data-tile-usages]');
  await expect(results).toContainText('64 kullanım');
  await expect(results.locator('[data-usage-result]')).toHaveCount(50);
  await results.getByRole('button', { name: 'Sonraki sayfa', exact: true }).click();
  await expect(results.locator('[data-usage-result]')).toHaveCount(14);
  await results.locator('[data-usage-result="63"]').click();
  await page.keyboard.press('F3');
  await expect(results.locator('[data-usage-result="0"]')).toHaveAttribute('aria-current', 'location');
  await centred(page, 0, 24);
  await page.keyboard.press('Shift+F3');
  await expect(results.locator('[data-usage-result="63"]')).toHaveAttribute('aria-current', 'location');
  // Chunk scan ordering is deterministic within each sparse chunk.
  await centred(page, 63, 24);
});

test('usage search follows mixed tile and saved-stamp random brush candidates', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async ({ editorPath, randomPath, libraryPath }) => {
    const { useEditorStore } = await import(/* @vite-ignore */ editorPath);
    const { useRandomBrush } = await import(/* @vite-ignore */ randomPath);
    const { useProjectLibrary } = await import(/* @vite-ignore */ libraryPath);
    const store = useEditorStore.getState().project.store;
    const id = store.document.tilesets[0].id;
    const a = store.getOrAddPaletteIndex(id, 0), b = store.getOrAddPaletteIndex(id, 1);
    store.dispatch({ type: 'paintCells', layerId: store.document.layers[0].id, cells: [{ x: 20, y: 24, cell: a }, { x: 21, y: 24, cell: b }] });
    useProjectLibrary.setState({ stamps: [{ id: 'random-source', name: 'Aday', width: 1, height: 1, palette: [{ tilesetId: id, tileId: 1 }], layers: [{ layerId: 'source', name: 'Zemin', cells: new Uint32Array([1]) }] }] });
    useEditorStore.setState({ stamp: null, selection: { tilesetId: id, tileId: 0 }, randomSet: [] });
    useRandomBrush.setState({ stamps: [{ kind: 'stamp', stampId: 'random-source' }] });
  }, { editorPath, randomPath: '/src/commands/randomBrush.ts', libraryPath: '/src/io/projectLibrary.ts' });
  await palette(page, 'Kullanımları bul');
  await page.getByRole('option').filter({ hasText: 'Kullanımları bul…' }).click();
  await expect(page.locator('[data-usage-result]')).toHaveCount(1);
  await expect(page.locator('[data-usage-result]')).toHaveAttribute('data-usage-x', '21');
  await page.evaluate(async path => {
    const { useEditorStore } = await import(/* @vite-ignore */ path);
    useEditorStore.setState({ randomSet: [{ tilesetId: useEditorStore.getState().project.store.document.tilesets[0].id, tileId: 0 }] });
  }, editorPath);
  await palette(page, 'Kullanımları bul');
  await page.getByRole('option').filter({ hasText: 'Kullanımları bul…' }).click();
  await expect(page.locator('[data-usage-result]')).toHaveCount(2);
});
