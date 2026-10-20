import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { openDockMap } from "../support/docking";

// These workflows deliberately save/reopen the modal and reload the editor repeatedly.
test.setTimeout(120_000);

async function openSettings(page: Page) {
  await expect(page.locator("[data-welcome-drop], [data-canvas-host]").first()).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.locator('[id="command-settings.editShortcuts"]').click();
  await expect(page.locator('[data-settings-category=general]')).toBeVisible();
  await expect(page.locator('[role=tabpanel] fieldset')).toBeVisible();
}
async function category(page: Page, id: string) { await page.locator(`[data-settings-category=${id}]`).click(); }
async function save(page: Page) {
  await page.getByRole("button", { name: "Kaydet ve uygula", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test("categories share a draft, keep focus and footer at short heights, and cancel invalid JSON", async ({ page }) => {
  await page.goto("/"); await openSettings(page);
  await expect(page.locator('[data-settings-category=general]')).toBeFocused();
  await page.keyboard.press("End"); await expect(page.locator('[data-settings-category=advanced]')).toBeFocused();
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown"); await expect(page.locator('[data-settings-category=appearance]')).toBeFocused();
  // 1366×768 at Windows 125%/150% leaves approximately these CSS viewports.
  for (const { width, height } of [{ width: 880, height: 600 }, { width: 1366, height: 768 }, { width: 1093, height: 614 }, { width: 911, height: 512 }]) {
    await page.setViewportSize({ width, height });
    for (const id of ["general", "appearance", "panels", "shortcuts", "language", "export", "advanced"]) {
      await category(page, id);
      const footer = await page.getByRole("button", { name: "Kaydet ve uygula", exact: true }).boundingBox();
      expect(footer!.y + footer!.height).toBeLessThan(height);
    }
  }
  const json = page.locator("#settings-json");
  await json.fill("{"); await page.getByRole("button", { name: "Kaydet ve uygula", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Geçersiz JSON");
  await category(page, "panels"); await expect(page.locator("#settings-section").getByRole("alert")).toContainText("JSON");
  await category(page, "advanced"); await expect(json).toHaveValue("{");
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await openSettings(page); await category(page, "advanced"); await expect(json).not.toHaveValue("{");
  await page.keyboard.press("Escape");
});

test("panel add moves Stamp'ler beside Recent, reorders, persists, resets and cancels preview", async ({ page }) => {
  await openDockMap(page); await openSettings(page); await category(page, "panels");
  await page.getByLabel("Alt: panel ekle", { exact: true }).selectOption("stamps");
  const bottom = page.locator('[data-settings-zone=bottom]');
  await expect(bottom.locator('[data-settings-panel]')).toHaveCount(2);
  await bottom.locator('[data-settings-panel=stamps]').getByLabel("Yukarı", { exact: true }).click();
  await expect(bottom.locator('[data-settings-panel]').first()).toHaveAttribute("data-settings-panel", "stamps");
  await save(page); await openDockMap(page);
  await expect(page.locator('[data-dock-zone=bottom] [data-panel-tab=stamps]')).toBeVisible();
  await openSettings(page); await category(page, "panels");
  await expect(bottom.locator('[data-settings-panel]').first()).toHaveAttribute("data-settings-panel", "stamps");
  await page.getByRole("button", { name: "Düzeni sıfırla", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-dock-zone=bottom] [data-panel-tab=stamps]')).toBeVisible();
  await openSettings(page); await category(page, "panels");
  await page.getByRole("button", { name: "Düzeni sıfırla", exact: true }).click(); await save(page); await openDockMap(page);
  await expect(page.locator('[data-dock-zone=left] [data-panel-tab=stamps]')).toBeVisible();
});

test("shortcut search, recording, conflict replacement, canvas dispatch and resets", async ({ page }) => {
  await openDockMap(page); await openSettings(page); await category(page, "shortcuts");
  const missing = await page.evaluate(async () => {
    // @ts-expect-error Vite source module.
    const { SHORTCUTS } = await import("/src/shortcuts/shortcuts.ts");
    // @ts-expect-error Vite source module.
    const { getCommand } = await import("/src/commands/registry.ts");
    return SHORTCUTS.filter((row: { command: string }) => row.command !== "view.pan" && !getCommand(row.command)).map((row: { command: string }) => row.command);
  });
  expect(missing).toEqual([]);
  await page.getByLabel("Kısayol ara", { exact: true }).fill("fırça");
  const brush = page.locator('[data-shortcut-row="tool.brush"]');
  await expect(brush).toBeVisible();
  await brush.getByRole("button", { name: "Tuş kaydet", exact: true }).click();
  await page.keyboard.press("Shift"); await page.keyboard.press("Escape");
  await expect(brush.getByRole("button", { name: "Tuş kaydet", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await brush.getByRole("button", { name: "Tuş kaydet", exact: true }).click(); await page.keyboard.press("Backspace");
  await expect(brush.locator("span.font-mono")).toHaveText("Atanmamış");
  await brush.getByRole("button", { name: "Tuş kaydet", exact: true }).click(); await page.keyboard.press("Space");
  await expect(page.getByRole("alert")).toContainText("ayrılmıştır");
  await brush.getByRole("button", { name: "Tuş kaydet", exact: true }).click();
  await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "@", code: "KeyQ", ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(event, "getModifierState", { value: (key: string) => key === "AltGraph" });
    window.dispatchEvent(event);
  });
  await expect(brush.locator("span.font-mono")).toHaveText("@");
  await brush.getByRole("button", { name: "Tuş kaydet", exact: true }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("alert")).toContainText("Komut paleti");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("alert").getByRole("button", { name: "Vazgeç", exact: true }).click();
  await brush.getByRole("button", { name: "Tuş kaydet", exact: true }).click(); await page.keyboard.press("e");
  await expect(page.getByRole("alert")).toContainText("Silgi");
  await expect(page.locator("[data-tool-button=brush]")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Değiştir", exact: true }).click();
  await category(page, "advanced");
  expect(JSON.parse(await page.locator("#settings-json").inputValue()).shortcuts).toEqual({ "tool.brush": ["E"], "tool.eraser": [] });
  await save(page);
  await page.locator("[data-tool-button=rect]").click(); await page.locator("[data-canvas-host]").focus(); await page.keyboard.press("e");
  await expect(page.locator("[data-tool-button=brush]")).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-tool-button=brush]").hover(); await expect(page.getByRole("tooltip")).toContainText("E");
  await page.keyboard.press("Control+k");
  await expect(page.locator('[id="command-tool.brush"]')).toContainText("E");
  await page.keyboard.press("Escape");
  await page.reload(); await openSettings(page); await category(page, "shortcuts");
  await page.getByLabel("Kısayol ara", { exact: true }).fill("kalem"); await brush.getByRole("button", { name: "Sıfırla", exact: true }).click();
  await page.getByRole("button", { name: "Tüm kısayolları sıfırla", exact: true }).click();
  await expect(page.getByText("Tüm kısayol değişiklikleri sıfırlansın mı?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tüm kısayolları sıfırla", exact: true }).click();
  await page.getByLabel("Kısayol ara", { exact: true }).fill("Görünüm");
  await expect(page.locator('[data-shortcut-row="view.pan"]')).toBeVisible();
  await page.getByLabel("Kısayol ara", { exact: true }).fill("boşluk");
  await expect(page.locator('[data-shortcut-row="view.pan"]')).toContainText("Sabit");
  await expect(page.locator('[data-shortcut-row="view.pan"]').getByRole("button")).toHaveCount(0);
  await save(page);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("smap.settings")!).shortcuts)).toEqual({});
});

test("language native names preview, cancel and persist both directions", async ({ page }) => {
  await page.goto("/"); await openSettings(page); await category(page, "language");
  await page.locator("#settings-locale").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Translation completeness: 100%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await openSettings(page); await category(page, "language"); await page.locator("#settings-locale").selectOption("en");
  await page.getByRole("button", { name: "Save and apply", exact: true }).click(); await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await openSettings(page); await category(page, "language"); await page.locator("#settings-locale").selectOption("tr"); await save(page); await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
});

test("delayed load keeps sidebar focus; write failure and in-flight save retain the draft", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to browser checks.
    const platform = await import("/src/platform/index.ts");
    const original = platform.getPlatform();
    const w = window as unknown as { finishSettingsRead(): void; finishSettingsWrite(): void };
    const ready = new Promise<void>(resolve => { w.finishSettingsRead = resolve; });
    platform.setPlatform({ ...original, readSettings: async () => { await ready; return '{"locale":"tr","shortcuts":{}}'; }, writeSettings: () => new Promise((_resolve, reject) => { w.finishSettingsWrite = () => reject(Error("test disk full")); }) });
  });
  await page.keyboard.press("Control+k"); await page.locator('[id="command-settings.editShortcuts"]').click();
  await expect(page.getByText("Ayarlar yükleniyor…", { exact: true })).toBeVisible();
  await category(page, "language");
  await page.evaluate(() => (window as unknown as { finishSettingsRead(): void }).finishSettingsRead());
  await expect(page.locator("#settings-locale")).toBeEnabled();
  await expect(page.locator('[data-settings-category=language]')).toBeFocused();
  await page.locator("#settings-locale").selectOption("en");
  await page.getByRole("button", { name: "Save and apply", exact: true }).click();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finishSettingsWrite?: unknown }).finishSettingsWrite)).toBe("function");
  await page.evaluate(() => (window as unknown as { finishSettingsWrite(): void }).finishSettingsWrite());
  await expect(page.getByRole("alert")).toContainText("Check access permissions and available disk space");
  await expect(page.getByRole("alert")).not.toContainText("test disk full");
  await expect(page.locator("#settings-locale")).toHaveValue("en");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
});

