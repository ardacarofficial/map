import type * as CoreModule from "../../packages/core/src/index";
import type * as ThumbModule from "../../packages/editor/src/canvas/mapThumbnail";
import type * as EncoderModule from "../../packages/editor/src/platform/recentThumbnail";
import { fileURLToPath } from "node:url";

import { expect, startWithTileset, test } from "../support/fixtures";

const corePath = `/@fs${fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))}`;

test("saved recents keep a thumbnail after reload and reopening the project", async ({ page }) => {
  await page.goto("/");
  await startWithTileset(page);
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await canvas.focus();
  await page.keyboard.press("Shift+Digit1");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("Control+s");
  await expect(page.getByLabel("Tüm değişiklikler kaydedildi")).toBeVisible();
  // Wait for the optional idle update in persistence, not just the save indicator.
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/platform/index.ts";
    const { getPlatform } = await import(path) as { getPlatform(): { recents: { list(): Promise<{ thumbnail?: string }[]> } } };
    return (await getPlatform().recents.list())[0]?.thumbnail?.startsWith("data:image/png;base64,");
  })).toBe(true);
  await page.reload();
  const card = page.locator("[data-recent-project]").first();
  await expect(card.locator("img")).toBeVisible();
  const before = await card.locator("img").getAttribute("src");
  await card.click();
  await expect(canvas).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByLabel("Tüm değişiklikler kaydedildi")).toBeVisible();
  await page.reload();
  await expect(card.locator("img")).toBeVisible();
  expect(await card.locator("img").getAttribute("src")).toBe(before);
});

test("live CPU snapshots match the legacy recent renderer's RGBA pixels", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async (corePath) => {
    const thumbPath = "/src/canvas/mapThumbnail.ts";
    const encoderPath = "/src/platform/recentThumbnail.ts";
    const { MapThumbnail } = await import(thumbPath) as typeof ThumbModule;
    const { captureMapThumbnail } = await import(encoderPath) as typeof EncoderModule;
    const { createDocument, MapStore, FLIP_H, FLIP_V, FLIP_D, makeCell } = await import(corePath) as typeof CoreModule;
    const tile = document.createElement("canvas");
    tile.width = 8;
    tile.height = 4;
    const ctx = tile.getContext("2d")!;
    const pixels = ctx.createImageData(8, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4;
      pixels.data.set([x < 4 ? 220 : 30, y < 2 ? 60 : 180, x * 25, [0, 64, 128, 255][(x + y) % 4]!], i);
    }
    ctx.putImageData(pixels, 0, 0);
    const read = async (url: string) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const c = document.createElement("canvas");
      c.width = bitmap.width; c.height = bitmap.height;
      const context = c.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return context.getImageData(0, 0, c.width, c.height);
    };
    const results = [];
    // k=4/3/2/1, fractional/chunk scaling, partial chunks, large overview
    // decimation, non-square dimensions and the old tiny-map integer upscale.
    for (const [width, height] of [[5, 3], [48, 31], [64, 48], [80, 33], [192, 47], [257, 65], [1024, 73], [2051, 39]]) {
      const store = new MapStore(createDocument({ width: width!, height: height!, tileWidth: 4, tileHeight: 4 }));
      store.dispatch({ type: "addTileset", tileset: { id: "t", name: "t", imagePath: "t.png", tileWidth: 4, tileHeight: 4, columns: 2, rows: 1, margin: 0, spacing: 0 } });
      const a = store.getOrAddPaletteIndex("t", 0);
      const b = store.getOrAddPaletteIndex("t", 1);
      for (let layer = 0; layer < 3; layer++) {
        const id = store.dispatch({ type: "addLayer", layer: { name: `Layer ${layer}` } });
        store.dispatch({ type: "setLayerProps", layerId: id, props: { opacity: layer === 1 ? 0.6 : 1 } });
        const cells = [];
        for (let y = 0; y < height!; y++) for (let x = 0; x < width!; x++) {
          if ((x + y + layer) % 3 === 0) continue;
          cells.push({ x, y, cell: makeCell((x + layer) % 2 ? a : b, ((x & 1) ? FLIP_H : 0) | ((y & 1) ? FLIP_V : 0) | ((x & 2) ? FLIP_D : 0)) });
        }
        store.dispatch({ type: "paintCells", layerId: id, cells });
      }
      const live = new MapThumbnail(store, () => tile, () => {});
      // This is the old capture path: separate maxPx=192 renderer, forced drain,
      // then nearest integer upscale and PNG. Kept strictly in this comparison.
      const legacy = new MapThumbnail(store, () => tile, () => {}, 192);
      while (live.pending) live.update(50);
      while (legacy.pending) legacy.update(50);
      const out = document.createElement("canvas");
      const scale = Math.max(1, Math.floor(192 / Math.max(legacy.canvas.width, legacy.canvas.height)));
      out.width = legacy.canvas.width * scale; out.height = legacy.canvas.height * scale;
      const context = out.getContext("2d")!;
      context.imageSmoothingEnabled = false;
      context.drawImage(legacy.canvas, 0, 0, out.width, out.height);
      const old = await read(out.toDataURL("image/png"));
      const next = await read(captureMapThumbnail(live.snapshot()!)!);
      let differences = 0;
      for (let i = 0; i < old.data.length; i++) if (old.data[i] !== next.data[i]) differences++;
      results.push({ width, height, sizeMatches: old.width === next.width && old.height === next.height, differences });
      live.destroy(); legacy.destroy();
    }
    return results;
  }, corePath);
  for (const result of results) {
    expect(result.sizeMatches, JSON.stringify(result)).toBe(true);
    expect(result.differences, JSON.stringify(result)).toBe(0);
  }
});
