import type { Page } from "@playwright/test";
import type { MapStore } from "../../packages/core/src";
import { confirmTilesetCard, dropFile, expect, sampleBytes, test, WELCOME_DROP } from "../support/fixtures";

async function openMap(page: Page) {
  await page.goto("/");
  await dropFile(page, WELCOME_DROP, "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
}

async function dropSources(page: Page) {
  const files = ["overworld-32.png", "dungeon-16.png"].map(name => ({ name, bytes: sampleBytes(`tilesets/${name}`) }));
  await page.evaluate(files => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: "image/png" }));
    for (const type of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, files);
}

for (const tile of [16, 32]) test(`active ${tile}px map supplies single and bulk defaults; image dimensions and remembered size do not override it`, async ({ page }) => {
  await openMap(page);
  await page.evaluate(tile => {
    const store = (window as unknown as { __smap: { store: MapStore } }).__smap.store;
    store.dispatch({ type: "resizeMap", width: 64, height: 48, tileWidth: tile, tileHeight: tile });
    localStorage.setItem("smap.tilesetImport.last", JSON.stringify({ tileWidth: 64, tileHeight: 64, margin: 2, spacing: 3 }));
  }, tile);
  for (const name of ["dungeon-16.png", "overworld-32.png"]) {
    await dropFile(page, "body", name, sampleBytes(`tilesets/${name}`));
    const card = page.getByTestId("tileset-card");
    await expect(card.getByLabel("Tile genişliği")).toHaveValue(String(tile));
    await expect(card.getByLabel("Tile yüksekliği")).toHaveValue(String(tile));
    await card.getByLabel("Tile genişliği").fill("24");
    await expect(card.getByLabel("Tile yüksekliği")).toHaveValue("24");
    await card.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await expect(card).toBeHidden();
  }
  await dropSources(page);
  const bulk = page.getByTestId("bulk-import-card");
  await expect(bulk).toBeVisible();
  for (const name of ["dungeon-16.png", "overworld-32.png"]) {
    await expect(bulk.locator(`[data-bulk-row='${name}'] [data-bulk-size]`)).toHaveValue(String(tile));
  }
  const row = bulk.locator("[data-bulk-row='dungeon-16.png']");
  await row.locator("[data-bulk-size]").fill("24×16");
  await expect(row.locator("[data-bulk-size]")).toHaveValue("24×16");
  await expect(row.locator("[data-bulk-grid]")).toHaveText("4×4");
  await bulk.getByRole("button", { name: "Vazgeç", exact: true }).click();
});

test("map offers 25/50/150 percent presets, custom zoom and intermediate mouse wheel steps", async ({ page }) => {
  await openMap(page);
  const actualZoom = () => page.evaluate(() => {
    const h = (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number } } }).__smap;
    return (h.cellCenter(1, 0).x - h.cellCenter(0, 0).x) / 32;
  });
  for (const scale of [0.25, 0.5, 1.5]) {
    await page.locator("[data-zoom-menu]").click();
    await page.locator(`[data-zoom-preset='${scale}']`).click();
    await expect.poll(actualZoom).toBeCloseTo(scale, 4);
  }
  await page.locator("[data-zoom-input]").fill("87.5");
  await page.locator("[data-zoom-input]").press("Enter");
  await expect.poll(actualZoom).toBeCloseTo(0.875, 4);
  await page.locator("[data-zoom-input]").fill("100");
  await page.locator("[data-zoom-input]").press("Enter");
  await expect.poll(actualZoom).toBeCloseTo(1, 4);
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await canvas.hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(actualZoom).toBeCloseTo(1.5, 4);
  await page.mouse.wheel(0, 100);
  await expect.poll(actualZoom).toBeCloseTo(1, 4);
});

test("all tilesets zoom at the cursor and pan freely in both directions without changing selection", async ({ page }) => {
  await openMap(page);
  await page.locator("[data-library-view='all']").click();
  const viewport = page.locator("[data-tileset-view='all']");
  const grid = viewport.locator("[data-tileset-grid]").first();
  const selected = () => page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return useEditorStore.getState().selection;
  });
  const scale = Number(await grid.getAttribute("data-tileset-scale"));
  await grid.click({ position: { x: 16 * scale, y: 16 * scale } });
  const selection = await selected();
  expect(selection).not.toBeNull();
  for (const [dx, dy, button] of [[60, 40, "middle"], [-75, -50, "left"]] as const) {
    const before = (await grid.boundingBox())!;
    const vp = (await viewport.boundingBox())!;
    const x = vp.x + vp.width / 2, y = vp.y + vp.height / 2;
    await page.mouse.move(x, y);
    if (button === "left") await page.keyboard.down("Space");
    await page.mouse.down({ button });
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up({ button });
    if (button === "left") await page.keyboard.up("Space");
    await expect.poll(async () => (await grid.boundingBox())!.x - before.x).toBeCloseTo(dx, 0);
    await expect.poll(async () => (await grid.boundingBox())!.y - before.y).toBeCloseTo(dy, 0);
    expect(await selected()).toEqual(selection);
  }
  const before = (await grid.boundingBox())!;
  const vp = (await viewport.boundingBox())!;
  const x = Math.max(before.x, vp.x) + Math.min(before.width, vp.width) / 3;
  const y = Math.max(before.y, vp.y) + Math.min(before.height, vp.height) / 3;
  const oldScale = Number(await grid.getAttribute("data-tileset-scale"));
  const source = { x: (x - before.x) / oldScale, y: (y - before.y) / oldScale };
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await grid.getAttribute("data-tileset-scale"))).toBeGreaterThan(oldScale);
  const after = (await grid.boundingBox())!;
  const nextScale = Number(await grid.getAttribute("data-tileset-scale"));
  expect(Math.abs(after.x + source.x * nextScale - x)).toBeLessThan(1.1);
  expect(Math.abs(after.y + source.y * nextScale - y)).toBeLessThan(1.1);
  expect(await selected()).toEqual(selection);
});
