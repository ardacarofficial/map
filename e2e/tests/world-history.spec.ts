import type { Page } from '@playwright/test';
import { confirmTilesetCard, dropFile, expect, sampleBytes, test } from '../support/fixtures';

interface Hook {
  store: { document: { layers: { getCell(x: number, y: number): number }[] }; undoDepth: number };
  editor: { getState(): { project: { levelId: string }; setTool(tool: string): void } };
  cellCenter(x: number, y: number): { x: number; y: number };
}
async function cell(page: Page) { return page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.layers[0]!.getCell(32, 24)); }
async function paint(page: Page) {
  await page.keyboard.press('b');
  const point = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.cellCenter(32, 24));
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => cell(page)).not.toBe(0);
}
const row = (page: Page, name: string) => page.getByRole('listbox', { name: 'Haritalar' }).getByRole('option', { name });

async function prepareTwoMaps(page: Page) {
  await page.goto('/');
  await dropFile(page, 'body', 'overworld-32.png', sampleBytes('tilesets/overworld-32.png'));
  await confirmTilesetCard(page);
  const grid = page.getByRole('grid', { name: /overworld/i }).locator('.checker');
  await grid.click({ position: { x: 16, y: 16 } });
  await paint(page);
  await page.locator('[data-library-tab-button="project"]').click();
  await page.getByRole('button', { name: 'Yeni harita', exact: true }).first().click();
  const dialog = page.locator('[data-dialog="new-level"]');
  await dialog.getByLabel('Ad', { exact: true }).fill('B');
  await dialog.getByRole('button', { name: 'Oluştur' }).click();
  await expect(row(page, 'B')).toHaveAttribute('aria-selected', 'true');
  await paint(page);
}

test('world undo follows paint A, paint B in chronological order, switches maps and names history rows', async ({ page }) => {
  await prepareTwoMaps(page);
  await page.getByRole('tab', { name: 'Geçmiş', exact: true }).click();
  const history = page.locator('[data-history-panel]');
  await expect(history.getByRole('option').filter({ hasText: /Ana harita.*Boya/ })).toHaveCount(1);
  await expect(history.getByRole('option').filter({ hasText: /B · Boya/ })).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => cell(page)).toBe(0);
  await expect(row(page, 'B')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+z');
  await expect(row(page, 'Ana harita')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => cell(page)).toBe(0);
  await expect(history.locator('[data-history-state="undone"]')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => cell(page)).not.toBe(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(row(page, 'B')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => cell(page)).not.toBe(0);
  // Clicking the initial row uses the same world coordinator and switches back to A.
  await history.locator('[data-history-row="initial"]').click();
  await expect(row(page, 'Ana harita')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => cell(page)).toBe(0);
  await row(page, 'B').focus();
  await page.keyboard.press('F2');
  const rename = page.getByRole('listbox', { name: 'Haritalar' }).getByRole('textbox', { name: 'Yeniden adlandır' });
  await rename.fill('Yeni B');
  await rename.press('Enter');
  await expect(history.getByRole('option').filter({ hasText: 'Yeni B · Boya' })).toHaveCount(1);
});


test('deleting a participating map explicitly warns and clears world undo and redo', async ({ page }) => {
  await prepareTwoMaps(page);
  await page.keyboard.press('Control+z');
  await expect.poll(() => cell(page)).toBe(0);
  await page.getByRole('tab', { name: 'Geçmiş', exact: true }).click();
  const history = page.locator('[data-history-panel]');
  await expect(history.locator('[data-history-state="undone"]')).toHaveCount(1);
  const tab = page.getByRole('tab', { name: /^B .*Kapat: B$/ });
  await tab.click({ button: 'right' });
  await page.locator('[data-context-item="remove"]').click();
  const dialog = page.locator('[data-dialog="remove-level"]');
  await expect(dialog).toContainText('tüm geri alma ve yineleme geçmişi temizlenir');
  await dialog.getByRole('button', { name: 'Haritayı sil', exact: true }).click();
  await expect(row(page, 'B')).toHaveCount(0);
  await expect(row(page, 'Ana harita')).toHaveAttribute('aria-selected', 'true');
  await expect(history.locator('[data-history-row]')).toHaveCount(0);
  // A's paint remains; deletion clears history dependencies rather than undoing map contents.
  await expect.poll(() => cell(page)).not.toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => cell(page)).not.toBe(0);
});
