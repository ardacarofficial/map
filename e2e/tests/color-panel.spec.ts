import { readFileSync } from 'node:fs';
import { expect, readOpfsText, test } from '../support/fixtures';
import { open, click, key, rgba, point, type Hook } from '../support/pixelHarness';

test('Renk picker, fields, background, palette file round trip and world persistence', async ({ page }) => {
  test.setTimeout(180_000); await open(page); await key(page, 'm');
  const panel = page.locator('[data-color-panel]'); await expect(panel).toBeVisible();
  const square = panel.locator('[data-color-control=square]'), box = (await square.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 40, { steps: 6 }); await page.mouse.up();
  const chosen = await panel.getByRole('textbox', { name: 'HEX', exact: true }).inputValue(); expect(chosen).not.toBe('#000000ff');
  await expect(panel.locator('[data-color-recents] button')).toHaveCount(1);
  const hex = panel.getByRole('textbox', { name: 'HEX', exact: true }); await hex.fill('#2468acff');
  // Drafts leave the live picker untouched until committed.
  expect(await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelColors.getState().fg)).toBe(chosen);
  await hex.press('Enter'); await key(page, 'b'); await click(page, 2, 2); expect(await rgba(page, 0, 0, 2, 2)).toEqual([36, 104, 172, 255]);
  await key(page, 'Shift+x'); await click(page, 3, 2); expect(await rgba(page, 0, 0, 3, 2)).toEqual([255, 255, 255, 255]);
  await click(page, 4, 2, 'right'); expect(await rgba(page, 0, 0, 4, 2)).toEqual([36, 104, 172, 255]);
  await panel.getByRole('button', { name: 'Arka rengi düzenle', exact: true }).click();
  await panel.getByRole('button', { name: 'Yeni renk paleti', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Palet adı' }).fill('Deniz'); await panel.getByRole('textbox', { name: 'Palet adı' }).press('Enter');
  await panel.getByRole('button', { name: 'Renk ekle', exact: true }).click();
  const downloading = page.waitForEvent('download'); await panel.getByRole('button', { name: 'Renk paleti kaydet…', exact: true }).click();
  const download = await downloading, bytes = readFileSync((await download.path())!); expect(download.suggestedFilename()).toBe('Deniz.smap-colors.json');
  expect(JSON.parse(bytes.toString())).toEqual({ version: 1, name: 'Deniz', colors: ['#2468acff'] });
  await panel.getByRole('button', { name: 'Renk paletini sil', exact: true }).click();
  const chooser = page.waitForEvent('filechooser'); await panel.getByRole('button', { name: 'Renk paleti yükle…', exact: true }).click(); await (await chooser).setFiles({ name: 'Deniz.smap-colors.json', mimeType: 'application/json', buffer: bytes });
  await expect(panel.getByRole('textbox', { name: 'Palet adı' })).toHaveValue('Deniz');
  await expect(panel.locator('[aria-label="Palet renkleri"] button')).toHaveCount(1);
  await key(page, 'Control+s');
  await expect.poll(async () => {
    const text = await readOpfsText(page, 'project.smap');
    return text ? (JSON.parse(text) as { colorPalettes?: unknown }).colorPalettes : null;
  }).toEqual([{ name: 'Deniz', colors: ['#2468acff'] }]);
  await page.reload(); await page.getByRole('button', { name: /^Aç/ }).click(); await expect(page.locator('canvas[aria-label="map canvas"]').first()).toBeVisible(); await key(page, 'm');
  await expect(panel.getByRole('textbox', { name: 'Palet adı' })).toHaveValue('Deniz'); await expect(panel.locator('[aria-label="Palet renkleri"] button')).toHaveCount(1);
});

test('keyboard controls, numeric clamping, hue preservation, recent selection and eyedropper parity', async ({ page }) => {
  await open(page); await key(page, 'm'); const panel = page.locator('[data-color-panel]'), hex = panel.getByRole('textbox', { name: 'HEX', exact: true });
  await panel.getByRole('slider', { name: 'Doygunluk ve parlaklık' }).focus(); await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Shift+ArrowRight');
  const keyboardColor = await hex.inputValue(); expect(keyboardColor).not.toBe('#000000ff');
  await key(page, 'b'); await click(page, 1, 1); expect(await rgba(page, 0, 0, 1, 1)).toEqual([parseInt(keyboardColor.slice(1, 3), 16), parseInt(keyboardColor.slice(3, 5), 16), parseInt(keyboardColor.slice(5, 7), 16), 255]);
  await panel.getByRole('slider', { name: 'Ton', exact: true }).focus(); await page.keyboard.press('Shift+ArrowRight'); await expect(panel.getByRole('slider', { name: 'Ton', exact: true })).toHaveAttribute('aria-valuenow', '10');
  await hex.fill('#00ff0080'); await hex.press('Enter'); await expect(panel.getByRole('spinbutton', { name: 'Yeşil', exact: true })).toHaveValue('255'); await expect(panel.getByRole('spinbutton', { name: 'Alfa', exact: true })).toHaveValue('128');
  await panel.getByRole('spinbutton', { name: 'Kırmızı', exact: true }).fill('999'); await panel.getByRole('spinbutton', { name: 'Kırmızı', exact: true }).press('Enter'); await expect(hex).toHaveValue('#ffff0080');
  await panel.getByRole('radio', { name: 'HSL', exact: true }).click();
  await hex.fill('#ff0001ff'); await hex.press('Enter');
  await expect(panel.getByRole('slider', { name: 'Ton', exact: true })).toHaveAttribute('aria-valuenow', '359');
  await panel.getByRole('spinbutton', { name: 'Alfa', exact: true }).fill('128'); await panel.getByRole('spinbutton', { name: 'Alfa', exact: true }).press('Enter'); await expect(hex).toHaveValue('#ff000180');
  await panel.getByRole('spinbutton', { name: 'Ton', exact: true }).fill('217'); await panel.getByRole('spinbutton', { name: 'Ton', exact: true }).press('Enter');
  await panel.getByRole('spinbutton', { name: 'Doygunluk', exact: true }).fill('0'); await panel.getByRole('spinbutton', { name: 'Doygunluk', exact: true }).press('Enter'); await expect(panel.getByRole('spinbutton', { name: 'Ton', exact: true })).toHaveValue('217');
  await hex.fill('oops'); await hex.press('Enter'); await expect(hex).not.toHaveValue('oops');
  const beforeCancel = await hex.inputValue(); await hex.fill('#abcdefff'); await hex.press('Escape'); await expect(hex).toHaveValue(beforeCancel);
  await hex.fill('#eeddccff');
  const squareBox = (await panel.locator('[data-color-control=square]').boundingBox())!;
  await page.mouse.move(squareBox.x + 60, squareBox.y + 60); await page.mouse.down(); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(hex).toHaveValue('#eeddccff');
  await hex.fill('#123456ff'); await hex.press('Enter'); await key(page, 'b'); await click(page, 5, 5); await key(page, 'd'); await key(page, 'i'); await click(page, 5, 5); await expect(hex).toHaveValue('#123456ff');
  await panel.locator('[data-color-recents] button').filter({ has: page.locator('span') }).last().click(); expect(await hex.inputValue()).not.toBe('#123456ff');
});

test('palette rename, reorder, remove, undo/redo and corrupt file preserve world data', async ({ page }) => {
  await open(page); await key(page, 'm'); const panel = page.locator('[data-color-panel]'), hex = panel.getByRole('textbox', { name: 'HEX', exact: true });
  await panel.getByRole('button', { name: 'Yeni renk paleti', exact: true }).click();
  for (const color of ['#112233ff', '#445566ff']) { await hex.fill(color); await hex.press('Enter'); await panel.getByRole('button', { name: 'Renk ekle', exact: true }).click(); }
  const swatches = panel.locator('[aria-label="Palet renkleri"] button'); await swatches.last().click(); await panel.getByRole('button', { name: 'Rengi öne taşı', exact: true }).click(); await expect(swatches.first()).toHaveAttribute('aria-label', 'Renk #445566ff');
  await panel.getByRole('button', { name: 'Rengi sil', exact: true }).click(); await expect(swatches).toHaveCount(1); await key(page, 'Control+z'); await expect(swatches).toHaveCount(2); await key(page, 'Control+Shift+z'); await expect(swatches).toHaveCount(1);
  await page.getByRole('tab', { name: 'Geçmiş', exact: true }).click(); await expect(page.locator('[data-history-panel]')).toContainText('Renk paleti düzenle'); await page.getByRole('tab', { name: 'Renk', exact: true }).click();
  const chooser = page.waitForEvent('filechooser'); await panel.getByRole('button', { name: 'Renk paleti yükle…', exact: true }).click(); await (await chooser).setFiles({ name: 'bad.smap-colors.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"colors":["broken"]}') });
  await expect(page.getByText(/Renk paleti açılamadı/)).toBeVisible(); await expect(swatches).toHaveCount(1);
});

