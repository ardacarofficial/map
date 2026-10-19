import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { mapCells, openToolsProject, pickDockTile, type ToolsHook } from "../support/toolFeatures";
import { makeRoadStamp, acceptRoadStamp } from "../support/smartStamp";
import { openRoadSheet, selectRoad, saveRoad, dragRoad, roadCells } from "../support/smartStampDock";

async function openBorder(page: Page, palette = false) {
  if (palette) {
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("Kenar");
    await page.getByRole("option").filter({ hasText: "Kenar" }).click();
  } else {
    await page.getByRole("menuitem", { name: "Harita", exact: true }).click();
    await page.getByRole("menuitem", { name: "Kenar…", exact: true }).click();
  }
  return page.locator("[data-map-border-dialog]");
}
async function resize(page: Page, width: number, height: number) {
  await page.evaluate(({ width, height }) => {
    const h = (window as unknown as { __smap: ToolsHook & { setCamera(x: number, y: number, zoom: number): void } }).__smap;
    h.store.dispatch({ type: "resizeMap", width, height, offsetX: 0, offsetY: 0 });
    h.store.clearHistory(); h.setCamera(24, 24, 1);
  }, { width, height });
}
async function preview(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as { __smap: { smartPreview: { layers: { writes: { x: number; y: number; tile?: { tileId: number }; flags?: number }[] }[] } | null } }).__smap;
    return h.smartPreview?.layers.flatMap(l => l.writes) ?? [];
  });
}

test("map border: live ghost, gaps, inset, one undo/redo, and cancel leaves no trace", async ({ page }) => {
  await openToolsProject(page); await pickDockTile(page, 1, 1); await resize(page, 12, 9);
  const before = await mapCells(page, 12, 9);
  await page.evaluate(() => (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap.setCamera(24, 24, 0.09));
  const dialog = await openBorder(page);
  await expect.poll(async () => (await preview(page)).length).toBe(38);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: { lod: boolean } }).__smap.lod)).toBe(false);
  await page.evaluate(() => (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap.setCamera(24, 24, 1));
  expect(await mapCells(page, 12, 9)).toEqual(before);
  await dialog.getByRole("spinbutton", { name: "İç boşluk", exact: true }).fill("1");
  await dialog.getByRole("spinbutton", { name: "Kalınlık", exact: true }).fill("2");
  await dialog.getByRole("button", { name: "Boşluk ekle" }).click();
  await dialog.getByRole("spinbutton", { name: "Başlangıç", exact: true }).fill("3");
  await dialog.getByRole("spinbutton", { name: "Uzunluk", exact: true }).fill("2");
  await expect.poll(async () => (await preview(page)).length).toBe(48);
  const planned = await preview(page);
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await mapCells(page, 12, 9);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 12; x++) expect(after[y]![x]!.tileId).toBe(planned.some(p => p.x === x && p.y === y) ? 9 : null);
  expect(await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.undoDepth)).toBe(1);
  await page.locator("canvas[aria-label='map canvas']").first().focus(); await page.keyboard.press("Control+z");
  expect(await mapCells(page, 12, 9)).toEqual(before);
  await page.keyboard.press("Control+y"); expect(await mapCells(page, 12, 9)).toEqual(after);
  await openBorder(page, true); await page.keyboard.press("Escape");
  expect(await mapCells(page, 12, 9)).toEqual(after);
  await expect.poll(async () => (await preview(page)).length).toBe(0);
});

