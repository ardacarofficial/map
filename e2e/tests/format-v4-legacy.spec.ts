import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, expectWelcome, readOpfsText, test } from "../support/fixtures";
import { dragRoad } from "../support/smartStamp";
import { waitForSaveIdle } from "../support/smartStampDock";

const fixture = (name: string) => [...readFileSync(new URL(`../../packages/core/test/fixtures/v15/${name}`, import.meta.url))];
type LayerSnapshot = { name: string; type: string; cells: number[] };

async function openLegacy(page: Page, projectName: string, stampNames: string[]) {
  await page.goto("/");
  await expectWelcome(page);
  const files = [
    { path: "project.smap", bytes: fixture(projectName) },
    { path: "levels/main.json", bytes: fixture("v3-level.json") },
    ...stampNames.map(name => ({ path: `stamps/${name}`, bytes: fixture(name) })),
    { path: "tilesets/baked.recipe.json", bytes: fixture("v3-stamp.json") },
    { path: "tilesets/source.png", bytes: fixture("v3-source.png") },
    { path: "tilesets/baked.png", bytes: fixture("v3-baked.png") },
  ];
  await page.evaluate(async files => {
    const root = await navigator.storage.getDirectory();
    for (const { path, bytes } of files) {
      const parts = path.split("/"), name = parts.pop()!;
      let dir = root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writer.write(new Uint8Array(bytes)); await writer.close();
    }
  }, files);
  await page.keyboard.press("Control+o");
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.hasOwn(window, "__smap"))).toBe(true);
  await page.locator("[data-panel-tab=stamps]").click();
}

for (const value of [1, 3]) test(`pre-role v1 stamp terrain ${value} is removed while tile flags and explicit collision survive placement and reopen`, async ({ page }) => {
  await openLegacy(page, "v3-project.json", [`v1-pre-role-${value}-stamp.json`]);
  await page.locator(`[data-stamp-id='pre-role-${value}']`).click();
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await canvas.focus(); await page.keyboard.press("b");
  await page.evaluate(() => (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap.setCamera(24, 24, 1));
  await dragRoad(page, [[18, 12]]);
  const snapshot = (): Promise<LayerSnapshot[]> => page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const doc = useEditorStore.getState().project.store.document;
    return doc.layers.map((l: { name: string; type: string; getCell(x: number, y: number): number }) => ({ name: l.name, type: l.type, cells: Array.from({ length: 9 }, (_, i) => l.getCell(18 + i % 3, 12 + Math.floor(i / 3))) }));
  });
  await expect.poll(async () => (await snapshot()).find(l => l.name === "Road")?.cells.map(c => (c & 0xe0000000) >>> 0)).toEqual([0, 0x80000000, 0x40000000, 0x20000000, 0xe0000000, 0, 0, 0, 0]);
  const placed = await snapshot();
  expect(placed.some(l => ["Terrain", "Old"].includes(l.name))).toBe(false);
  expect(placed.find(l => l.name === "Collision")?.cells).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0]);
  await canvas.focus(); await page.keyboard.press("Control+s");
  await expect.poll(async () => JSON.parse((await readOpfsText(page, `stamps/pre-role-${value}.json`)) ?? "null")?.documentFormatVersion).toBe(5);
  await waitForSaveIdle(page);
  await page.reload(); await expectWelcome(page); await page.getByRole("button", { name: /^Aç…/ }).click();
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible({ timeout: 30_000 });
  expect(await snapshot()).toEqual(placed);
});

test("legacy library and sidecar use the referenced road family through drawing, undo and save/reopen", async ({ page }) => {
  await openLegacy(page, "v3-mirrored-unrelated-project.json", ["v3-stamp.json"]);
  await page.getByRole("listbox", { name: "Katmanlar", exact: true }).getByRole("option").filter({ hasText: "Tiles" }).click();
  await page.locator("[data-stamp-id=road]").click();
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await canvas.focus(); await page.keyboard.press("b");
  await page.evaluate(() => (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap.setCamera(24, 24, 1));
  const ids = () => page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const doc = useEditorStore.getState().project.store.document;
    return [18, 19, 20].map(x => { const cell = doc.getLayer("tiles").getCell(x, 12); return cell ? doc.palette.get(cell & 0x1fffffff).tileId : null; });
  });
  const before = await ids();
  await dragRoad(page, [[18, 12], [20, 12]]);
  await expect.poll(ids).toEqual([12, 31, 29]);
  await page.keyboard.press("Control+z"); await expect.poll(ids).toEqual(before);
  await page.keyboard.press("Control+Shift+z"); await expect.poll(ids).toEqual([12, 31, 29]);
  await page.keyboard.press("Control+s");
  await expect.poll(async () => JSON.parse((await readOpfsText(page, "stamps/road.json")) ?? "null")?.documentFormatVersion).toBe(5);
  await waitForSaveIdle(page);
  for (const path of ["stamps/road.json", "tilesets/baked.recipe.json"]) {
    const saved = JSON.parse((await readOpfsText(page, path))!);
    const profile = saved.nineSlice.road.profile.tiles as { tileId: number; mask: number }[];
    expect(profile.find(t => t.tileId === 12)?.mask).toBe(4);
    expect(saved.nineSlice.road).not.toHaveProperty("setId");
  }
  await page.reload(); await expectWelcome(page); await page.getByRole("button", { name: /^Aç…/ }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 }); await expect.poll(ids).toEqual([12, 31, 29]);
});
