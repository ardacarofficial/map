import { test, expect } from "../support/fixtures";
import { openDockMap } from "../support/docking";

test.use({ viewport: { width: 1366, height: 768 } });
test("AI activity stays optional, opens from its command, and moves through the dock menu", async ({ page }) => {
  await openDockMap(page);
  await expect(page.locator('[data-panel-tab="aiActivity"]')).toHaveCount(0);
  await page.keyboard.press("Control+k"); await page.locator('[id="command-view.aiActivity"]').click();
  const tab = page.locator('[data-panel-tab="aiActivity"]');
  await expect(tab).toBeVisible();
  await expect(page.locator('[data-dock-zone="bottom"] [data-panel-tab="aiActivity"]')).toBeVisible();
  await expect(page.locator("[data-ai-activity]")).toContainText("Henüz AI etkinliği yok");
  await tab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Taşı", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Sağ", exact: true }).click();
  await expect(page.locator('[data-dock-zone="right"] [data-panel-tab="aiActivity"]')).toBeVisible();
  await expect(page.getByLabel("Etkinlik ara", { exact: true })).toBeVisible();
  await page.getByLabel("Etkinlik ara", { exact: true }).fill("paint");
  await page.locator('[data-canvas-host]').click({ position: { x: 50, y: 50 } });
  await page.keyboard.press("Tab"); await expect(tab).toBeHidden();
  await page.keyboard.press("Tab"); await expect(tab).toBeVisible();
  await expect(page.getByLabel("Etkinlik ara", { exact: true })).toHaveValue("paint");
});