test("narrow category select, export defaults and panel removal keep usable focus", async ({ page }) => {
  await openDockMap(page); await openSettings(page); await category(page, "panels");
  const entities = page.locator('[data-settings-panel=entities]');
  await expect(entities).toContainText("Yalnız Entity");
  await entities.getByRole("button", { name: "Gizle", exact: true }).click();
  await expect(page.getByText(/Gizli paneller:/)).toContainText("Entity");
  await expect(page.locator("[role=dialog]")).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('[role=dialog]') !== null)).toBe(true);
  await page.getByLabel("Alt: panel ekle", { exact: true }).selectOption("entities");
  await expect(page.locator('[data-settings-zone=bottom] [data-settings-panel=entities]')).toBeVisible();
  await page.setViewportSize({ width: 500, height: 600 });
  const categories = page.getByRole("combobox", { name: "Ayar kategorileri", exact: true });
  await expect(page.getByRole("tablist", { name: "Ayar kategorileri" })).toBeHidden();
  await categories.selectOption("export");
  await expect(page.getByRole("switch", { name: "Kaydederken Unity’ye aktar", exact: true })).toBeDisabled();
  await page.getByRole("switch", { name: "Unity collision", exact: true }).click();
  await categories.selectOption("general"); await categories.selectOption("export");
  await expect(page.getByRole("switch", { name: "Unity collision", exact: true })).not.toBeChecked();
  await save(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDockMap(page);
  await openSettings(page); await category(page, "export");
  await expect(page.getByRole("switch", { name: "Unity collision", exact: true })).not.toBeChecked();
});

