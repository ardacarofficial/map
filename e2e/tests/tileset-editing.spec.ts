import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { confirmTilesetCard, dropFile, expect, readOpfsText, sampleBytes, test, WELCOME_DROP } from "../support/fixtures";

test.setTimeout(120_000);
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", error => messages.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

const corePath = `/@fs${fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))}`;

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator(WELCOME_DROP)).toBeVisible();
  await dropFile(page, WELCOME_DROP, "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("[data-tileset-grid]")).toBeVisible();
}
async function tile(page: Page, x: number, y: number) {
  const grid = page.locator("[data-tileset-grid]").first(), r = (await grid.boundingBox())!;
  const scale = Number(await grid.getAttribute("data-tileset-scale"));
  return { x: r.x + (x + 0.5) * 32 * scale, y: r.y + (y + 0.5) * 32 * scale };
}
async function select(page: Page) {
  const a = await tile(page, 1, 1), b = await tile(page, 3, 2);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  await expect(page.locator("[data-selected-tiles]")).toHaveAttribute("data-selected-tiles", "9,10,11,17,18,19");
}
async function collections(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return useEditorStore.getState().project.store.document.collections as { id: string; name: string; columns: number; rows: number; cells: { x: number; y: number; tileId: number }[] }[];
  });
}
async function createPalette(page: Page) {
  await page.locator("[data-palette-new]").click();
  await page.locator("[data-dialog=text-prompt]").getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.locator("[data-palette-grid]")).toBeVisible();
}
for (const dpr of [1, 1.25, 1.5]) test.describe(`DPR ${dpr}`, () => {
  test.use({ deviceScaleFactor: dpr });
  test(`PNG cursor zoom, middle/Space pan, scroll and explicit Fit at DPR ${dpr}`, async ({ page }) => {
  await open(page);
  const vp = page.locator("[data-tileset-viewport]"), grid = page.locator("[data-tileset-grid]");
  const initial = (await grid.boundingBox())!;
  const p = { x: initial.x + 97, y: initial.y + 80 };
  const sourcePoint = async () => {
    const r = (await grid.boundingBox())!, scale = Number(await grid.getAttribute("data-tileset-scale"));
    return { x: (p.x - r.x) / scale, y: (p.y - r.y) / scale };
  };
  const before = await sourcePoint();
  await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await grid.getAttribute("data-tileset-scale"))).toBeGreaterThan(1);
  const after = await sourcePoint();
  await expect(grid.locator("[data-tileset-cell-label]")).toContainText("19");
  expect(Math.abs(before.x - after.x)).toBeLessThan(1);
  expect(Math.abs(before.y - after.y)).toBeLessThan(1);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("[data-selected-tiles]")).toHaveAttribute("data-selected-tiles", "19");
  for (const space of [false, true]) {
    const r = (await grid.boundingBox())!, v = (await vp.boundingBox())!;
    await page.mouse.move(v.x + 100, v.y + 100);
    if (space) await page.keyboard.down("Space");
    await page.mouse.down({ button: space ? "left" : "middle" });
    await page.mouse.move(v.x + 135, v.y + 122, { steps: 4 });
    await page.mouse.up({ button: space ? "left" : "middle" });
    if (space) await page.keyboard.up("Space");
    // Pointer samples and rendered origins round at fractional device scales.
    await expect.poll(async () => Math.abs((await grid.boundingBox())!.x - r.x - 35)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await grid.boundingBox())!.y - r.y - 22)).toBeLessThanOrEqual(1);
    await expect(page.locator("[data-selected-tiles]")).toHaveAttribute("data-selected-tiles", "19");
  }
  const r = (await grid.boundingBox())!;
  await page.keyboard.down("Shift"); await page.mouse.wheel(0, 80); await page.keyboard.up("Shift");
  await expect.poll(async () => (await grid.boundingBox())!.x).toBeLessThan(r.x);
  const scale = await grid.getAttribute("data-tileset-scale");
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(grid).toHaveAttribute("data-tileset-scale", scale!);
  await page.locator("[data-tileset-zoom-fit]").click();
  await expect.poll(async () => (await grid.boundingBox())!.width).toBeLessThanOrEqual((await vp.boundingBox())!.width);
  const fit = await grid.getAttribute("data-tileset-scale");
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(grid).toHaveAttribute("data-tileset-scale", fit!);
  const snapped = (await grid.boundingBox())!;
  expect(Math.abs(snapped.x * dpr - Math.round(snapped.x * dpr))).toBeLessThan(0.03);
});
});

