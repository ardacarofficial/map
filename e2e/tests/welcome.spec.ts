import { expect, test } from "../support/fixtures";

test("welcome screen renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Yeni proje/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Aç.*Bir proje klasörü seç/ })).toBeVisible();
  await expect(page.getByText("Tileset'i buraya bırak")).toBeVisible();
  await expect(page.getByText("Henüz kayıtlı proje yok")).toBeVisible();
});

test("command palette opens with Ctrl+K, filters, closes with Esc", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Tileset'i buraya bırak")).toBeVisible();
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
