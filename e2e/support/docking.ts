import type { Page } from "@playwright/test";
import { confirmTilesetCard, dropFile, expect, sampleBytes } from "./fixtures";

export async function openDockMap(page: Page) {
  await page.goto("/");
  await dropFile(page, "body", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
}
export async function moveTab(page: Page, panel: string, destination: string, position?: { x: number; y: number }) {
  const tab = page.locator(`[data-panel-tab="${panel}"]`);
  await tab.scrollIntoViewIfNeeded();
  const a = (await tab.boundingBox())!;
  const b = (await page.locator(destination).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 2 });
  await page.mouse.move(b.x + (position?.x ?? b.width / 2), b.y + (position?.y ?? b.height / 2), { steps: 8 });
  await expect(page.locator("[data-dock-indicator]")).toBeVisible();
  await page.mouse.up();
}
export async function savedLayout(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("smap.layout.v2")!));
}