test("PNG reference copy/cut, target picker, palette paste/cut and map clipboard scope", async ({ page }) => {
  await open(page); await select(page);
  const pngHash = () => page.evaluate(async () => {
    const { getTilesetImage } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", getTilesetImage("overworld-32").bytes))).join(",");
  });
  const original = await pngHash();
  await page.keyboard.press("Control+x");
  await expect(page.locator("[data-selected-tiles]")).toHaveCount(0);
  expect(await pngHash()).toBe(original);
  await page.keyboard.press("Control+v");
  await expect(page.getByText("PNG görünümüne yapıştırılamaz. Bir hedef palet seçin.")).toBeVisible();
  await createPalette(page);
  await page.locator("[data-tileset-viewport]").focus(); await page.keyboard.press("Control+v");
  await expect.poll(async () => (await collections(page))[0]!.cells.map(c => c.tileId)).toEqual([9, 10, 11, 17, 18, 19]);
  // Copy via PNG context menu and choose a palette from its destination picker.
  await page.locator("[data-tileset-switcher]").click(); await page.locator("[data-tileset-option=overworld-32]").click();
  await select(page); await page.keyboard.press("Control+c");
  const p = await tile(page, 1, 1); await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Palete yapıştır…", exact: true }).click();
  await page.locator("[data-paste-palette]").first().click();
  await expect(page.locator("[data-palette-grid]")).toBeVisible();
  await expect.poll(async () => (await collections(page))[0]!.cells.length).toBe(12);
  // Select the first row and cut, then undo.
  const a = await tile(page, 0, 0), b = await tile(page, 2, 0);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  await page.keyboard.press("Control+x");
  await expect.poll(async () => (await collections(page))[0]!.cells.length).toBe(9);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await collections(page))[0]!.cells.length).toBe(12);
  // Copying in the map must leave the panel reference clipboard alone.
  await page.locator("canvas[aria-label='map canvas']").first().focus(); await page.keyboard.press("Control+c");
  expect(await pngHash()).toBe(original);
});

test("tileset rename from F2, context menu and command palette; undo and reopened project metadata", async ({ page }) => {
  await open(page);
  await page.locator("[data-tileset-viewport]").focus(); await page.keyboard.press("F2");
  const dialog = page.locator("[data-dialog=text-prompt]");
  await expect(dialog.getByLabel("Ad", { exact: true })).toHaveValue("overworld-32");
  await dialog.getByLabel("Ad", { exact: true }).fill("Orman");
  await dialog.getByRole("button", { name: "Yeniden adlandır", exact: true }).click();
  await expect(page.locator("[data-tileset-switcher-name]")).toHaveText("Orman");
  await page.locator("[data-tileset-viewport]").focus(); await page.keyboard.press("Control+z");
  await expect(page.locator("[data-tileset-switcher-name]")).toHaveText("overworld-32");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("[data-tileset-switcher-name]")).toHaveText("Orman");
  const metadata = await page.evaluate(async (corePath) => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { serializeProject, parseProject } = await import(/* @vite-ignore */ corePath);
    const doc = useEditorStore.getState().project.store.document;
    return parseProject(serializeProject({ name: "World", levels: [], tilesets: doc.tilesets })).tilesets[0];
  }, corePath);
  expect(metadata).toMatchObject({ id: "overworld-32", name: "Orman", imagePath: "tilesets/overworld-32.png" });
  await page.locator("[data-tileset-switcher]").click({ button: "right" });
  await page.locator("[data-tileset-menu-item=rename]").click();
  await expect(dialog).toBeVisible(); await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("Yeniden adlandır");
  const command = page.getByRole("option").filter({ hasText: "Yeniden adlandır…" });
  await expect(command).toBeVisible(); await command.click();
  await expect(dialog.getByLabel("Ad", { exact: true })).toHaveValue("Orman");
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => readOpfsText(page, "project.smap")).not.toBeNull();
  await expect(page.getByLabel("Tüm değişiklikler kaydedildi")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Aç/ }).click();
  await expect(page.locator("[data-tileset-switcher-name]")).toHaveText("Orman");
});