test('panel remembers its moved home and hidden state; mirror origin drags, cancels and resets', async ({ page }) => {
  await open(page); await key(page, 'm'); const panel = page.locator('[data-color-panel]'); await expect(panel).toBeVisible();
  const retained = panel.getByRole('textbox', { name: 'HEX', exact: true }); await retained.fill('#112233ff'); await retained.press('Enter');
  const tab = page.locator('[data-panel-tab=color]'); await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Taşı', exact: true }).hover(); await page.getByRole('menuitem', { name: 'Sol', exact: true }).click();
  await expect(page.locator('[data-dock-zone=left] [data-panel-slot=color]')).toBeVisible();
  await key(page, 'm'); await tab.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Gizle', exact: true }).click(); await expect(panel).not.toBeVisible();
  await key(page, 'm'); await expect(panel).toBeVisible(); await expect(page.locator('[data-dock-zone=left] [data-panel-slot=color]')).toBeVisible(); await expect(retained).toHaveValue('#112233ff');
  await tab.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Gizle', exact: true }).click(); await expect(panel).not.toBeVisible();
  await page.locator('[data-pixel-swatch=bg]').click(); await expect(panel).toBeVisible(); await expect(panel.getByRole('button', { name: 'Arka rengi düzenle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-pixel-swatch=fg]').click(); await expect(retained).toHaveValue('#112233ff'); await key(page, 'd');
  await page.getByRole('switch', { name: 'Yatay eksen', exact: true }).click(); await page.getByRole('switch', { name: 'Dikey eksen', exact: true }).click();
  const center = await point(page, 31.5, 31.5), moved = await point(page, 10, 12); await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(moved.x, moved.y); await page.mouse.up();
  await key(page, 'b'); await click(page, 9, 11); expect(await rgba(page, 0, 0, 11, 13)).toEqual([0, 0, 0, 255]);
  const cancel = await point(page, 20, 20); await page.mouse.move(moved.x, moved.y); await page.mouse.down(); await page.mouse.move(cancel.x, cancel.y); await page.keyboard.press('Escape'); await page.mouse.up();
  await page.getByRole('button', { name: 'Ayna merkezini sıfırla', exact: true }).click(); await click(page, 7, 7); expect(await rgba(page, 3, 3, 8, 8)).toEqual([0, 0, 0, 255]);
});

test('mirror preferences and half-pixel origin survive save, reopen and map-store replacement', async ({ page }) => {
  await open(page); await key(page, 'm');
  await page.getByRole('switch', { name: 'Yatay eksen', exact: true }).click();
  await page.getByRole('switch', { name: 'Dikey eksen', exact: true }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    h.pixelUi.getState().mirrorOrigins.set(h.store, { x: 10.5, y: 12 });
    h.pixelUi.setState(s => ({ originRevision: s.originRevision + 1 }));
  });
  await key(page, 'Control+s'); await page.reload(); await page.getByRole('button', { name: /^Aç/ }).click();
  await page.waitForFunction(() => !!(window as unknown as { __smap?: Hook }).__smap?.store);
  await expect.poll(() => page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap, s = h.pixelUi.getState();
    return { h: s.mirrorH, v: s.mirrorV, origin: s.mirrorOrigins.get(h.store) };
  })).toEqual({ h: true, v: true, origin: { x: 10.5, y: 12 } });
});
