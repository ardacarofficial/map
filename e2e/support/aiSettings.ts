import type { Page } from "@playwright/test";
import { expect } from "../support/fixtures";

export async function openAiSettings(page: Page) {
  await expect(page.locator("[data-welcome-drop], [data-canvas-host]").first()).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.locator('[id="command-settings.editShortcuts"]').click();
  await expect(page.locator('[data-settings-category="ai"]')).toBeVisible();
  await page.locator('[data-settings-category="ai"]').click();
}
