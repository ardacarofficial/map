import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { cellPoint, mapCells, openToolsProject, pickDockTile, type ToolsHook } from "../support/toolFeatures";

async function seed(page: Page) {
  await openToolsProject(page);
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: ToolsHook }).__smap;
    const s = h.editor.getState();
    const ts = h.store.document.tilesets[0]!.id;
    const from = h.store.getOrAddPaletteIndex(ts, 9);
    h.store.getOrAddPaletteIndex(ts, 10);
    const b = h.store.dispatch({ type: "addLayer", layer: { name: "Second" } });
    for (const layerId of [s.activeLayerId, b]) h.store.dispatch({ type: "paintCells", layerId, cells: [
      { x: 2, y: 2, cell: (from | 0xe0000000) >>> 0 }, { x: 3, y: 2, cell: from },
    ] });
    s.setSelection({ tilesetId: ts, tileId: 10 });
    s.setRegion({ x: 2, y: 2, width: 1, height: 1 });
    h.store.clearHistory();
  });
}

async function openFromPalette(page: Page) {
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("Tile değiştir");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("replace-tiles-dialog")).toBeVisible();
}

test("replace tile: palette, live scopes, flags and one undo/redo", async ({ page }) => {
  await seed(page);
  await openFromPalette(page);
  const dialog = page.getByTestId("replace-tiles-dialog");
  // Set From with the canvas eyedropper, leaving To on the current brush.
  await dialog.locator('[data-replace-swatch="from"]').click();
  await expect(page.locator("[data-replace-picking]")).toBeVisible();
  const p = await cellPoint(page, 2, 2);
  await page.mouse.click(p.x, p.y);
  await expect(dialog.locator("[data-replace-count]")).toHaveText("1 hücre değişecek");
  await dialog.getByRole("radio", { name: "Etkin katman", exact: true }).click();
  await expect(dialog.locator("[data-replace-count]")).toHaveText("2 hücre değişecek");
  await dialog.getByRole("radio", { name: "Görünür katmanlar" }).click();
  await expect(dialog.locator("[data-replace-count]")).toHaveText("4 hücre değişecek");
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: ToolsHook }).__smap;
    h.store.dispatch({ type: "setLayerProps", layerId: h.store.document.layers.at(-1)!.id, props: { locked: true } });
    h.store.clearHistory();
  });
  await expect(dialog.locator("[data-replace-count]")).toHaveText("2 hücre değişecek");
  await dialog.screenshot({ path: "test-results/replace-tiles-dialog.png" });
  await dialog.getByRole("button", { name: "Değiştir", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let cells = await mapCells(page, 5, 4);
  expect(cells[2]![2]!.tileId).toBe(10);
  expect(cells[2]![2]!.cell >>> 29).toBe(7);
  expect(await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.undoDepth)).toBe(1);
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Control+z");
  cells = await mapCells(page, 5, 4);
  expect(cells[2]![2]!.tileId).toBe(9);
  await page.keyboard.press("Control+y");
  expect((await mapCells(page, 5, 4))[2]![2]!.tileId).toBe(10);
});

test("replace tile: Edit menu, dock picks, zero-count disabling and Escape preserve draft and brush", async ({ page }) => {
  await seed(page);
  await page.getByRole("menuitem", { name: "Düzen", exact: true }).click();
  await page.getByRole("menuitem", { name: "Tile değiştir…" }).click();
  const dialog = page.getByTestId("replace-tiles-dialog");
  await expect(dialog.getByRole("button", { name: "Değiştir", exact: true })).toBeDisabled();
  await dialog.locator('[data-replace-swatch="from"]').click();
  await pickDockTile(page, 1, 1); // tile 9
  await expect(dialog.locator("[data-replace-count]")).toHaveText("1 hücre değişecek");
  await dialog.locator('[data-replace-swatch="to"]').click();
  await pickDockTile(page, 3, 1); // tile 11
  await expect(dialog.locator('[data-replace-swatch="to"]')).toContainText("11");
  await dialog.locator('[data-replace-swatch="from"]').click();
  await page.keyboard.press("Escape");
  await expect(dialog.locator('[data-replace-swatch="from"]')).toContainText("9");
  await expect(dialog.locator('[data-replace-swatch="to"]')).toContainText("11");
  expect(await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.editor.getState().selection?.tileId)).toBe(10);
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  expect((await mapCells(page, 5, 4))[2]![2]!.tileId).toBe(9);
  expect(await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.undoDepth)).toBe(0);
});

test("replace tile: selection context opens the same dialog with clicked source and previous brush target", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("s");
  const p = await cellPoint(page, 2, 2);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Tile değiştir…" }).click();
  const dialog = page.getByTestId("replace-tiles-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-replace-swatch="from"]')).toContainText("9");
  await expect(dialog.locator('[data-replace-swatch="to"]')).toContainText("10");
  await expect(dialog.locator("[data-replace-count]")).toHaveText("1 hücre değişecek");
  await dialog.getByRole("button", { name: "Değiştir", exact: true }).click();
  expect((await mapCells(page, 5, 4))[2]![3]!.tileId).toBe(9);
});