test("map border: side switches, narrow-map clamping, invalid fields, locked/hidden reasons", async ({ page }) => {
  await openToolsProject(page); await pickDockTile(page, 1, 1); await resize(page, 3, 9);
  const dialog = await openBorder(page);
  await dialog.getByRole("spinbutton", { name: "Kalınlık", exact: true }).fill("20");
  await expect(dialog.locator("[data-border-status]")).toContainText("kalınlık 2");
  await dialog.getByRole("spinbutton", { name: "Kalınlık", exact: true }).fill("0");
  await expect(dialog.getByRole("button", { name: "Uygula", exact: true })).toBeDisabled();
  await dialog.getByRole("spinbutton", { name: "Kalınlık", exact: true }).fill("1");
  for (const side of ["Üst", "Alt", "Sol", "Sağ"]) await dialog.getByRole("switch", { name: side, exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Uygula", exact: true })).toBeDisabled();
  await dialog.getByRole("switch", { name: "Üst", exact: true }).click();
  await expect.poll(async () => (await preview(page)).length).toBe(3);
  await page.evaluate(() => { const h = (window as unknown as { __smap: ToolsHook }).__smap; h.store.dispatch({ type: "setLayerProps", layerId: h.editor.getState().activeLayerId, props: { locked: true } }); });
  await expect(dialog.getByRole("button", { name: "Uygula", exact: true })).toBeDisabled();
  await expect(dialog.locator("[data-border-status]")).toContainText("kilitli");
  await page.evaluate(() => { const h = (window as unknown as { __smap: ToolsHook }).__smap; h.store.dispatch({ type: "setLayerProps", layerId: h.editor.getState().activeLayerId, props: { locked: false, visible: false } }); });
  await expect(dialog.locator("[data-border-status]")).toContainText("gizli");
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  expect((await mapCells(page, 3, 9)).flat().every(p => p.cell === 0)).toBe(true);
});

test("map border: current multi-tile brush repeats as a pattern on the active layer", async ({ page }) => {
  await openToolsProject(page); await resize(page, 8, 6);
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: ToolsHook }).__smap, ts = h.store.document.tilesets[0]!.id;
    h.editor.getState().setStamp({ width: 2, height: 1, palette: [{ tilesetId: ts, tileId: 9 }, { tilesetId: ts, tileId: 10 }], layers: [{ layerId: "source", name: "Source", cells: Uint32Array.of(1, 2) }] });
  });
  const dialog = await openBorder(page); await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  const cells = await mapCells(page, 8, 6);
  expect(cells[0]!.map(p => p.tileId)).toEqual([9, 10, 9, 10, 9, 10, 9, 10]);
  expect(cells[2]![3]!.cell).toBe(0);
  await page.locator("canvas[aria-label='map canvas']").first().focus(); await page.keyboard.press("Control+z");
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: ToolsHook }).__smap, ts = h.store.document.tilesets[0]!.id;
    h.editor.getState().setStamp(null);
    h.editor.getState().setRandomSet([{ tilesetId: ts, tileId: 9 }, { tilesetId: ts, tileId: 10 }]);
  });
  const randomDialog = await openBorder(page);
  const ghost = await preview(page);
  await randomDialog.getByRole("button", { name: "Uygula", exact: true }).click();
  const randomCells = await mapCells(page, 8, 6);
  for (const p of ghost) expect(randomCells[p.y]![p.x]!.tileId).toBe(p.tile!.tileId);
  expect(randomCells[2]![3]!.cell).toBe(0);
});

test("map border: smart road corners and gap ends match the ghost, with orientation and one undo", async ({ page }) => {
  await page.goto("/"); await makeRoadStamp(page); await acceptRoadStamp(page); await resize(page, 12, 10);
  await page.locator("canvas[aria-label='map canvas']").first().focus(); await page.keyboard.press("x");
  const dialog = await openBorder(page);
  await dialog.getByRole("button", { name: "Boşluk ekle" }).click();
  await dialog.getByRole("spinbutton", { name: "Başlangıç", exact: true }).fill("4");
  await dialog.getByRole("spinbutton", { name: "Uzunluk", exact: true }).fill("2");
  await expect.poll(async () => (await preview(page)).length).toBe(38);
  const planned = await preview(page);
  expect(new Set(planned.map(p => p.tile?.tileId)).size).toBeGreaterThan(4);
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  const actual = await mapCells(page, 12, 10);
  for (const p of planned) { expect(actual[p.y]![p.x]!.tileId).toBe(p.tile!.tileId); expect(actual[p.y]![p.x]!.cell & 0xe0000000).toBe((p.flags ?? 0) | 0); }
  expect(actual[0]![4]!.cell).toBe(0); expect(actual[0]![5]!.cell).toBe(0);
  await page.locator("canvas[aria-label='map canvas']").first().focus(); await page.keyboard.press("Control+z");
  expect((await mapCells(page, 12, 10)).flat().every(p => p.cell === 0)).toBe(true);
});

// These flows deliberately open Kenar before any gesture/save publishes the automatic atlas.