test("palette rows grow, refuse occupied shrink, confirm trim, undo and paste grows rows", async ({ page }) => {
  await open(page); await select(page); await page.keyboard.press("Control+c"); await createPalette(page);
  const rows = page.locator("[data-palette-rows-input]");
  await expect(rows).toHaveValue("2");
  await rows.fill("6"); await rows.press("Enter");
  await expect.poll(async () => (await collections(page))[0]!.rows).toBe(6);
  const p = await tile(page, 0, 4); await page.mouse.click(p.x, p.y); await page.keyboard.press("Control+v");
  await expect.poll(async () => (await collections(page))[0]!.cells.length).toBe(6);
  await rows.fill("2"); await rows.press("Enter");
  await expect.poll(async () => (await collections(page))[0]!.rows).toBe(6);
  await expect(page.locator("[data-palette-columns]").getByRole("status")).toBeVisible();
  await expect(rows).toHaveValue("2");
  await expect(rows).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Sığmayan referansları kaldır", exact: true }).click();
  await page.locator("[data-palette-trim-confirm]").click();
  await expect.poll(async () => [(await collections(page))[0]!.rows, (await collections(page))[0]!.cells.length]).toEqual([2, 0]);
  await rows.fill("1"); await rows.press("Enter");
  await expect.poll(async () => (await collections(page))[0]!.rows).toBe(1);
  await page.locator("[data-tileset-viewport]").focus(); await page.keyboard.press("Control+z");
  await expect.poll(async () => (await collections(page))[0]!.rows).toBe(2);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => [(await collections(page))[0]!.rows, (await collections(page))[0]!.cells.length]).toEqual([6, 6]);
  const free = await tile(page, 0, 0);
  await page.mouse.click(free.x, free.y); await page.keyboard.press("Control+v");
  await expect.poll(async () => (await collections(page))[0]!.cells.length).toBe(12);
});

test("PNG source gutters and transparent border holes survive reference paste", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(WELCOME_DROP)).toBeVisible();
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(58, 39), ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#669988";
    ctx.fillRect(21, 2, 16, 16); ctx.fillRect(21, 21, 16, 16);
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer()));
  });
  await dropFile(page, WELCOME_DROP, "holes-16.png", bytes);
  const card = page.getByTestId("tileset-card");
  await card.getByLabel("Tile genişliği").fill("16");
  await card.getByLabel("Kenar (margin)").fill("2");
  await card.getByLabel("Aralık (spacing)").fill("3");
  await confirmTilesetCard(page);
  const grid = page.locator("[data-tileset-grid]");
  const r = (await grid.boundingBox())!;
  await page.mouse.click(r.x + 19.5, r.y + 10);
  await expect(page.locator("[data-selected-tiles]")).toHaveCount(0);
  await page.mouse.move(r.x + 10, r.y + 10); await page.mouse.down();
  await page.mouse.move(r.x + 48, r.y + 29, { steps: 4 }); await page.mouse.up();
  await page.keyboard.press("Control+c");
  await createPalette(page);
  const p = page.locator("[data-palette-grid]"), b = (await p.boundingBox())!;
  const size = Number(await p.getAttribute("data-cell-h"));
  await page.mouse.click(b.x + size / 2, b.y + size * 1.5); await page.keyboard.press("Control+v");
  await expect.poll(async () => (await collections(page))[0]!.rows).toBe(3);
  expect((await collections(page))[0]!.cells.map(c => [c.x, c.y, c.tileId])).toEqual([[1, 1, 1], [1, 2, 4]]);
  await expect(page.locator("[data-selected-tiles]")).toHaveAttribute("data-selected-tiles", "8,9,10,16,17,18");
});

