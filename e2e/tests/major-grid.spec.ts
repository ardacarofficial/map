import { expect, readOpfsText, test } from "../support/fixtures";
import { openToolsProject, type ToolsHook } from "../support/toolFeatures";

for (const dpr of [1, 1.25, 1.5]) test.describe(`major grid DPR ${dpr}`, () => {
  test.use({ deviceScaleFactor: dpr });
  test("interval and origin draw crisp single-device-pixel guides at several zooms; Ctrl+G hides both grids", async ({ page }) => {
    await openToolsProject(page);
    await page.getByRole("button", { name: "Kılavuz ızgara", exact: true }).click();
    const popover = page.locator("[data-major-grid-popover]");
    await popover.getByRole("combobox", { name: "Ana çizgi aralığı" }).selectOption("8");
    await popover.getByRole("spinbutton", { name: "X", exact: true }).fill("2");
    await popover.getByRole("spinbutton", { name: "Y", exact: true }).fill("1");
    await page.keyboard.press("Escape");
    const canvas = page.locator("canvas[aria-label='map canvas']").first();
    for (const zoom of [0.25, 0.5, 1, 1.37, 2]) {
      const at = await page.evaluate(zoom => {
        const h = (window as unknown as { __smap: ToolsHook & { setCamera(x: number, y: number, zoom: number): void } }).__smap;
        h.setCamera(24, 24, zoom);
        return h.cellCenter(1.5, 2);
      }, zoom);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const box = (await canvas.boundingBox())!;
      const bytes = await canvas.screenshot();
      const count = await page.evaluate(async ({ bytes, x, y, dpr }) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        const c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const row = ctx.getImageData(Math.round(x * dpr) - 2, Math.round(y * dpr), 5, 1).data;
        let hits = 0;
        for (let i = 0; i < row.length; i += 4) if (row[i] === 100 && row[i + 1] === 112 && row[i + 2] === 124) hits++;
        return hits;
      }, { bytes: [...bytes], x: at.x - box.x, y: at.y - box.y, dpr });
      expect(count).toBe(1);
    }
    await canvas.focus(); await page.keyboard.press("Control+g");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: { editor: { getState(): { gridVisible: boolean } } } }).__smap.editor.getState().gridVisible)).toBe(false);
    const bytes = await canvas.screenshot();
    const hasMajor = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
      const c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext("2d")!; ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      for (let i = 0; i < data.length; i += 4) if (data[i] === 100 && data[i + 1] === 112 && data[i + 2] === 124) return true;
      return false;
    }, [...bytes]);
    expect(hasMajor).toBe(false);
  });
});

test("major grid: per-project view persistence survives reopen without changing level format, dirty state or history", async ({ page }) => {
  await openToolsProject(page);
  await page.keyboard.press("Control+s");
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved");
  const before = await readOpfsText(page, "levels/main.json");
  expect(before).not.toBeNull();
  const depth = await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.undoDepth);
  await page.getByRole("button", { name: "Kılavuz ızgara", exact: true }).click();
  const popover = page.locator("[data-major-grid-popover]");
  await popover.getByRole("combobox", { name: "Ana çizgi aralığı" }).selectOption("16");
  await popover.getByRole("spinbutton", { name: "X", exact: true }).fill("-3");
  await popover.getByRole("spinbutton", { name: "Y", exact: true }).fill("5");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved");
  expect(await readOpfsText(page, "levels/main.json")).toBe(before);
  expect(await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.undoDepth)).toBe(depth);
  await page.reload(); await page.keyboard.press("Control+o");
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
  await page.getByRole("button", { name: "Kılavuz ızgara", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ana çizgi aralığı" })).toHaveValue("16");
  await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toHaveValue("-3");
  await expect(page.getByRole("spinbutton", { name: "Y", exact: true })).toHaveValue("5");
  expect(await readOpfsText(page, "levels/main.json")).toBe(before);
});