async function waitPrepared(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    const { activeSmartStamp } = await import(/* @vite-ignore */ String("/src/ui/stamps/smartStampSession.ts"));
    return !!activeSmartStamp();
  })).toBe(true);
}
for (const saved of [false, true]) test(`map border: fresh ${saved ? "saved stamp" : "direct selection"} stages its ghost and applies atlas plus cells in one undo`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openRoadSheet(page); await resize(page, 12, 10); await selectRoad(page); await waitPrepared(page);
  if (saved) await saveRoad(page);
  const before = await mapCells(page, 12, 10);
  expect((await roadCells(page)).generated).toHaveLength(0);
  let dialog = await openBorder(page);
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await preview(page)).length).toBe(40);
  const planned = await preview(page);
  expect((await roadCells(page)).generated).toHaveLength(0);
  expect(await mapCells(page, 12, 10)).toEqual(before);
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  expect((await roadCells(page)).generated).toHaveLength(0);
  expect(await mapCells(page, 12, 10)).toEqual(before);
  dialog = await openBorder(page);
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await mapCells(page, 12, 10);
  for (const p of planned) {
    expect(after[p.y]![p.x]!.tileId).toBe(p.tile!.tileId);
    expect((after[p.y]![p.x]!.cell & 0xe0000000) >>> 0).toBe((p.flags ?? 0) >>> 0);
  }
  expect((await roadCells(page)).generated).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.undoDepth)).toBe(1);
  await page.locator("canvas[aria-label='map canvas']").first().focus(); await page.keyboard.press("Control+z");
  expect(await mapCells(page, 12, 10)).toEqual(before);
  expect((await roadCells(page)).generated).toHaveLength(0);
  await page.keyboard.press("Control+y");
  expect(await mapCells(page, 12, 10)).toEqual(after);
  expect((await roadCells(page)).generated).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("map border: pending preparation disables Apply then updates the open dialog and ghost", async ({ page }) => {
  await openRoadSheet(page); await resize(page, 12, 10);
  // Hold preparation directly; generated PNG encoding is deferred until save/export.
  await page.evaluate(() => {
    const hook = (window as unknown as { __smap: { smartBrushPreparation: { hold(): void; release(): void } } }).__smap.smartBrushPreparation;
    hook.hold();
    (window as unknown as { releaseBorderBake(): void }).releaseBorderBake = () => hook.release();
  });
  await selectRoad(page);
  const dialog = await openBorder(page);
  await expect(dialog.locator("[data-border-status]")).toContainText("hazırlanıyor");
  await expect(dialog.getByRole("button", { name: "Uygula", exact: true })).toBeDisabled();
  expect((await roadCells(page)).generated).toHaveLength(0);
  await page.evaluate(() => (window as unknown as { releaseBorderBake(): void }).releaseBorderBake());
  await expect(dialog.getByRole("button", { name: "Uygula", exact: true })).toBeEnabled();
  await expect.poll(async () => (await preview(page)).length).toBe(40);
  expect((await roadCells(page)).generated).toHaveLength(0);
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  expect((await roadCells(page)).generated).toHaveLength(1);
});

test("map border: adjoining road repairs are in the ghost, commit and single undo", async ({ page }) => {
  await openRoadSheet(page); await resize(page, 12, 10); await selectRoad(page); await waitPrepared(page);
  await dragRoad(page, [[5, 1], [8, 1]]);
  const before = await mapCells(page, 12, 10);
  const dialog = await openBorder(page);
  await expect.poll(async () => (await preview(page)).filter(p => p.y === 1 && p.x >= 5 && p.x <= 8).length).toBe(4);
  const planned = await preview(page);
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  const after = await mapCells(page, 12, 10);
  for (const p of planned) {
    expect(after[p.y]![p.x]!.tileId).toBe(p.tile!.tileId);
    expect((after[p.y]![p.x]!.cell & 0xe0000000) >>> 0).toBe((p.flags ?? 0) >>> 0);
  }
  for (const x of [5, 6, 7, 8]) expect(after[1]![x]!.cell).not.toBe(before[1]![x]!.cell);
  await page.locator("canvas[aria-label='map canvas']").first().focus(); await page.keyboard.press("Control+z");
  expect(await mapCells(page, 12, 10)).toEqual(before);
  await page.keyboard.press("Control+y"); expect(await mapCells(page, 12, 10)).toEqual(after);
});
for (const [key, flags, pattern] of [
  ["x", 0x80000000, [[16, 15, 14], [28, 27, 26], [40, 39, 38]]],
  ["y", 0x40000000, [[38, 39, 40], [26, 27, 28], [14, 15, 16]]],
  ["z", 0xa0000000, [[38, 26, 14], [39, 27, 15], [40, 28, 16]]],
  ["Shift+z", 0x60000000, [[16, 28, 40], [15, 27, 39], [14, 26, 38]]],
] as const) test(`map border: Akıllı off respects ${key} in the ghost and applied pattern`, async ({ page }) => {
  await openRoadSheet(page); await resize(page, 12, 10); await selectRoad(page); await waitPrepared(page);
  await page.locator("[data-smart-brush]").click();
  await page.locator("canvas[aria-label='map canvas']").first().focus(); await page.keyboard.press(key);
  const dialog = await openBorder(page);
  await expect.poll(async () => (await preview(page)).length).toBe(40);
  const planned = await preview(page);
  for (const p of planned) {
    expect(p.tile!.tileId).toBe(pattern[p.y % 3]![p.x % 3]);
    expect(p.flags).toBe(flags);
  }
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  const cells = await mapCells(page, 12, 10);
  for (const p of planned) {
    expect(cells[p.y]![p.x]!.tileId).toBe(pattern[p.y % 3]![p.x % 3]);
    expect((cells[p.y]![p.x]!.cell & 0xe0000000) >>> 0).toBe(flags);
  }
  expect((await roadCells(page)).generated).toHaveLength(0);
});