test("v5 palette migration displays persisted rows without an extra spare row", async ({ page }) => {
  await open(page);
  await page.evaluate(async path => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { showPalette } = await import(/* @vite-ignore */ String("/src/ui/palettes/paletteActions.ts"));
    const core = await import(/* @vite-ignore */ path);
    const store = useEditorStore.getState().project.store;
    const json = JSON.parse(core.serializeProject({ name: "Old", levels: [], tilesets: store.document.tilesets, collections: [{ id: "old", name: "Old palette", columns: 4, rows: 5, cells: [{ x: 0, y: 3, tilesetId: "overworld-32", tileId: 1 }] }] }));
    json.documentFormatVersion = 5; delete json.collections[0].rows;
    const migrated = core.parseProject(JSON.stringify(json));
    store.dispatch({ type: "setCollection", collection: migrated.collections[0] });
    showPalette("old");
  }, corePath);
  await expect(page.locator("[data-palette-rows-input]")).toHaveValue("5");
  const grid = page.locator("[data-palette-grid]");
  expect((await grid.boundingBox())!.height).toBe(5 * Number(await grid.getAttribute("data-cell-h")));
});

test("trackpad and pinch, selection during Space, cancelled pan and dock move retain state", async ({ page }) => {
  await open(page); await select(page);
  const grid = page.locator("[data-tileset-grid]"), vp = page.locator("[data-tileset-viewport]");
  const v = (await vp.boundingBox())!;
  await page.mouse.move(v.x + 100, v.y + 100);
  const before = (await grid.boundingBox())!;
  await page.mouse.wheel(2, 8);
  await expect.poll(async () => (await grid.boundingBox())!.y).toBeLessThan(before.y);
  await expect(grid).toHaveAttribute("data-tileset-scale", "1");
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -1); await page.keyboard.up("Control");
  await expect.poll(async () => Number(await grid.getAttribute("data-tileset-scale"))).toBeGreaterThan(1);
  expect(Number(await grid.getAttribute("data-tileset-scale"))).toBeLessThan(1.01);
  // Space pressed after selection started must not turn that gesture into pan.
  const a = await tile(page, 0, 0), b = await tile(page, 1, 1);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.keyboard.down("Space");
  await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up(); await page.keyboard.up("Space");
  await expect(page.locator("[data-selected-tiles]")).toHaveAttribute("data-selected-tiles", "0,1,8,9");
  const lost = await tile(page, 4, 1);
  await page.mouse.move(lost.x, lost.y); await page.mouse.down();
  await page.mouse.move(lost.x + 1, lost.y + 1);
  await grid.evaluate(el => el.releasePointerCapture(1));
  await page.mouse.move(lost.x + 24, lost.y + 1); await page.mouse.up();
  await expect(page.locator("[data-selected-tiles]")).toHaveAttribute("data-selected-tiles", "0,1,8,9");
  await page.mouse.down({ button: "middle" });
  await vp.dispatchEvent("pointercancel", { pointerId: 1 });
  const cancelled = (await grid.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 20, { steps: 3 }); await page.mouse.up({ button: "middle" });
  expect((await grid.boundingBox())!.x).toBeCloseTo(cancelled.x, 0);
  const scale = await grid.getAttribute("data-tileset-scale");
  await page.evaluate(async () => {
    const { useDockStore } = await import(/* @vite-ignore */ String("/src/ui/layout/dockStore.ts"));
    useDockStore.getState().move("tileset", { zone: "right" });
  });
  await expect(page.locator("[data-tileset-grid]")).toHaveAttribute("data-tileset-scale", scale!);
  await expect(page.locator("[data-selected-tiles]")).toHaveAttribute("data-selected-tiles", "0,1,8,9");
});

