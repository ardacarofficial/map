import type { Page } from "@playwright/test";
import { test, expect, expectWelcome } from "../support/fixtures";
import { openDockMap } from "../support/docking";

async function settings(page: Page) {
  await expectWelcome(page);
  await page.keyboard.press("Control+k");
  await page.locator('[id="command-settings.editShortcuts"]').click();
  await expect(page.getByRole("radio", { name: "English", exact: true })).toBeEnabled();
}

test("Settings language previews, cancels, saves and persists after offline restart", async ({ page, context }) => {
  await page.goto("/");
  await settings(page);
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("dialog")).toHaveAccessibleName("App settings");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await settings(page);
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Save and apply", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "App settings", exact: true })).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("smap.settings")!).locale)).toBe("en");
  // Network-independent translations: only the local app server is reachable.
  const origin = new URL(page.url()).origin;
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await settings(page);
  await expect(page.getByRole("radio", { name: "English", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("direct locale changes refresh open menus, tooltips, canvas hints and HUD without remounting", async ({ page }) => {
  await openDockMap(page);
  await page.locator("[data-menu=view]").click();
  await page.getByRole("menu").hover({ position: { x: 50, y: 80 } });
  const canvas = page.locator("[data-canvas-host] canvas").first();
  await canvas.evaluate(element => { element.setAttribute("data-i18n-retained", "true"); });
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the editor modules to this browser-only check.
    const { getCanvasHandle } = await import("/src/ui/canvas/canvasHandle.ts");
    // @ts-expect-error Vite serves the editor modules to this browser-only check.
    const { setLocale, t } = await import("/src/i18n/index.ts");
    getCanvasHandle().showHint(() => t("canvas.blockedLocked"));
    setLocale("en");
  });
  await expect(page.locator('[data-command="view.toggleRecent"]')).toHaveText("Recent");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: { hintText: string } }).__smap.hintText)).toBe("The layer is locked");
  await expect(canvas).toHaveAttribute("data-i18n-retained", "true");
  await page.keyboard.press("Escape");
  await page.locator("[data-tool-button=brush]").hover();
  await expect(page.getByRole("tooltip")).toContainText("Pencil");
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the editor modules to this browser-only check.
    const { setLocale } = await import("/src/i18n/index.ts");
    setLocale("tr");
  });
  await expect(page.getByRole("tooltip")).toContainText("Kalem");
  await page.mouse.move(800, 500);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the editor modules to this browser-only check.
    const { setLocale } = await import("/src/i18n/index.ts");
    setLocale("en");
  });
  // Changing an existing undo HUD should reformat its stored event data.
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the editor modules to this browser-only check.
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const store = useEditorStore.getState().project.store;
    const layerId = useEditorStore.getState().activeLayerId;
    store.dispatch({ type: "setLayerProps", layerId, props: { name: "i18n" } });
    store.undo();
  });
  await expect(page.locator("[data-undo-hud]")).toContainText("Undone");
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the editor modules to this browser-only check.
    const { setLocale } = await import("/src/i18n/index.ts");
    setLocale("tr");
  });
  await expect(page.locator("[data-undo-hud]")).toHaveText("Geri alındı: Katman adı");
  await page.keyboard.press("Control+k");
  const recent = page.locator('[id="command-view.toggleRecent"]');
  await expect(recent).toHaveText("Son kullanılanlarGörünüm");
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the editor modules to this browser-only check.
    const { setLocale } = await import("/src/i18n/index.ts");
    setLocale("en");
  });
  await expect(recent).toHaveText("RecentView");
});
