import type { Locator, Page } from '@playwright/test';
import { open as openPixelMap, key as pixelKey, click as pixelClick, type Hook } from '../support/pixelHarness';
import { openDockMap } from '../support/docking';
import { expect, test } from '../support/fixtures';

async function inside(_page: Page, popup: Locator) {
  await expect(popup).toBeVisible();
  await expect.poll(async () => popup.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left >= 7.5 && r.top >= 7.5 && r.right <= innerWidth - 7.5 && r.bottom <= innerHeight - 7.5;
  })).toBe(true);
}
async function uncovered(action: Locator) {
  await action.scrollIntoViewIfNeeded();
  await expect.poll(() => action.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  })).toBe(true);
}
async function closeMenus(page: Page) {
  await page.mouse.move(1, 1);
  for (let depth = 0; depth < 4; depth++) {
    const before = await page.getByRole('menu').count();
    if (!before) return;
    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByRole('menu').count()).toBeLessThan(before);
  }
  await expect(page.getByRole('menu')).toHaveCount(0);
}
async function toast(page: Page) {
  await page.evaluate(async path => {
    const { toast } = await import(/* @vite-ignore */ path);
    toast.error('Uzun geri bildirim / Long feedback '.repeat(4));
  }, '/src/ui/toast/toastStore.ts');
}