test("single PNG survives dock collapse, visibility, moves and zero viewport without losing zoom", async ({ page }) => {
  await open(page);
  const vp = page.locator('[data-tileset-viewport]'), grid = page.locator('[data-tileset-grid]');
  const r = (await vp.boundingBox())!;
  await page.mouse.move(r.x + 100, r.y + 90); await page.mouse.wheel(0, -200);
  await expect.poll(async () => Number(await grid.getAttribute('data-tileset-scale'))).toBeGreaterThan(1);
  await page.mouse.down({ button: 'middle' }); await page.mouse.move(r.x + 140, r.y + 120, { steps: 4 }); await page.mouse.up({ button: 'middle' });
  const scale = (await grid.getAttribute('data-tileset-scale'))!;
  const reachable = async () => {
    await expect(grid).toHaveAttribute('data-tileset-scale', scale);
    await expect.poll(() => vp.evaluate(el => {
      const v = el.getBoundingClientRect(), g = el.querySelector('[data-tileset-grid]')!.getBoundingClientRect();
      return Math.min(v.right, g.right) - Math.max(v.left, g.left) >= 31 && Math.min(v.bottom, g.bottom) - Math.max(v.top, g.top) >= 31;
    })).toBe(true);
    await expect(page.locator('[data-tileset-zoom-label]')).toHaveText(`%${Math.round(Number(scale) * 100)}`);
  };
  const savedTransform = () => page.evaluate(async path => {
    const { useTilesetView } = await import(/* @vite-ignore */ path);
    return useTilesetView.getState().transforms['overworld-32'];
  }, '/src/ui/tileset/tilesetViewStore.ts');
  const saved = await savedTransform();
  await page.keyboard.press('Control+b'); await expect(vp).toBeHidden();
  await page.keyboard.press('Control+b'); await reachable();
  expect(await savedTransform()).toEqual(saved);
  for (const action of ['hide', 'show']) {
    await page.locator('[data-menu=view]').click();
    await page.locator("[data-submenu=docks]").hover();
    await page.locator(`[data-command="dock.left.${action}"]`).click();
  }
  await reachable();
  for (const zone of ['bottom', 'left']) {
    await page.locator('[data-panel-tab=tileset]').click({ button: 'right' });
    await page.locator('[data-context-item=move]').hover();
    await page.locator(`[data-context-item=move-${zone}]`).click();
    await reachable();
  }
  // A hidden, still-mounted viewport must ignore Fit, wheel and layout-generated scrolls.
  const before = await grid.boundingBox();
  await vp.evaluate(async el => { el.style.display = 'none'; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  await page.evaluate(async path => { const { fitTilesetViewport } = await import(/* @vite-ignore */ path); fitTilesetViewport(); }, '/src/commands/tilesetEditing.ts');
  await vp.evaluate(el => { el.dispatchEvent(new Event('scroll')); el.style.display = ''; });
  await reachable();
  expect((await grid.boundingBox())!.x).toBeCloseTo(before!.x, 0);
  // Previously saved offscreen pans are repaired on the next usable viewport.
  await vp.evaluate(async el => { el.style.display = 'none'; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  await page.evaluate(async path => { const { useTilesetView } = await import(/* @vite-ignore */ path); useTilesetView.getState().setTransform('overworld-32', { x: -9000, y: 9000, scale: Number(document.querySelector('[data-tileset-grid]')!.getAttribute('data-tileset-scale')) }); }, '/src/ui/tileset/tilesetViewStore.ts');
  await vp.evaluate(el => { el.style.display = ''; });
  await reachable();
});
