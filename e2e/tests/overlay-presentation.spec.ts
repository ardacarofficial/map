import { openDockMap } from '../support/docking';
import { expect, test } from '../support/fixtures';

test('presentation evidence', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await openDockMap(page);
  await page.screenshot({ path: info.outputPath('editor.png') });
  await page.evaluate(async path => {
    const { toast } = await import(/* @vite-ignore */ path); toast.error('Uzun geri bildirim / Long feedback '.repeat(12));
  }, '/src/ui/toast/toastStore.ts');
  await expect(page.locator('[data-toaster] p')).toBeVisible();
  await expect(page.locator('[data-toaster] [role=alert]')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('feedback.png') });
  await page.locator('[data-rail=settings]').click();
  await page.locator('[data-command="settings.editShortcuts"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: info.outputPath('settings.png') });
  await page.locator('[data-settings-category=shortcuts]').click();
  await page.screenshot({ path: info.outputPath('shortcuts.png') });
  await page.keyboard.press('Escape');
  await page.locator('[data-export-open]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: info.outputPath('export.png') });
});