for (const [width, height] of [[1024, 600], [1366, 768], [1920, 1080]] as const) {
  for (const deviceScaleFactor of [1, 1.5]) {
    for (const locale of ['tr', 'en']) {
      test.describe(`${width}x${height} @${deviceScaleFactor} ${locale}`, () => {
        test.use({ viewport: { width, height }, deviceScaleFactor, actionTimeout: 30_000 });
        test('overlay geometry, modal isolation, focus and feedback', async ({ page }, info) => {
          test.setTimeout(180_000);
          await openDockMap(page);
          await page.evaluate(async ({ path, locale }) => {
            const { setLocale } = await import(/* @vite-ignore */ path); setLocale(locale);
          }, { path: '/src/i18n/index.ts', locale });
          await page.evaluate(() => {
            const hook = (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap;
            hook.setCamera(0, 0, 1);
          });
          await expect(page.locator('[data-minimap]')).toBeVisible();
          await toast(page);
          await expect.poll(() => page.locator('[data-canvas-feedback]').evaluate(stack => {
            const r = stack.getBoundingClientRect();
            const c = stack.parentElement!.getBoundingClientRect();
            const mini = document.querySelector('[data-minimap]')!.getBoundingClientRect();
            return r.left >= c.left + 8 && r.right <= c.right - 8 && r.bottom <= c.bottom - 8 && (r.right <= mini.left - 7.5 || r.bottom <= mini.top - 7.5);
          })).toBe(true);
          await page.screenshot({ path: info.outputPath('feedback.png') });
          const message = page.locator('[data-toaster] p');
          await expect(message).toBeVisible();
          expect(await message.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
          const canvas = page.locator('[data-canvas-host] canvas').first();
          await canvas.focus();
          await page.locator('[data-tool-button=brush]').hover();
          await expect(page.getByRole('tooltip')).toBeVisible();
          await page.keyboard.press('Control+k');
          await expect(page.getByRole('tooltip')).toBeHidden();
          await inside(page, page.getByRole('dialog'));
          await uncovered(page.getByRole('option').first());
          await expect(page.locator('[data-toaster]:not([data-modal-feedback])')).toBeHidden();
          await page.keyboard.press('Escape');
          await expect.poll(() => page.evaluate(() => document.activeElement?.outerHTML), { timeout: 3000 }).toContain('aria-label="map canvas"');
          await page.locator('[data-rail=settings]').click();
          await page.locator('[data-command="settings.editShortcuts"]').click();
          const settings = page.getByRole('dialog');
          await inside(page, settings);
          await settings.locator('header button').hover();
          await inside(page, page.getByRole('tooltip'));
          await expect(page.getByRole('tooltip').locator('..')).toHaveAttribute('data-overlay-owner');
          await uncovered(settings.locator('footer button[type=submit]'));
          for (const category of ['general', 'appearance', 'panels', 'shortcuts', 'language', 'export', 'advanced']) {
            await page.locator(`[data-settings-category=${category}]`).click();
            await uncovered(settings.locator('footer button[type=submit]'));
            await expect(settings.getByRole('tabpanel')).toBeVisible();
          }
          await page.locator('[data-settings-category=shortcuts]').click();
          const row = settings.locator('[data-shortcut-row="tool.brush"]');
          await row.locator('button').first().click();
          await page.keyboard.press('Escape');
          await expect(settings).toBeVisible();
          await uncovered(row.locator('button').first());
          await toast(page);
          await expect(settings.locator('[data-modal-feedback]')).toBeVisible();
          await uncovered(settings.locator('footer button[type=submit]'));
          await settings.locator('[data-modal-feedback] button').last().click();
          await page.screenshot({ path: info.outputPath('settings.png') });
          await page.keyboard.press('Escape');
          await expect(page.locator('[data-rail=settings]')).toBeFocused();
          await page.locator('[data-export-open]').click();
          const exp = page.getByRole('dialog');
          await inside(page, exp);
          for (const target of ['unity', 'tmj', 'png', 'json', 'zip', 'godot', 'defold']) {
            await exp.locator(`input[value=${target}]`).check();
            await uncovered(exp.locator('footer button').last());
            await inside(page, exp.locator('header'));
            await uncovered(exp.locator('header button'));
          }
          await page.screenshot({ path: info.outputPath('export.png') });
          await page.keyboard.press('Escape');
          await expect(page.locator('[data-export-open]')).toBeFocused();
          for (const zone of ['left', 'right', 'bottom']) {
            await page.evaluate(async ({ path, zone }) => {
              const { useDockStore } = await import(/* @vite-ignore */ path);
              useDockStore.getState().move('tileset', { zone });
            }, { path: '/src/ui/layout/dockStore.ts', zone });
            const tab = page.locator('[data-panel-tab=tileset]');
            await tab.click({ button: 'right' });
            await inside(page, page.getByRole('menu'));
            await page.locator('[data-context-item=move]').hover();
            await inside(page, page.getByRole('menu').last());
            await uncovered(page.locator(`[data-context-item=move-${zone === 'left' ? 'right' : 'left'}]`));
            await closeMenus(page);
            await tab.focus();
            await page.keyboard.press('Shift+F10');
            await inside(page, page.getByRole('menu'));
            await page.keyboard.press('Escape');
            await expect(tab).toBeFocused();
          }
        });

        test('tooltips, inline form, edge submenus, pixel, usages, bookmarks and world', async ({ page }, info) => {
          test.setTimeout(300_000); // Includes screenshots and twelve pointer-crossed edge submenus on shared CI CPUs.
          await openDockMap(page);
          await page.evaluate(async ({ locale, editor, i18n }) => {
            const { setLocale } = await import(/* @vite-ignore */ i18n); setLocale(locale);
            const { useEditorStore } = await import(/* @vite-ignore */ editor);
            const store = useEditorStore.getState().project.store;
            store.dispatch({ type: 'setTilesetMeta', tilesetId: store.document.tilesets[0].id, name: 'Uzun kaynak adı / Long source name '.repeat(5), group: 'Uzun grup / Long group '.repeat(3).slice(0, 60) });
          }, { locale, editor: '/src/state/editorStore.ts', i18n: '/src/i18n/index.ts' });
          await page.locator('[data-tileset-switcher]').click();
          await page.screenshot({ path: info.outputPath('source-picker.png') });
          const group = page.locator('[data-switcher-group]').first();
          expect(await group.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
          await uncovered(page.locator('[data-tileset-option]').first());
          await page.keyboard.press('Escape');
          await expect(page.locator('[data-panel-tab=tileset]')).not.toHaveAttribute('title');
          const brush = page.locator('[data-tool-button=brush]');
          await brush.hover();
          const tooltip = page.getByRole('tooltip');
          const describedBy = await brush.evaluate(el => el.closest('[data-base-ui-tooltip-trigger]')?.getAttribute('aria-describedby')?.split(/\s+/).at(-1));
          expect(describedBy).toBeTruthy();
          const brushTooltip = page.locator(`[role="tooltip"][id="${describedBy}"]`);
          await inside(page, brushTooltip);
          await expect(brushTooltip).toHaveCSS('opacity', '1');
          const triggerRect = (await brush.boundingBox())!;
          const tipRect = (await brushTooltip.boundingBox())!;
          expect(tipRect.x >= triggerRect.x + triggerRect.width + 5.5 || tipRect.x + tipRect.width <= triggerRect.x - 5.5 || tipRect.y >= triggerRect.y + triggerRect.height + 5.5 || tipRect.y + tipRect.height <= triggerRect.y - 5.5).toBe(true);
          await page.screenshot({ path: info.outputPath('tooltip.png') });
          const grid = page.locator('[data-tileset-grid]').first();
          const r = (await grid.boundingBox())!;
          await page.mouse.move(r.x + 16, r.y + 16);
          await page.mouse.down(); await page.mouse.move(r.x + 48, r.y + 16, { steps: 3 }); await page.mouse.up();
          const save = page.locator('[data-action=saveClipStamp]');
          await expect(save).toBeVisible();
          await save.hover();
          await page.waitForTimeout(600); // Exercise the real 500 ms tooltip warm-up.
          await expect(tooltip).toBeHidden();
          await save.click();
          const inline = page.locator('[data-panel=inspector] form input');
          await expect(inline).toBeFocused();
          await expect(tooltip).toBeHidden();
          await page.screenshot({ path: info.outputPath('inline-stamp.png') });
          await page.keyboard.press('Escape');
          await expect(save).toBeFocused();
          for (const zone of ['left', 'right', 'bottom']) {
            await page.evaluate(async ({ path, zone }) => {
              const { useDockStore } = await import(/* @vite-ignore */ path);
              useDockStore.getState().move('tileset', { zone });
            }, { path: '/src/ui/layout/dockStore.ts', zone });
            // Fit is an explicit user action so edge probes start with the source visible
            // even after exercising the dock's hidden/collapsed transform retention.
            await page.locator('[data-tileset-zoom-fit]').click();
            const switcher = page.locator('[data-tileset-switcher]');
            await switcher.click();
            const picker = page.getByRole('dialog');
            await inside(page, picker);
            await uncovered(page.locator('[data-tileset-add]'));
            await page.keyboard.press('Escape');
            await expect(switcher).toBeFocused();
            const rect = (await grid.boundingBox())!;
            const host = (await page.locator(`[data-dock-zone=${zone}] [data-tileset-viewport]`).boundingBox())!;
            const left = Math.max(rect.x, host.x) + 8, right = Math.min(rect.x + rect.width, host.x + host.width) - 8;
            const top = Math.max(rect.y, host.y) + 8, bottom = Math.min(rect.y + rect.height, host.y + host.height, height - 24) - 8;
            for (const [x, y] of [[left, top], [right, top], [left, bottom], [right, bottom]]) {
              await page.mouse.click(x!, y!, { button: 'right' });
              await inside(page, page.getByRole('menu'));
              await page.locator('[data-tile-menu-item=palette]').hover();
              await inside(page, page.getByRole('menu').last());
              const action = page.locator('[data-palette-option]').last();
              await action.hover(); // Cross the actual submenu gap by pointer.
              await uncovered(action);
              await closeMenus(page);
            }
            await switcher.click();
            for (const state of ['collapsed', 'hidden', 'expanded']) {
              await page.evaluate(async ({ path, zone, state }) => {
                const { useDockStore } = await import(/* @vite-ignore */ path); useDockStore.getState().setZoneState(zone, state);
              }, { path: '/src/ui/layout/dockStore.ts', zone, state });
              await expect(page.getByRole('menu')).toHaveCount(0);
              await expect(page.getByRole('dialog')).toHaveCount(0);
            }
          }
          await page.evaluate(async path => { const { useDockStore } = await import(/* @vite-ignore */ path); useDockStore.getState().reset(); }, '/src/ui/layout/dockStore.ts');
          await page.locator('[data-pixel-mode] [role=radio]').last().click();
          const swatch = page.locator('[data-pixel-swatch=fg]');
          await swatch.click();
          const colors = page.locator('[data-color-panel]');
          await expect(colors).toBeVisible();
          await uncovered(colors.getByRole('textbox', { name: 'HEX', exact: true }));
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await page.screenshot({ path: info.outputPath('pixel-colors.png') });
          await page.locator('[data-pixel-mode] [role=radio]').first().click();
          await page.locator('[data-tileset-zoom-fit]').click();
          const firstCell = 16 * Number(await grid.getAttribute('data-tileset-scale'));
          await grid.click({ position: { x: firstCell, y: firstCell } });
          await page.evaluate(async path => {
            const { useEditorStore } = await import(/* @vite-ignore */ path);
            const store = useEditorStore.getState().project.store;
            const cell = store.getOrAddPaletteIndex(store.document.tilesets[0].id, 0);
            store.dispatch({ type: 'paintCells', layerId: store.document.layers[0].id, cells: [{ x: 32, y: 24, cell }] });
          }, '/src/state/editorStore.ts');
          await grid.click({ position: { x: firstCell, y: firstCell }, button: 'right' });
          await page.locator('[data-tile-menu-item=find-usages]').click();
          await expect(page.locator('[data-tile-usages]')).toBeVisible();
          await uncovered(page.locator('[data-usage-result]').first());
          await page.screenshot({ path: info.outputPath('usage-results.png') });
          await page.locator('[data-canvas-host]').focus();
          await page.keyboard.press('Control+Shift+d');
          const prompt = page.locator('[data-dialog=text-prompt]');
          await prompt.locator('input').fill('Uzun yer imi / Long bookmark '.repeat(2));
          await prompt.locator('button').last().click();
          await page.locator('[data-menu=view]').click();
          await page.locator('[data-submenu=bookmarks]').hover();
          await inside(page, page.locator('[data-bookmarks-menu]'));
          await page.locator('[data-bookmark]').hover();
          await inside(page, page.getByRole('menu').last());
          await uncovered(page.locator('[data-bookmark-action=jump]'));
          await page.screenshot({ path: info.outputPath('bookmarks.png') });
          await closeMenus(page);
          await page.locator('[data-rail=world]').click();
          await page.locator('[data-project-name]').click();
          await inside(page, page.getByRole('menu')); await uncovered(page.locator('[data-command="project.rename"]'));
          await page.screenshot({ path: info.outputPath('world-menu.png') });
          await page.keyboard.press('Escape'); await expect(page.locator('[data-project-name]')).toBeFocused();
        });
      });
    }
  }
}

test('overlay lifecycle: dock move, modal open, canvas gesture and source removal', async ({ page }) => {
  test.setTimeout(120_000);
  await openDockMap(page);
  const switcher = page.locator('[data-tileset-switcher]');
  await switcher.click();
  await page.evaluate(async path => {
    const { useDockStore } = await import(/* @vite-ignore */ path); useDockStore.getState().setZoneState('left', 'collapsed');
  }, '/src/ui/layout/dockStore.ts');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(async path => {
    const { useDockStore } = await import(/* @vite-ignore */ path); useDockStore.getState().setZoneState('left', 'expanded');
  }, '/src/ui/layout/dockStore.ts');
  await switcher.click();
  await page.evaluate(async path => {
    const { useUiStore } = await import(/* @vite-ignore */ path); useUiStore.getState().setPaletteOpen(true);
  }, '/src/ui/uiStore.ts');
  await expect(page.getByRole('combobox')).toBeFocused();
  await expect(page.locator('[data-tileset-switcher-search]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-rail=settings]').click();
  await expect(page.getByRole('menu')).toBeVisible();
  const canvas = page.locator('[data-canvas-host]');
  const bounds = (await canvas.boundingBox())!;
  // Native modal menus first dismiss through their outside-press backdrop.
  await page.mouse.click(bounds.x + 100, bounds.y + 100);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await canvas.click({ position: { x: 100, y: 100 } });
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-canvas-host]'))).toBe(true);
  await switcher.click();
  await canvas.click({ position: { x: 100, y: 100 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-canvas-host]'))).toBe(true);
  await switcher.click();
  await expect(page.locator('[data-tileset-switcher-search]')).toBeVisible();
  await canvas.hover({ position: { x: 100, y: 100 } });
  await page.mouse.wheel(0, -120);
  await expect(page.locator('[data-tileset-switcher-search]')).toHaveCount(0);
  await switcher.click();
  await page.evaluate(async path => {
    const { useEditorStore } = await import(/* @vite-ignore */ path);
    const store = useEditorStore.getState().project.store;
    store.dispatch({ type: 'removeTileset', tilesetId: store.document.tilesets[0].id });
  }, '/src/state/editorStore.ts');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});


test('narrow canvas feedback stacks above the minimap and yields to dialogs', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 800, height: 600 });
  // Keep the brief undo HUD visible while checking and capturing its placement.
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await openDockMap(page);
  await page.clock.pauseAt(new Date('2030-01-01T01:00:00Z'));
  await page.evaluate(() => {
    (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap.setCamera(0, 0, 1);
  });
  await page.clock.runFor(200);
  await expect(page.locator('[data-minimap]')).toBeVisible();
  await toast(page);
  await expect(page.locator('[data-toaster] p')).toBeVisible();
  await page.clock.runFor(200);
  await page.evaluate(async path => {
    const { useEditorStore } = await import(/* @vite-ignore */ path);
    const { project, activeLayerId } = useEditorStore.getState();
    project.store.dispatch({ type: 'setLayerProps', layerId: activeLayerId, props: { name: 'Katman / Layer' } });
    project.store.undo();
  }, '/src/state/editorStore.ts');
  await expect(page.locator('[data-undo-hud]')).toBeVisible();
  await page.clock.runFor(200);
  await expect.poll(() => page.locator('[data-canvas-feedback]').evaluate(stack => {
    const c = stack.parentElement!.getBoundingClientRect();
    const r = stack.getBoundingClientRect();
    const mini = document.querySelector('[data-minimap]')!.getBoundingClientRect();
    const hud = stack.querySelector('[data-undo-hud]')!.getBoundingClientRect();
    const notification = stack.querySelector('[role=alert]')!.getBoundingClientRect();
    return mini.left - c.left - 20 < 160 && r.left >= c.left + 8 && r.right <= c.right - 8
      && r.top >= c.top + 8 && r.bottom <= mini.top - 7.5
      && hud.height > 0 && hud.bottom <= notification.top - 7.5;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath('feedback-narrow.png') });
  await page.clock.resume();
  await page.locator('[data-rail=settings]').click();
  await page.locator('[data-command="settings.editShortcuts"]').click();
  const dialog = page.getByRole('dialog');
  await inside(page, dialog);
  await expect(page.locator('[data-canvas-feedback]')).toHaveCSS('visibility', 'hidden');
  await toast(page);
  await expect(dialog.locator('[data-modal-feedback]')).toBeVisible();
  await uncovered(dialog.locator('footer button[type=submit]'));
  await page.screenshot({ path: info.outputPath('modal-feedback.png') });
});

for (const [width, height] of [[1366, 768], [1024, 600]] as const) for (const deviceScaleFactor of [1, 1.5]) {
  test.describe(`pixel surfaces ${width}x${height} @${deviceScaleFactor}`, () => {
    test.use({ viewport: { width, height }, deviceScaleFactor, actionTimeout: 15_000 });
    test('Renk tooltips and PNG apply/restore keep modal ownership, geometry and focus', async ({ page }) => {
      test.setTimeout(120_000);
      await openPixelMap(page);
      await pixelKey(page, 'm');
      await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelUi.getState().pending)).toBe(false);
      await pixelClick(page, 1, 1);
      await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.tilesets.some(source => source.edited))).toBe(true);
      const colors = page.locator('[data-color-panel]');
      await expect(colors).toBeVisible();
      const add = colors.getByRole('button', { name: 'Yeni renk paleti', exact: true });
      await add.scrollIntoViewIfNeeded(); await add.hover();
      const tip = page.getByRole('tooltip');
      await inside(page, tip);
      const a = (await add.boundingBox())!, b = (await tip.boundingBox())!;
      expect(b.y + b.height <= a.y - 5.5 || b.y >= a.y + a.height + 5.5 || b.x + b.width <= a.x - 5.5 || b.x >= a.x + a.width + 5.5).toBe(true);
      await add.focus(); await page.keyboard.press('Escape');
      await expect(tip).toBeHidden(); await expect(add).toBeFocused();
      await add.click(); await expect(tip).toBeHidden();
      await expect(add).not.toHaveAttribute('title');
      for (const mode of ['applyPng', 'restorePng']) {
        const opener = page.getByRole('button', { name: 'Görünüm seçenekleri', exact: true });
        await opener.click();
        await inside(page, page.getByRole('menu'));
        await page.locator(`[data-command="pixel.${mode}"]`).click();
        const dialog = page.locator('[data-png-writeback-dialog]');
        await inside(page, dialog);
        await expect(dialog).toHaveAttribute('data-overlay-modal');
        await expect(tip).toBeHidden();
        await colors.locator('button[aria-label="Ön rengi düzenle"]').hover({ force: true });
        await expect(tip).toBeHidden();
        const close = dialog.locator('header button');
        await close.hover(); await inside(page, tip);
        await expect(tip.locator('..')).toHaveAttribute('data-overlay-owner', (await dialog.getAttribute('data-overlay-modal'))!);
        const c = (await close.boundingBox())!, t = (await tip.boundingBox())!;
        expect(t.x >= c.x + c.width + 5.5 || t.x + t.width <= c.x - 5.5 || t.y >= c.y + c.height + 5.5 || t.y + t.height <= c.y - 5.5).toBe(true);
        if (mode === 'restorePng') await dialog.getByRole('combobox', { name: 'PNG yedekleri', exact: true }).selectOption({ index: 1 });
        await expect(dialog.locator('[data-png-confirm]')).toBeEnabled();
        await uncovered(dialog.locator('[data-png-confirm]'));
        await page.mouse.move(1, 1);
        await dialog.locator('[data-png-confirm]').focus();
        await expect(tip).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
        if (mode === 'applyPng') {
          await opener.click(); await page.locator('[data-command="pixel.applyPng"]').click();
          await expect(dialog.locator('[data-png-confirm]')).toBeEnabled();
          await dialog.locator('[data-png-confirm]').click(); await expect(dialog).toBeHidden();
        }
      }
    });
  });
}
