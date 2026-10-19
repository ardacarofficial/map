import type { Page } from "@playwright/test";
import { dropFile, expect, readOpfsText, sampleBytes, test, confirmTilesetCard } from "../support/fixtures";

async function createWorld(page: Page, name = "Ada", map = "Liman") {
  await page.getByRole("button", { name: /Yeni dünya/ }).click();
  const dialog = page.locator("[data-dialog='new-project']");
  await expect(dialog.getByRole("heading", { name: "Yeni dünya" })).toBeVisible();
  await dialog.getByLabel("Dünya adı", { exact: true }).fill(name);
  await dialog.getByLabel("İlk harita adı").fill(map);
  await dialog.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.locator("[data-project-name]")).toHaveText(name);
  await expect(page.locator("[data-doc-tab][aria-selected='true']")).toContainText(map);
  await expect.poll(() => page.evaluate(() => Object.hasOwn(window, "__smap"))).toBe(true);
}

async function savedProject(page: Page) {
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved");
  return JSON.parse((await readOpfsText(page, "project.smap"))!) as { name: string; levels: { id: string; name: string; path: string }[] };
}

test("welcome creates a world and named first map; tab plus and Map menu add maps to that world", async ({ page }) => {
  await page.goto("/");
  await createWorld(page);
  await expect(page).toHaveTitle(/Ada \/ Liman/);
  await dropFile(page, "[data-canvas-host]", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await page.locator("[data-doc-tab-new]").click();
  const dialog = page.locator("[data-dialog='new-level']");
  await expect(dialog.getByRole("heading", { name: "Yeni harita" })).toBeVisible();
  await expect(dialog.getByLabel("Genişlik")).toHaveValue("64");
  await expect(dialog.getByLabel("Yükseklik")).toHaveValue("48");
  await expect(dialog.getByLabel("Tile boyutu")).toHaveValue("32");
  await dialog.getByLabel("Ad", { exact: true }).fill("Koy");
  await dialog.getByRole("button", { name: "Oluştur" }).click();
  await expect(page.locator("[data-project-name]")).toHaveText("Ada");
  await page.locator("[data-library-tab-button='project']").click();
  await expect(page.getByRole("tab", { name: "Dünya", exact: true })).toBeVisible();
  const maps = page.getByRole("listbox", { name: "Haritalar" });
  await expect(maps.getByRole("option")).toHaveCount(2);
  await expect(maps.getByRole("option", { name: "Koy" })).toHaveAttribute("aria-selected", "true");
  // Shared tilesets are still available after switching back to the Tileset panel.
  await page.locator("[data-panel-tab='tileset']").click();
  await expect(page.getByRole("grid", { name: /overworld/i })).toBeVisible();
  await page.locator("[data-library-tab-button='project']").click();
  await page.getByRole("menuitem", { name: "Harita", exact: true }).click();
  await page.locator("[data-command='level.new']").click();
  await dialog.getByLabel("Ad", { exact: true }).fill("Orman");
  await dialog.getByRole("button", { name: "Oluştur" }).click();
  await expect(maps.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await savedProject(page)).levels.length).toBe(3);
  expect((await savedProject(page)).name).toBe("Ada");
});

test("rename breadcrumb parts, save and reopen: names agree in title, recents, tree and overview", async ({ page }) => {
  await page.goto("/");
  await createWorld(page);
  await page.keyboard.press("Control+s");
  await expect.poll(() => readOpfsText(page, "project.smap")).not.toBeNull();
  const before = await savedProject(page);
  // Both parts keep their existing inline rename affordances.
  await page.locator("[data-project-name]").dblclick();
  const worldName = page.getByRole("textbox", { name: "Dünya adı", exact: true });
  await worldName.fill("Takımadalar");
  await worldName.press("Enter");
  await page.locator("[data-doc-tab][aria-selected='true']").dblclick();
  const mapName = page.getByRole("textbox", { name: "Yeniden adlandır", exact: true });
  await mapName.fill("Eski liman");
  await mapName.press("Enter");
  await expect(page).toHaveTitle(/Takımadalar \/ Eski liman/);
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await savedProject(page)).levels[0]?.name).toBe("Eski liman");
  expect((await savedProject(page)).levels[0]).toMatchObject({ id: before.levels[0]!.id, path: before.levels[0]!.path });
  await page.reload();
  await expect(page.locator("[data-recent-project]")).toContainText("Takımadalar");
  await page.getByRole("button", { name: /^Aç/ }).click();
  await expect(page.locator("[data-project-name]")).toHaveText("Takımadalar");
  await expect(page.locator("[data-doc-tab][aria-selected='true']")).toContainText("Eski liman");
  await expect(page).toHaveTitle(/Takımadalar \/ Eski liman/);
  await page.keyboard.press("Control+e");
  const exportDialog = page.getByRole("dialog");
  await exportDialog.getByRole("radio", { name: /JSON/ }).click();
  const download = page.waitForEvent("download");
  await exportDialog.getByTestId("export-submit").click();
  expect((await download).suggestedFilename()).toBe("Eski liman.json");
  await page.keyboard.press("Escape");
  await page.locator("[data-rail='world']").click();
  await expect(page.locator("[data-world-hint]")).toContainText("Takımadalar");
  await expect(page.getByRole("listbox", { name: "Haritalar" }).getByRole("option", { name: "Eski liman" })).toBeVisible();
  await expect(page.locator("[data-status-world]")).toContainText("Takımadalar");
});

test("File menu and palette distinguish world commands; a new world starts isolated", async ({ page }) => {
  await page.goto("/");
  await createWorld(page);
  await dropFile(page, "[data-canvas-host]", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await page.keyboard.press("Control+s");
  await expect.poll(() => readOpfsText(page, "project.smap")).not.toBeNull();
  await page.getByRole("menuitem", { name: "Dosya", exact: true }).click();
  for (const [id, label] of [["file.new", "Yeni dünya…"], ["file.open", "Dünya aç…"], ["file.save", "Dünyayı kaydet"]]) {
    await expect(page.locator(`[data-command='${id}']`)).toContainText(label!);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("Dünya ayarları");
  await expect(page.getByRole("option").first()).toContainText("Dünya ayarları");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+n");
  const dialog = page.locator("[data-dialog='new-project']");
  await dialog.getByLabel("Dünya adı", { exact: true }).fill("Yeni ada");
  await dialog.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.locator("[data-project-name]")).toHaveText("Yeni ada");
  await expect(page.getByRole("grid", { name: /overworld/i })).toHaveCount(0);
  await page.locator("[data-library-tab-button='project']").click();
  await expect(page.getByRole("listbox", { name: "Haritalar" }).getByRole("option")).toHaveCount(1);
  await expect(page.locator("[data-doc-tab]")).toHaveCount(1);
});

test("English uses World and Map in welcome, creation, menus and the tree", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: /New world/ }).click();
  const dialog = page.locator("[data-dialog='new-project']");
  await expect(dialog.getByRole("heading", { name: "New world" })).toBeVisible();
  await dialog.getByLabel("World name", { exact: true }).fill("Island");
  await dialog.getByLabel("First map name").fill("Harbor");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveTitle(/Island \/ Harbor/);
  await page.locator("[data-library-tab-button='project']").click();
  await expect(page.getByRole("tab", { name: "World", exact: true })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Maps" }).getByRole("option", { name: "Harbor" })).toBeVisible();
  await page.locator("[data-doc-tab-new]").click();
  await expect(page.getByRole("heading", { name: "New map" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await expect(page.locator("[data-command='file.save']")).toContainText("Save world");
});