test("ruler preview cancels; split, merge and zone controls edit the existing dock", async ({ page }) => {
  await openDockMap(page); await openSettings(page); await category(page, "appearance");
  const rulers = page.getByRole("switch", { name: "Cetveller", exact: true });
  await expect(rulers).toBeChecked(); await rulers.click();
  await category(page, "advanced"); expect(JSON.parse(await page.locator("#settings-json").inputValue()).layout.rulersVisible).toBe(false);
  await page.keyboard.press("Escape");
  await openSettings(page); await category(page, "appearance"); await expect(rulers).toBeChecked();
  await category(page, "panels");
  const stamps = page.locator('[data-settings-panel=stamps]');
  await stamps.getByRole("button", { name: "Bölümü ayır", exact: true }).click();
  await expect(page.locator('[data-settings-zone=left] [data-settings-group]')).toHaveCount(2);
  await stamps.getByRole("button", { name: "Sekme olarak birleştir", exact: true }).click();
  await expect(page.locator('[data-settings-zone=left] [data-settings-group]')).toHaveCount(1);
  await stamps.getByRole("combobox").selectOption("right");
  await expect(page.locator('[data-settings-zone=right] [data-settings-panel=stamps]')).toBeVisible();
  await page.getByRole("combobox", { name: "Sağ: görünürlük", exact: true }).selectOption("collapsed");
  await page.screenshot({ path: test.info().outputPath("settings-panels.png") });
  await save(page); await openSettings(page); await category(page, "panels");
  await expect(page.getByRole("combobox", { name: "Sağ: görünürlük", exact: true })).toHaveValue("collapsed");
});

