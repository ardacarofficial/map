import { test, expect } from "../support/fixtures";
import type { Page } from "@playwright/test";
import { openRoadSheet, selectRoad, dragRoad, roadCells } from "../support/smartStampDock";
import { cellPoint } from "../support/smartStamp";

type Debug = { __smap: { smartBrushPreparation: { hold(): void; release(fail?: boolean): void; pending: number }; store: { undoDepth: number } } };
const hold = async (page: Page) => page.evaluate(() => (window as unknown as Debug).__smap.smartBrushPreparation.hold());
const release = async (page: Page, fail = false) => page.evaluate(fail => (window as unknown as Debug).__smap.smartBrushPreparation.release(fail), fail);

test("a drag released before preparation lands the complete four-cell road as one undo", async ({ page }) => {
  await openRoadSheet(page); await hold(page); await selectRoad(page); await page.keyboard.press("b");
  await dragRoad(page, [[4, 4], [7, 4]]);
  expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
  const depth = await page.evaluate(() => (window as unknown as Debug).__smap.store.undoDepth);
  await release(page);
  await expect.poll(async () => (await roadCells(page)).cells.length).toBe(4);
  const result = await roadCells(page);
  expect(result.cells.map(c => [c.x, c.y, c.tileId])).toEqual([[4, 4, 12], [5, 4, 31], [6, 4, 31], [7, 4, 14]]);
  expect(result.generated).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as Debug).__smap.store.undoDepth)).toBe(depth + 1);
  await page.keyboard.press("Control+z"); expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
  await page.keyboard.press("Control+Shift+z"); expect(await roadCells(page)).toEqual(result);
});

for (const cancel of ["Escape", "released Escape", "pointercancel", "lostpointercapture", "another brush"] as const) {
  test(`${cancel} discards a pending stroke before preparation completes`, async ({ page }) => {
    await openRoadSheet(page); await hold(page); await selectRoad(page);
    const a = await cellPoint(page, 4, 4), b = await cellPoint(page, 7, 4);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y);
    if (cancel === "released Escape") { await page.mouse.up(); await page.keyboard.press("Escape"); }
    else if (cancel === "Escape") await page.keyboard.press("Escape");
    else if (cancel === "another brush") { await page.mouse.up(); await selectRoad(page, 1, 1); }
    else await page.locator("canvas[aria-label='map canvas']").first().dispatchEvent(cancel, { pointerId: 1 });
    await page.mouse.up(); await release(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as Debug).__smap.smartBrushPreparation.pending)).toBe(0);
    expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
  });
}

test("readiness while pressed shows the buffered preview and continues the same gesture", async ({ page }) => {
  await openRoadSheet(page); await hold(page); await selectRoad(page); await page.keyboard.press("r");
  const a = await cellPoint(page, 4, 4), b = await cellPoint(page, 7, 6);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y);
  await release(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: { smartPreview: { layers: { writes: unknown[] }[] } | null } }).__smap.smartPreview?.layers.flatMap(l => l.writes).length ?? 0)).toBe(12);
  await page.mouse.up(); expect((await roadCells(page)).cells).toHaveLength(12);
});

test("failed preparation gives the existing failure feedback and permits the plain-brush fallback", async ({ page }) => {
  await openRoadSheet(page); await hold(page); await selectRoad(page); await dragRoad(page, [[4, 4], [7, 4]]); await release(page, true);
  await expect(page.locator("[data-toaster]")).toContainText("Brush preparation failed");
  expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
  await page.locator("[data-smart-brush]").click(); await dragRoad(page, [[4, 4]]);
  expect((await roadCells(page)).cells).toHaveLength(9);
});

test("two completed drags during preparation each retain their own undo step", async ({ page }) => {
  await openRoadSheet(page); await hold(page); await selectRoad(page);
  await dragRoad(page, [[4, 4], [7, 4]]); await dragRoad(page, [[4, 7], [7, 7]]);
  expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
  await release(page); await expect.poll(async () => (await roadCells(page)).cells.length).toBe(8);
  await page.keyboard.press("Control+z"); expect((await roadCells(page)).cells.map(c => c.y)).toEqual([4, 4, 4, 4]);
  await page.keyboard.press("Control+z"); expect(await roadCells(page)).toEqual({ cells: [], generated: [] });
});
