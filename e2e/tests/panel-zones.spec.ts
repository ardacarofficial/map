import { expect, test } from "../support/fixtures";
import { openDockMap, savedLayout } from "../support/docking";

const zones = ["left", "right", "bottom"] as const;
const keys = { left: "Control+b", right: "Control+Alt+b", bottom: "Control+Shift+b" };
for (const zone of zones) test(`${zone}: chevron, double-click, shortcut, keyboard resize/reset and cancel`, async ({ page }) => {
  await openDockMap(page);
  const root = page.locator(`[data-dock-zone=${zone}]`), splitter = page.locator(`[data-zone-splitter=${zone}]`);
  await page.locator(`[data-zone-collapse=${zone}]`).click();
  await expect(root).toHaveAttribute("data-zone-state", "collapsed");
  await splitter.dblclick(); await expect(root).toHaveAttribute("data-zone-state", "expanded");
  await page.keyboard.press(keys[zone]); await expect(root).toHaveAttribute("data-zone-state", "collapsed");
  await page.keyboard.press(keys[zone]); await expect(root).toHaveAttribute("data-zone-state", "expanded");
  const before = (await savedLayout(page)).zones[zone].expandedPx;
  await splitter.focus(); await page.keyboard.press(zone === "left" ? "ArrowRight" : zone === "right" ? "ArrowLeft" : "ArrowUp");
  expect((await savedLayout(page)).zones[zone].expandedPx).toBe(before + 16);
  await page.keyboard.press("Home"); expect((await savedLayout(page)).zones[zone].expandedPx).toBe(before);
  const b = (await splitter.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + (zone === "left" ? 60 : zone === "right" ? -60 : 0), b.y + b.height / 2 + (zone === "bottom" ? -60 : 0), { steps: 8 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect((await savedLayout(page)).zones[zone].expandedPx).toBe(before);
  await splitter.focus(); await page.keyboard.press("Enter"); await expect(root).toHaveAttribute("data-zone-state", "collapsed");
});

for (const size of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) test(`${size.width}: collapsed/hidden/Tab canvas area and exact restoration`, async ({ page }) => {
  await page.setViewportSize(size); await openDockMap(page);
  for (const zone of zones) await page.keyboard.press(keys[zone]);
  const bounds = async () => (await page.locator("[data-canvas-host]").boundingBox())!;
  let box = await bounds(); expect(box.width).toBeGreaterThanOrEqual(size.width - 118); expect(box.height).toBeGreaterThanOrEqual(600);
  const before = await savedLayout(page);
  await page.locator("[data-canvas-host]").focus(); await page.keyboard.press("Tab");
  box = await bounds(); expect(box.width).toBeGreaterThanOrEqual(size.width - 26); expect(box.height).toBeGreaterThanOrEqual(640);
  await page.keyboard.press("Tab"); expect(await savedLayout(page)).toEqual(before);
  for (const zone of zones) { await page.keyboard.press(keys[zone]); await page.locator(`[data-zone-hide=${zone}]`).click(); }
  box = await bounds(); expect(box.width).toBeGreaterThanOrEqual(size.width - 66); expect(box.height).toBeGreaterThanOrEqual(640);
  await page.getByRole("menuitem", { name: "Görünüm", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sol bölgeyi göster", exact: true }).click();
  await expect(page.locator("[data-dock-zone=left]")).toBeVisible();
});

test("layout survives reload, clamps corrupt entries and resets all zones and rulers", async ({ page }) => {
  await openDockMap(page);
  await page.keyboard.press(keys.left);
  const before = await savedLayout(page);
  await openDockMap(page);
  expect(await savedLayout(page)).toEqual(before);
  await page.evaluate(() => localStorage.setItem("smap.layout.v2", "{broken"));
  await openDockMap(page);
  await expect(page.locator("[data-dock-zone=left]")).toHaveAttribute("data-zone-state", "expanded");
  await page.keyboard.press(keys.right);
  await page.keyboard.press("Control+k"); await page.getByRole("combobox").fill("Düzeni sıfırla"); await page.keyboard.press("Enter");
  const layout = await savedLayout(page);
  expect(layout.zones.left.groups[0].active).toBe("tileset");
  expect(layout.zones.bottom.expandedPx).toBe(68);
  expect(layout.rulersVisible).toBe(true);
  for (const zone of zones) expect(layout.zones[zone].state).toBe("expanded");
});

for (const dpr of [1.25, 1.5]) for (const width of [1366, 1440, 1920]) test(`${width} DPR ${dpr}: rails retain labels and canvas area`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width, height: width === 1920 ? 1080 : width === 1440 ? 900 : 768 }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  await openDockMap(page);
  for (const zone of zones) await page.keyboard.press(keys[zone]);
  for (const panel of ["tileset", "inspector", "layers", "recent"]) await expect(page.locator(`[data-panel-tab=${panel}]`)).toBeVisible();
  const host = (await page.locator("[data-canvas-host]").boundingBox())!;
  expect(host.width).toBeGreaterThanOrEqual(width - 118); expect(host.height).toBeGreaterThanOrEqual(600);
  for (const zone of zones) {
    const box = (await page.locator(`[data-dock-zone=${zone}]`).boundingBox())!;
    expect(zone === "bottom" ? box.height : box.width).toBe(28);
  }
  await context.close();
});

test("pointer release commits once; canceled resize and viewport shrink preserve expanded sizes and camera", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 }); await openDockMap(page);
  const view = () => page.evaluate(() => {
    const h = (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number; y: number }; editor: { getState(): { zoom: number } } } }).__smap;
    const canvas = document.querySelector("[data-canvas-host]")!.getBoundingClientRect();
    const a = h.cellCenter(0, 0), b = h.cellCenter(1, 1), tile = b.x - a.x;
    return { zoom: h.editor.getState().zoom, x: (canvas.x + canvas.width / 2 - a.x) / tile, y: (canvas.y + canvas.height / 2 - a.y) / tile };
  });
  const before = await view();
  for (const zone of zones) {
    const splitter = page.locator(`[data-zone-splitter=${zone}]`);
    await splitter.focus(); await page.keyboard.press(zone === "bottom" ? "Shift+ArrowUp" : zone === "left" ? "Shift+ArrowRight" : "Shift+ArrowLeft");
    const stored = (await savedLayout(page)).zones[zone].expandedPx;
    const b = (await splitter.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + (zone === "left" ? 25 : zone === "right" ? -25 : 0), b.y + b.height / 2 - (zone === "bottom" ? 25 : 0), { steps: 5 });
    await splitter.dispatchEvent("pointercancel", { pointerId: 1 }); await page.mouse.up();
    expect((await savedLayout(page)).zones[zone].expandedPx).toBe(stored);
    await page.keyboard.press(keys[zone]);
  }
  const remembered = await savedLayout(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await savedLayout(page)).toEqual(remembered);
  for (const zone of zones) await page.keyboard.press(keys[zone]);
  await expect.poll(async () => (await view()).zoom).toBe(before.zoom);
  await expect.poll(async () => (await view()).x).toBeCloseTo(before.x);
  await expect.poll(async () => (await view()).y).toBeCloseTo(before.y);
});