test("shortcut recorder respects scopes and displays the tileset panel scope", async ({ page }) => {
  await openDockMap(page); await openSettings(page); await category(page, "shortcuts");
  const search = page.getByLabel("Kısayol ara", { exact: true });
  await search.fill("Tileset paneli");
  const rename = page.locator('[data-shortcut-row="tileset.rename"]');
  await expect(rename).toContainText("Tileset paneli");
  await expect(page.locator('[data-shortcut-row="edit.copy"]')).toHaveCount(0);
  await rename.getByRole("button", { name: "Tuş kaydet", exact: true }).click();
  await page.keyboard.press("Control+c");
  const conflict = page.getByRole("alert");
  await expect(conflict.locator("p")).toHaveText("Bu tuş kullanılıyor: Referansları kopyala");
  await conflict.getByRole("button", { name: "Değiştir", exact: true }).click();
  await expect(page.locator('[data-shortcut-row="tileset.copy"] span.font-mono')).toHaveText("Atanmamış");
  await search.fill("");
  const copy = page.locator('[data-shortcut-row="edit.copy"]');
  await copy.getByRole("button", { name: "Tuş kaydet", exact: true }).click();
  await page.keyboard.press("Control+c");
  await expect(conflict).toHaveCount(0);
  await expect(copy.locator("span.font-mono")).toHaveText("Ctrl C");
  await save(page);
  await page.reload(); await openSettings(page); await category(page, "shortcuts");
  await expect(rename.locator("span.font-mono")).toHaveText("Ctrl C");
  await expect(copy.locator("span.font-mono")).toHaveText("Ctrl C");
});

test("export default target and registry options persist into the export dialog", async ({ page }) => {
  await openDockMap(page); await openSettings(page); await category(page, "export");
  const target = page.getByRole("combobox", { name: "Varsayılan hedef", exact: true });
  await expect(target.locator("option")).toHaveText(["Unity", "Tiled", "PNG", "JSON", "Zip", "Godot 4", "Defold"]);
  await target.selectOption("png");
  await page.getByLabel("PNG ölçeği", { exact: true }).selectOption("2");
  await target.selectOption("godot");
  const resourceRoot = page.locator("#settings-export-resourceRoot");
  await resourceRoot.fill("maps/custom");
  await category(page, "general"); await category(page, "export");
  await expect(target).toHaveValue("godot");
  await expect(resourceRoot).toHaveValue("maps/custom");
  await save(page);
  await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Godot 4", exact: true })).toBeChecked();
  await expect(page.getByRole("dialog").getByRole("textbox").last()).toHaveValue("maps/custom");
  await page.keyboard.press("Escape");
  await openSettings(page); await category(page, "export");
  await expect(target).toHaveValue("godot");
  await target.selectOption("png");
  await expect(page.getByLabel("PNG ölçeği", { exact: true })).toHaveValue("2");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Godot 4", exact: true })).toBeChecked();
});

test("settings read and write errors show localized guidance without native exceptions", async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async path => {
    const { getPlatform, setPlatform } = await import(/* @vite-ignore */ path);
    const platform = getPlatform();
    setPlatform({ ...platform, readSettings: async () => { throw Error('private native read failure'); } });
  }, '/src/platform/index.ts');
  await page.keyboard.press('Control+k'); await page.locator('[id="command-settings.editShortcuts"]').click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Ayar dosyası okunamadı');
  await expect(alert).not.toContainText('private'); await expect(alert).not.toContainText('Error:');
  await page.keyboard.press('Escape');
  await page.evaluate(async path => {
    const { getPlatform, setPlatform } = await import(/* @vite-ignore */ path);
    setPlatform({ ...getPlatform(), readSettings: async () => '{}', writeSettings: async () => { throw Error('private native write failure'); } });
  }, '/src/platform/index.ts');
  await openSettings(page);
  await page.getByRole('button', { name: 'Kaydet ve uygula', exact: true }).click();
  await expect(alert).toContainText('Ayarlar kaydedilemedi');
  await expect(alert).not.toContainText('private'); await expect(alert).not.toContainText('Error:');
  await expect(page.getByRole('dialog')).toBeVisible();
});
