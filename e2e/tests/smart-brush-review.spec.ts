import type { Page } from "@playwright/test";
import { expect, readOpfsText, test } from "../support/fixtures";
import { cellPoint } from "../support/smartStamp";
import { dragRoad, openRoadSheet, roadCells, saveRoad, selectRoad, waitForSaveIdle } from "../support/smartStampDock";

async function saveProject(page: Page) {
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Control+s");
  await expect.poll(() => readOpfsText(page, "project.smap")).not.toBeNull();
  await waitForSaveIdle(page);
}

async function reopen(page: Page) {
  await page.reload();
  await page.getByRole("button", { name: /^Aç…/ }).click();
  await expect.poll(() => page.evaluate(() => Object.hasOwn(window, "__smap")), { timeout: 60_000 }).toBe(true);
}

async function history(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return useEditorStore.getState().project.store.historyEntries();
  });
}

for (const undoRedo of [false, true]) {
  test(`removed generated tileset stays removed through ${undoRedo ? "undo/redo, " : ""}save and reopen`, async ({ page }) => {
    await openRoadSheet(page); await selectRoad(page); await saveRoad(page);
    await dragRoad(page, [[4, 4], [7, 4]]);
    expect((await roadCells(page)).generated).toHaveLength(1);
    await page.evaluate(async () => {
      const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
      const { removeTileset } = await import(/* @vite-ignore */ String("/src/commands/tilesetActions.ts"));
      const bank = useEditorStore.getState().project.store.document.tilesets.find((t: { generated?: unknown }) => t.generated);
      void removeTileset(bank.id);
    });
    await page.locator("[data-dialog='remove-tileset']").getByRole("button", { name: "Hücreleri temizle ve sil", exact: true }).click();
    await expect(page.locator("[data-dialog='remove-tileset']")).toBeHidden();
    if (undoRedo) {
      await page.locator("canvas[aria-label='map canvas']").first().focus();
      await page.keyboard.press("Control+z");
      expect((await roadCells(page)).cells).toHaveLength(4);
      await page.keyboard.press("Control+Shift+z");
    }
    const before = await history(page);
    await saveProject(page);
    expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
    expect(await history(page)).toEqual(before);
    const saved = JSON.parse((await readOpfsText(page, "project.smap"))!);
    expect(saved.tilesets.filter((t: { generated?: unknown }) => t.generated)).toHaveLength(0);
    await reopen(page);
    expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
  });
}

test("saving after undoing the first smart stroke preserves removal and redo", async ({ page }) => {
  await openRoadSheet(page); await selectRoad(page); await saveRoad(page);
  await dragRoad(page, [[4, 4], [7, 4]]);
  const painted = await roadCells(page);
  await page.keyboard.press("Control+z");
  const before = await history(page);
  await saveProject(page);
  expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
  expect(await history(page)).toEqual(before);
  await page.keyboard.press("Control+Shift+z");
  expect(await roadCells(page)).toEqual(painted);
  await page.keyboard.press("Control+z");
  await saveProject(page); await reopen(page);
  expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
});

test("first project save publishes an unused library brush for drawing after reopen", async ({ page }) => {
  await openRoadSheet(page); await selectRoad(page); await saveRoad(page);
  expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
  await saveProject(page); await reopen(page);
  expect((await roadCells(page)).generated).toHaveLength(1);
  await page.locator("[data-panel-tab='stamps']").click();
  await page.locator("[data-stamp-id='koy-yolu']").dblclick();
  await page.evaluate(() => (window as unknown as { __smap: { setCamera(x: number, y: number, z: number): void } }).__smap.setCamera(24, 24, 1));
  await dragRoad(page, [[4, 4], [7, 4]]);
  expect((await roadCells(page)).cells.map(c => c.tileId)).toEqual([12, 31, 31, 14]);
});

test("stamp editor save and project reopen preserve Akıllı off", async ({ page }) => {
  await openRoadSheet(page); await selectRoad(page);
  await expect(page.locator("[data-smart-brush]")).toBeVisible();
  await page.locator("[data-smart-brush]").click(); await saveRoad(page);
  // Opening the editor requires the source atlas to be published first.
  await saveProject(page);
  await page.locator("[data-panel-tab='stamps']").click();
  await page.locator("[data-stamp-id='koy-yolu']").click();
  await page.locator("[data-stamp-inspector] [data-action='editStamp']").click();
  await expect(page.locator("[data-stamp-banner]")).toBeVisible();
  await page.locator("[data-stamp-save]").click();
  await expect(page.locator("[data-stamp-banner]")).toBeHidden();
  const preference = () => page.evaluate(async () => {
    const { useProjectLibrary } = await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));
    return useProjectLibrary.getState().stamps[0].smartDisabled;
  });
  expect(await preference()).toBe(true);
  await saveProject(page);
  expect(JSON.parse((await readOpfsText(page, "stamps/koy-yolu.json"))!).smartDisabled).toBe(true);
  await reopen(page);
  expect(await preference()).toBe(true);
  await page.locator("[data-panel-tab='stamps']").click();
  await page.locator("[data-stamp-id='koy-yolu']").dblclick();
  await expect(page.locator("[data-smart-brush]")).toHaveAttribute("aria-checked", "false");
});

test("Seç right-click outside a marquee opens tile replacement with the previous brush", async ({ page }) => {
  await openRoadSheet(page); await selectRoad(page, 1, 1);
  await dragRoad(page, [[4, 4]]);
  // Select a different target tile through the sheet.
  const grid = page.locator("[data-tileset-grid]").first(), box = (await grid.boundingBox())!;
  await page.mouse.click(box.x + 3.5 * box.width / 12, box.y + 1.5 * box.height / 8);
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("s");
  const point = await cellPoint(page, 4, 4);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.locator("[data-context-item='replaceTiles']").click();
  const dialog = page.getByTestId("replace-tiles-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-replace-swatch='from']")).toContainText("14");
  await expect(dialog.locator("[data-replace-swatch='to']")).toContainText("15");
});

for (const key of ["b", "f", "r"]) {
  test(`${key.toUpperCase()} reports the missing brush when pressing the map`, async ({ page }) => {
    await openRoadSheet(page);
    // A freshly imported sheet has no chosen tile. Capture the real canvas feedback event.
    await page.evaluate(() => {
      const probe = { reasons: [] as string[] };
      (window as unknown as { missingBrushProbe: typeof probe }).missingBrushProbe = probe;
      (window as unknown as { __smap: { handle: { onBlockedAction(fn: (action: { reason: string }) => void): void } } }).__smap.handle.onBlockedAction(action => probe.reasons.push(action.reason));
    });
    await page.locator("canvas[aria-label='map canvas']").first().focus();
    await page.keyboard.press(key);
    await dragRoad(page, [[4, 4]]);
    expect(await page.evaluate(() => (window as unknown as { missingBrushProbe: { reasons: string[] } }).missingBrushProbe.reasons)).toEqual(["noBrush"]);
    expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
  });
}
