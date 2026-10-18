import type { MapStore } from "../../packages/core/src";
import type { Page } from "@playwright/test";

import { confirmTilesetCard, dropFile, expect, sampleBytes, test } from "../support/fixtures";

type Hook = {
  editor: { getState(): { zoom: number; activeLayerId: string | null } };
  store: MapStore;
  cellCenter(x: number, y: number): { x: number; y: number };
};

async function openMap(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await dropFile(page, "body", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
}

/** Recover map bounds and the map point at canvas centre using the existing debug hook. */
async function view(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    const canvas = document.querySelector("canvas[aria-label='map canvas']")!.getBoundingClientRect();
    const a = h.cellCenter(0, 0);
    const b = h.cellCenter(1, 1);
    const tile = b.x - a.x;
    const left = a.x - tile / 2;
    const top = a.y - tile / 2;
    return {
      zoom: h.editor.getState().zoom,
      cx: (canvas.x + canvas.width / 2 - left) / tile,
      cy: (canvas.y + canvas.height / 2 - top) / tile,
      fits: left >= canvas.left && top >= canvas.top && left + tile * 64 <= canvas.right && top + tile * 48 <= canvas.bottom,
    };
  });
}

test("1366×768: opening frames the whole map; Tab in both directions keeps zoom and centre", async ({ page }) => {
  await openMap(page);
  await expect.poll(async () => (await view(page)).fits).toBe(true);
  const before = await view(page);
  expect(before.zoom).toBeLessThan(0.5);
  expect(before.cx).toBeCloseTo(32);
  expect(before.cy).toBeCloseTo(24);
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await canvas.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-tileset-mode='terrain']")).toBeHidden();
  await expect.poll(async () => (await view(page)).zoom).toBe(before.zoom);
  expect((await view(page)).cx).toBeCloseTo(before.cx);
  expect((await view(page)).cy).toBeCloseTo(before.cy);
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-tileset-mode='terrain']")).toBeVisible();
  await expect.poll(async () => (await view(page)).zoom).toBe(before.zoom);
  expect((await view(page)).cx).toBeCloseTo(before.cx);
  expect((await view(page)).cy).toBeCloseTo(before.cy);
});

test("a multi-tile tileset brush is paint in history; hidden layers block the next stroke", async ({ page }) => {
  await openMap(page);
  const grid = page.locator("[data-tileset-grid='overworld-32']");
  const box = (await grid.boundingBox())!;
  const scale = Number(await grid.getAttribute("data-tileset-scale"));
  const size = 32 * scale;
  await page.mouse.move(box.x + size / 2, box.y + size / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + size * 2.5, box.y + size * 1.5, { steps: 8 });
  await page.mouse.up();
  const point = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.cellCenter(32, 24));
  await page.mouse.click(point.x, point.y);
  await page.getByRole("tab", { name: "Geçmiş", exact: true }).click();
  await expect(page.locator("[data-history-row]").last()).toContainText(/Boya \d+ hücre/);
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    h.store.dispatch({ type: "setLayerProps", layerId: h.editor.getState().activeLayerId!, props: { visible: false } });
  });
  const before = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.undoDepth);
  await page.mouse.click(point.x + 40, point.y);
  await expect(page.locator("[data-toaster]")).toContainText("katmanı gizli");
  expect(await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.undoDepth)).toBe(before);
});

test("a rough 7×1 non-terrain strip shows the muted no-template state without markers", async ({ page }) => {
  await openMap(page);
  await page.locator("[data-tileset-mode='terrain']").click();
  const grid = page.locator("[data-tileset-grid='overworld-32']");
  const box = (await grid.boundingBox())!;
  const size = 32 * Number(await grid.getAttribute("data-tileset-scale"));
  await page.mouse.move(box.x + size / 2, box.y + size * 4.5);
  await page.mouse.down();
  await page.mouse.move(box.x + size * 6.5, box.y + size * 4.5, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("[data-terrain-no-template]")).toHaveText("Bu blokta şablon bulunamadı");
  await expect(page.locator("[data-terrain-candidate]")).toHaveCount(0);
  await expect(page.locator("[data-terrain-tags]")).toHaveCount(0);
});
