import type { Page } from "@playwright/test";

import { openDockMap } from "../support/docking";
import { expect, sampleBytes, test } from "../support/fixtures";

async function movePanel(page: Page, panel: string, destination: string) {
  await page.locator(`[data-panel-tab=${panel}]`).click({ button: "right" });
  await page.locator("[data-context-item=move]").hover();
  await page.locator(`[data-context-item=move-${destination}]`).click();
}

for (const home of ["left", "right", "bottom"]) {
  test(`World reveals Project at its ${home} home and preserves unrelated colocated panels`, async ({ page }) => {
    await openDockMap(page);
    if (home !== "left") await movePanel(page, "project", home);
    if (home !== "bottom") await movePanel(page, "recent", home);
    if (home !== "right") await movePanel(page, "layers", home);
    await page.locator(`[data-zone-hide=${home}]`).click();
    await page.locator("[data-canvas-host] canvas").first().focus();
    await page.keyboard.press("w");
    const zone = page.locator(`[data-dock-zone=${home}]`);
    await expect(zone.locator("[data-panel=project]")).toBeVisible();
    await expect(zone.locator("[data-panel-tab=layers]")).toHaveCount(0);
    await zone.locator("[data-panel-tab=recent]").click();
    await expect(zone.locator("[data-recent-strip]")).toBeVisible();
    await page.locator("[data-menu=view]").click();
    await page.locator("[data-submenu=panels]").hover();
    await page.locator('[data-command="panel.project.show"]').click();
    await expect(zone.locator("[data-panel=project]")).toBeVisible();
    await expect(page.locator("[data-panel=project]")).toHaveCount(1);
  });
}

for (const menu of ["file", "edit", "view", "layer", "map", "help"]) {
  test(`${menu} menu fits 1366×768 and its last command is reachable by mouse and keyboard`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openDockMap(page);
    await page.locator(`[data-menu=${menu}]`).click();
    const popup = page.getByRole("menu");
    await expect(popup).toBeVisible();
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1366);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(768);
    const last = popup.locator("[data-command]").last();
    // A wheel scroll must reach the actual last row, including World's command in View.
    await popup.hover();
    await page.mouse.wheel(0, 2000);
    await expect(last).toBeInViewport({ ratio: 1 });
    await last.hover();
    await expect(last).toHaveAttribute("data-highlighted", "");
    await page.keyboard.press("Home");
    await page.keyboard.press("End");
    await expect(last).toBeFocused();
    if (menu === "view") {
      await last.click();
      await expect(page.locator("[data-rail=world]")).toHaveAttribute("aria-checked", "true");
    }
  });
}

for (const width of [1366, 1920]) {
  test(`Tümü ellipsized tileset section names have full-name tooltips at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    await openDockMap(page);
    const files = ["blob47-32", "wang16-32", "blob47-godot-32", "blob47-cr31-32", "dungeon-16"]
      .map(name => ({ name: `${name}.png`, bytes: sampleBytes(`tilesets/${name}.png`) }));
    await page.evaluate(files => {
      const dataTransfer = new DataTransfer();
      for (const file of files) dataTransfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: "image/png" }));
      for (const type of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    }, files);
    const card = page.getByTestId("bulk-import-card");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Hepsini ekle (5)", exact: true }).click();
    await expect(card).toBeHidden();
    await page.locator("[data-library-view=all]").click();
    await expect(page.locator("[data-dock-zone=left]")).toHaveCSS("width", "260px");
    for (const name of ["blob47-godot-32", "blob47-cr31-32"]) {
      const label = page.locator("[data-tileset-header] span.truncate").filter({ hasText: name });
      await label.scrollIntoViewIfNeeded();
      await expect(label).toBeVisible();
      expect(await label.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      await label.hover();
      await expect(label).toHaveAttribute("title", name);
    }
  });
}

for (const [locale, label] of [["tr", "Son kullanılanlar"], ["en", "Recent"]] as const) {
  test(`Recent uses its dockable panel name in the ${locale} menu and command palette`, async ({ page }) => {
    await openDockMap(page);
    if (locale === "en") {
      await page.locator("[data-menu=help]").click();
      await page.locator('[data-command="settings.editShortcuts"]').click();
      await page.locator('[data-settings-category=language]').click();
      await page.locator('#settings-locale').selectOption('en');
      await page.getByRole('button', { name: 'Save and apply', exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    }
    await page.locator("[data-menu=view]").click();
    await page.locator("[data-submenu=panels]").hover();
    const recent = page.locator('[data-command="view.toggleRecent"]');
    await expect(recent).toHaveText(label);
    await recent.click();
    await expect(page.locator("[data-panel-tab=recent]")).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill(label);
    const option = page.locator('[id="command-view.toggleRecent"]');
    await expect(option).toHaveText(`${label}${locale === "tr" ? "Görünüm" : "View"}`);
    await expect(page.getByRole("listbox")).not.toContainText(locale === "tr" ? "Alt panel" : "Bottom panel");
    await option.click();
    await expect(page.locator("[data-panel-tab=recent]")).toBeVisible();
  });
}

test("View groups open on hover and keyboard focus, keep shortcuts and fit a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 911, height: 512 });
  await openDockMap(page);
  await page.locator("[data-menu=view]").click();
  await expect(page.locator('[data-command="view.zoomIn"]')).toHaveCount(0);
  await expect(page.locator('[data-command="view.toggleRecent"]')).toHaveCount(0);
  for (const group of ["zoom", "overlays", "panels", "docks", "layout"]) {
    await page.locator(`[data-submenu=${group}]`).hover();
    const popup = page.getByRole("menu").last();
    await expect(popup).toBeVisible();
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(911);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(512);
    await page.keyboard.press("Escape");
  }
  await page.keyboard.press("Escape");
  await page.locator("[data-menu=view]").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-submenu=zoom]")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-command="view.zoomIn"]')).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[data-submenu=zoom]")).toBeFocused();
  await page.keyboard.press("ArrowDown"); // Bookmarks.
  await page.keyboard.press("ArrowDown"); // Canvas overlays.
  await page.keyboard.press("ArrowRight");
  const grid = page.locator('[data-command="view.toggleGrid"]');
  await expect(grid).toBeFocused();
  await expect(grid).toContainText("Ctrl");
  const checked = await grid.getAttribute("aria-checked");
  await page.keyboard.press("Enter");
  await page.locator("[data-menu=view]").click();
  await page.locator("[data-submenu=overlays]").hover();
  await expect(grid).toHaveAttribute("aria-checked", checked === "true" ? "false" : "true");
});
