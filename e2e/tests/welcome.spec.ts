import { expect, test, expectWelcome } from "../support/fixtures";

test("welcome screen renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Yeni dünya/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Aç/ })).toBeVisible();
  await expectWelcome(page);
  await expect(page.getByText("Henüz kayıtlı dünya yok")).toBeVisible();
  // Templates: Top-down, Zindan, Boş.
  await expect(page.locator("[data-template]")).toHaveCount(3);
});

test("template → new project dialog → Oluştur: layers, size and first map name follow the template", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expectWelcome(page);
  await page.locator("[data-template='topdown']").click();
  const dialog = page.locator("[data-dialog='new-project']");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Dünya adı")).toHaveValue("Top-down");
  await expect(dialog.getByText("2048 × 1536 px · 5 katman")).toBeVisible();
  await dialog.getByLabel("Dünya adı").fill("Köy");
  // "Sonra seç": no folder up front (the first save asks).
  await dialog.getByRole("button", { name: "Sonra seç" }).click();
  await dialog.getByRole("button", { name: "Oluştur" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.hasOwn(window, "__smap"))).toBe(true);
  const info = await page.evaluate(() => {
    const h = (window as unknown as { __smap: { store: { document: { map: { width: number; height: number }; layers: { name: string }[] } } } }).__smap;
    return { w: h.store.document.map.width, h: h.store.document.map.height, layers: h.store.document.layers.map((l) => l.name) };
  });
  expect(info.w).toBe(64);
  expect(info.h).toBe(48);
  expect(info.layers).toHaveLength(5);
  // The first map of a new project has a localized name (not "main").
  await expect(page.locator("[data-doc-tab]").first()).toContainText("Ana harita");
  expect(errors).toEqual([]);
});

test("command palette opens with Ctrl+K, filters, closes with Esc", async ({ page }) => {
  await page.goto("/");
  await expectWelcome(page);
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Komut yaz…" });
  await expect(input).toBeVisible();
  const options = page.getByRole("option");
  const all = await options.count();
  expect(all).toBeGreaterThanOrEqual(2);

  await input.fill("yeni");
  await expect(options.first()).toContainText(/yeni/i);
  expect(await options.count()).toBeLessThan(all);

  await input.fill("zzzzqqq");
  await expect(page.getByText("Eşleşen komut yok")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(input).toBeHidden();
});
