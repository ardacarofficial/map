import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { openDockMap } from "../support/docking";

async function inside(parent: Locator, controls: Locator) {
  const bounds = (await parent.boundingBox())!;
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  }
}
async function headerFits(page: Page) {
  const header = page.locator("[data-tileset-side]");
  await expect.poll(() => header.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await inside(header, header.locator("button,input,[role=radio]"));
  const zone = page.locator("[data-dock-zone]").filter({ has: header });
  await inside(zone, zone.locator("[data-zone-hide],[data-zone-collapse]"));
  await expect(zone.locator("[data-zone-hide]")).toBeVisible();
  await expect(zone.locator("[data-zone-collapse]")).toBeVisible();
}
for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`${viewport.width}: Tileset controls fit every zone and narrow palette/zoom state`, async ({ page }) => {
    await page.setViewportSize(viewport); await openDockMap(page);
    for (const [zone, sizes] of [["left", [220, 260, 400]], ["right", [260, 420]], ["bottom", [180, 320]]] as const) {
      for (const size of sizes) {
        await page.evaluate(async ({ zone, size }) => {
          const { useDockStore } = await import(/* @vite-ignore */ String("/src/ui/layout/dockStore.ts"));
          useDockStore.getState().move("tileset", { zone, group: 0 });
          useDockStore.getState().setSize(zone, size, true);
        }, { zone, size });
        await headerFits(page);
        await page.screenshot({ path: `/tmp/n15-polish-${viewport.width}-${zone}-${size}.png` });
        await page.locator("[data-library-view=all]").click(); await headerFits(page);
        await page.locator("[data-library-view=single]").click();
      }
    }
    // A side header also fits with an individual zoom override and palette controls.
    await page.evaluate(async () => {
      const { useDockStore } = await import(/* @vite-ignore */ String("/src/ui/layout/dockStore.ts"));
      useDockStore.getState().move("tileset", { zone: "left" }); useDockStore.getState().setSize("left", 220, true);
    });
    // Single PNG navigation exposes a continuous readout and Fit.
    const grid = page.locator("[data-tileset-grid]").first(); await grid.hover(); await page.mouse.wheel(0, -100);
    await expect.poll(async () => Number(await grid.getAttribute("data-tileset-scale"))).toBeGreaterThan(1); await headerFits(page);
    await page.locator("[data-palette-new]").click();
    await page.locator("[data-dialog=text-prompt]").getByRole("button", { name: "Oluştur", exact: true }).click();
    await expect(page.locator("[data-palette-columns]")).toBeVisible(); await headerFits(page);
  });
  test(`${viewport.width}: full tab names, scroll arrows, keyboard reveal and fixed zone controls`, async ({ page }) => {
    await page.setViewportSize(viewport); await openDockMap(page);
    await page.evaluate(async () => {
      const { useDockStore } = await import(/* @vite-ignore */ String("/src/ui/layout/dockStore.ts"));
      useDockStore.getState().move("recent", { zone: "left" }); useDockStore.getState().setSize("left", 220, true);
    });
    const strip = page.locator("[data-dock-zone=left] [data-dock-strip]");
    const list = strip.getByRole("tablist");
    await expect(strip.locator("[data-tabs-next]")).toBeVisible();
    await page.locator("[data-panel-tab=tileset]").focus();
    await page.keyboard.press("End");
    const recent = page.locator("[data-panel-tab=recent]");
    await expect(recent).toBeFocused(); await expect(recent).toHaveAttribute("aria-selected", "true");
    await inside(list, recent);
    expect(await recent.locator("span").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(recent).not.toHaveAttribute("title");
    await inside(strip, strip.locator("[data-zone-collapse],[data-zone-hide]"));
    await page.keyboard.press("Home"); await inside(list, page.locator("[data-panel-tab=tileset]"));
    await strip.locator("[data-tabs-next]").click();
    await expect.poll(() => list.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  });
  test(`${viewport.width}: a Tileset moved to the compact bottom has usable grid height`, async ({ page }) => {
    await page.setViewportSize(viewport); await openDockMap(page);
    await page.locator("[data-panel-tab=tileset]").focus(); await page.keyboard.press("Shift+F10");
    await page.locator("[data-context-item=move]").hover(); await page.locator("[data-context-item=move-bottom]").click();
    const viewportEl = page.locator("[data-tileset-viewport]");
    await expect.poll(async () => (await viewportEl.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await headerFits(page);
    const bottom = page.locator("[data-dock-zone=bottom]");
    await inside(bottom, viewportEl);
    await page.locator("[data-tileset-zoom-fit]").click();
    await inside(viewportEl, page.locator("[data-tileset-grid]").first());
    const height = (await bottom.boundingBox())!.height;
    await page.locator("[data-zone-splitter=bottom]").focus(); await page.keyboard.press("ArrowUp");
    await expect.poll(async () => (await bottom.boundingBox())!.height).toBe(height + 16);
  });
}
