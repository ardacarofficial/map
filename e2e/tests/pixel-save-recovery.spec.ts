import { expect, readOpfsText, test } from "../support/fixtures";
import { open, click, color, rgba, gpuPixel, key } from "../support/pixelHarness";

for (const grow of [false, true]) test(`browser directory saves recover across every write (atlas growth: ${grow})`, async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  const result = await page.evaluate(async grow => {
    const { DirectoryHandleFileSystem } = await import(/* @vite-ignore */ String("/src/io/browserFs.ts"));
    const { runSaveFailureMatrix } = await import(/* @vite-ignore */ String("/src/io/saveRecovery.testHelper.ts"));
    const root = await navigator.storage.getDirectory(); let n = 0;
    return runSaveFailureMatrix(async () => new DirectoryHandleFileSystem(await root.getDirectoryHandle(`case-${n++}`, { create: true })), grow);
  }, grow);
  expect(result.boundaries).toContain("project.smap"); expect(result.boundaries).toContain("levels/a.json"); expect(result.boundaries).toContain("levels/b.json");
  expect(result.boundaries).toContain("tilesets/bank.recipe.json"); expect(result.cases).toBeGreaterThan(20);
});

test("pixel-only saves create separate backups; restart and restore show red while another map keeps green", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page); await key(page, "m"); await color(page, "#ff0000ff"); await click(page, 1, 1);
  await expect.poll(() => rgba(page, 0, 0, 1, 1)).toEqual([255, 0, 0, 255]);
  await key(page, "Control+s");
  await expect.poll(() => readOpfsText(page, "project.smap")).toContain("edited-16x16-1");
  const red = await page.evaluate(async () => {
    const session = await import(/* @vite-ignore */ String("/src/io/session.ts"));
    await session.withProjectWriteGate(async () => {});
    const entries = await session.listProjectBackups();
    return { path: entries[0].path, count: entries.length };
  });
  await color(page, "#00ff00ff"); await click(page, 1, 1); await key(page, "Control+s");
  await expect.poll(() => rgba(page, 0, 0, 1, 1)).toEqual([0, 255, 0, 255]);
  await expect.poll(async () => page.evaluate(async () => {
    const session = await import(/* @vite-ignore */ String("/src/io/session.ts"));
    return (await session.listProjectBackups()).length;
  })).toBeGreaterThan(red.count);
  // Duplicate the live green map through the command palette before restart.
  await key(page, "Control+k"); await page.getByRole("combobox").fill("Açık haritayı çoğalt");
  await page.locator('[id="command-level.duplicate"]').click();
  await key(page, "Control+s");
  await expect.poll(() => readOpfsText(page, "project.smap")).toContain("kopya");
  await page.reload(); await page.keyboard.press("Control+o");
  await expect(page.locator('canvas[aria-label="map canvas"]').first()).toBeVisible();
  await expect.poll(() => rgba(page, 0, 0, 1, 1)).toEqual([0, 255, 0, 255]);
  // Open the actual backup dialog and choose the historical snapshot.
  await key(page, "Control+k"); await page.getByRole("combobox").fill("Yedekten aç");
  await page.locator('[id="command-file.openBackup"]').click();
  const row = page.locator("[data-backup-row]").filter({ has: page.locator(`[title="${red.path.split("/").at(-1)}"]`) });
  await expect(row).toBeVisible(); await row.click();
  await expect.poll(() => rgba(page, 0, 0, 1, 1)).toEqual([255, 0, 0, 255]);
  expect(await gpuPixel(page, 1, 1)).toEqual([255, 0, 0, 255]);
  await key(page, "Control+s");
  await page.locator('[data-library-tab-button="project"]').click();
  await page.getByRole("listbox", { name: "Haritalar" }).getByRole("option", { name: /A.*kopya/ }).dblclick();
  await expect.poll(() => rgba(page, 0, 0, 1, 1)).toEqual([0, 255, 0, 255]);
  expect(await gpuPixel(page, 1, 1)).toEqual([0, 255, 0, 255]);
});

test("restored source pixels stay historical and their retained PNG cannot be an apply target", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page); await key(page, "Control+s");
  const old = await page.evaluate(async () => {
    const session = await import(/* @vite-ignore */ String("/src/io/session.ts"));
    await session.withProjectWriteGate(async () => {});
    return (await session.listProjectBackups())[0].path;
  });
  // Simulate a later source revision on disk, then restart without any warm
  // raster/image cache to verify the backup owns its actual historical bytes.
  await page.evaluate(async () => {
    const { encodeSourcePng } = await import(/* @vite-ignore */ String("/src/io/sourcePng.ts"));
    const data = new Uint8Array(16 * 16 * 4);
    for (let p = 0; p < data.length; p += 4) data.set([0, 255, 0, 255], p);
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("tilesets");
    const writer = await (await dir.getFileHandle("source.png")).createWritable();
    await writer.write(encodeSourcePng({ width: 16, height: 16, data })); await writer.close();
  });
  await page.reload(); await page.keyboard.press("Control+o");
  await expect(page.locator('canvas[aria-label="map canvas"]').first()).toBeVisible();
  expect(await gpuPixel(page, 1, 1)).toEqual([0, 255, 0, 255]);
  await key(page, "Control+k"); await page.getByRole("combobox").fill("Yedekten aç"); await page.locator('[id="command-file.openBackup"]').click();
  await page.locator("[data-backup-row]").filter({ has: page.locator(`[title="${old.split("/").at(-1)}"]`) }).click();
  await expect.poll(() => gpuPixel(page, 1, 1)).toEqual([255, 255, 255, 255]);
  await key(page, "m"); await color(page, "#ff0000ff"); await click(page, 1, 1);
  await expect.poll(() => rgba(page, 0, 0, 1, 1)).toEqual([255, 0, 0, 255]);
  await page.getByRole("button", { name: "Görünüm seçenekleri", exact: true }).click();
  await page.locator('[data-command="pixel.applyPng"]').click();
  const dialog = page.locator("[data-png-writeback-dialog]");
  await expect(dialog).toContainText("yedek görselleri salt okunur");
  await expect(dialog.locator("[data-png-confirm]")).toBeDisabled();
});