test("desktop settings win, concurrent layout/locale writes merge, and reload waits for an active resize", async ({ page }) => {
  await openDockMap(page);
  await page.evaluate(async () => {
    const platform = await import(/* @vite-ignore */ String("/src/platform/index.ts"));
    const app = await import(/* @vite-ignore */ String("/src/platform/appSettings.ts"));
    const { defaultDockLayout } = await import(/* @vite-ignore */ String("/src/ui/layout/dockModel.ts"));
    const layout = defaultDockLayout(); layout.zones.left.state = "collapsed";
    const state = window as unknown as { desktopSettings: string };
    state.desktopSettings = JSON.stringify({ locale: "en", shortcuts: { "tool.brush": ["P"] }, $schema: "keep", layout });
    platform.setPlatform({ ...platform.getPlatform(), kind: "desktop", readSettings: async () => state.desktopSettings, writeSettings: async (text: string) => { await Promise.resolve(); state.desktopSettings = text; } });
    await app.loadAppSettings();
  });
  await expect(page.locator("[data-dock-zone=left]")).toHaveAttribute("data-zone-state", "collapsed");
  await page.evaluate(async () => {
    const { setAppLocale } = await import(/* @vite-ignore */ String("/src/platform/appSettings.ts"));
    const { useDockStore } = await import(/* @vite-ignore */ String("/src/ui/layout/dockStore.ts"));
    const locale = setAppLocale("tr");
    useDockStore.getState().setSize("bottom", 180, true); useDockStore.getState().setSize("bottom", 200, true);
    await locale;
  });
  const desktop = () => page.evaluate(() => JSON.parse((window as unknown as { desktopSettings: string }).desktopSettings));
  await expect.poll(async () => (await desktop()).layout.zones.bottom.expandedPx).toBe(200);
  expect(await desktop()).toMatchObject({ locale: "tr", shortcuts: { "tool.brush": ["P"] }, $schema: "keep" });
  const splitter = page.locator("[data-zone-splitter=right]"), b = (await splitter.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.evaluate(async () => {
    const w = window as unknown as { desktopSettings: string }; const settings = JSON.parse(w.desktopSettings);
    settings.layout.zones.right.state = "collapsed"; w.desktopSettings = JSON.stringify(settings);
    const { reloadAppSettingsIfChanged } = await import(/* @vite-ignore */ String("/src/platform/appSettings.ts")); await reloadAppSettingsIfChanged();
  });
  await expect(page.locator("[data-dock-zone=right]")).toHaveAttribute("data-zone-state", "expanded");
  await page.mouse.up();
  await expect(page.locator("[data-dock-zone=right]")).toHaveAttribute("data-zone-state", "collapsed");
});

test("Tab belongs to the canvas, hides the tool rail and minimap, and restores mixed zone states", async ({ page }) => {
  await openDockMap(page);
  await page.keyboard.press(keys.right); await page.locator("[data-zone-hide=bottom]").click();
  await page.locator("[data-library-view=all]").click();
  await page.locator("[data-tileset-search]").focus(); await page.keyboard.press("Tab");
  await expect(page.locator("[data-dock-zone=left]")).toBeVisible();
  const before = await savedLayout(page);
  await page.evaluate(async () => {
    const { getCanvasHandle } = await import(/* @vite-ignore */ String("/src/ui/canvas/canvasHandle.ts")); getCanvasHandle().setZoom(1); getCanvasHandle().setMinimapVisible(true);
  });
  await page.locator("[data-canvas-host]").focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("toolbar", { name: "Araçlar", exact: true })).toBeHidden();
  const visible = () => page.evaluate(async () => {
    const { getCanvasHandle } = await import(/* @vite-ignore */ String("/src/ui/canvas/canvasHandle.ts")); return getCanvasHandle().isMinimapVisible();
  });
  expect(await visible()).toBe(false);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("toolbar", { name: "Araçlar", exact: true })).toBeVisible();
  expect(await visible()).toBe(true); expect(await savedLayout(page)).toEqual(before);
  await expect(page.locator("[data-dock-zone=right]")).toHaveAttribute("data-zone-state", "collapsed");
  await expect(page.locator("[data-dock-zone=bottom]")).toBeHidden();
});

test("the default 68px Recent zone shows an entire 32px swatch", async ({ page }) => {
  await openDockMap(page);
  await page.locator("[data-tileset-grid]").click({ position: { x: 8, y: 8 } });
  await page.locator("[data-canvas-host]").click();
  const recent = page.locator("[data-recent-tile]").first();
  await expect(recent).toBeVisible();
  const strip = (await page.locator("[data-recent-strip]").boundingBox())!, swatch = (await recent.boundingBox())!;
  expect(swatch.height).toBe(34);
  expect(swatch.y).toBeGreaterThanOrEqual(strip.y);
  expect(swatch.y + swatch.height).toBeLessThanOrEqual(strip.y + strip.height);
});

test("a panel show command exits temporary canvas mode and reveals the current home", async ({ page }) => {
  await openDockMap(page);
  await page.locator("[data-canvas-host]").focus(); await page.keyboard.press("Tab");
  await page.keyboard.press("Control+k"); await page.getByRole("combobox").fill("Geçmişi göster"); await page.keyboard.press("Enter");
  await expect(page.locator("[data-panel=history]")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Araçlar", exact: true })).toBeVisible();
});
