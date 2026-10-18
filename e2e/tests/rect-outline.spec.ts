import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { dragRectangle, mapCells, openToolsProject, pickDockTile, type ToolsHook } from "../support/toolFeatures";

async function outline(page: Page) {
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("r");
  await page.getByRole("radio", { name: "Çerçeve", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Kalınlık" })).toHaveValue("1");
}

test("rectangle outline: hollow band, thickness to filled, one undo and default filled option", async ({ page }) => {
  await openToolsProject(page);
  await pickDockTile(page, 1, 1);
  await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.clearHistory());
  await outline(page);
  await dragRectangle(page, 2, 2, 8, 7);
  let cells = await mapCells(page, 10, 9);
  for (let y = 2; y <= 7; y++) for (let x = 2; x <= 8; x++) expect(cells[y]![x]!.tileId).toBe(x === 2 || x === 8 || y === 2 || y === 7 ? 9 : null);
  expect(await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.undoDepth)).toBe(1);
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Control+z");
  expect((await mapCells(page, 10, 9)).flat().every(c => c.cell === 0)).toBe(true);
  await page.getByRole("spinbutton", { name: "Kalınlık" }).fill("8");
  await dragRectangle(page, 2, 2, 8, 7);
  cells = await mapCells(page, 10, 9);
  expect(cells[4]![5]!.tileId).toBe(9);
  await page.getByRole("radio", { name: "Dolu", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Kalınlık" })).toHaveCount(0);
});

test("rectangle outline: multi-tile pattern and random sources keep the interior empty", async ({ page }) => {
  await openToolsProject(page);
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: ToolsHook }).__smap;
    const s = h.editor.getState();
    const ts = h.store.document.tilesets[0]!.id;
    s.setStamp({ width: 2, height: 1, palette: [{ tilesetId: ts, tileId: 9 }, { tilesetId: ts, tileId: 10 }], layers: [{ layerId: s.activeLayerId, name: "A", cells: Uint32Array.of(1, 2) }] });
    h.store.clearHistory();
  });
  await outline(page);
  await dragRectangle(page, 2, 2, 8, 7);
  let cells = await mapCells(page, 10, 9);
  for (let x = 2; x <= 8; x++) expect(cells[2]![x]!.tileId).toBe(x % 2 === 0 ? 9 : 10);
  expect(cells[4]![5]!.tileId).toBeNull();
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Control+z");
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: ToolsHook }).__smap;
    const ts = h.store.document.tilesets[0]!.id;
    h.editor.getState().setStamp(null);
    h.editor.getState().setRandomSet([{ tilesetId: ts, tileId: 9 }, { tilesetId: ts, tileId: 10 }]);
  });
  await dragRectangle(page, 2, 2, 8, 7);
  cells = await mapCells(page, 10, 9);
  expect(cells[4]![5]!.tileId).toBeNull();
  for (let x = 2; x <= 8; x++) expect([9, 10]).toContain(cells[2]![x]!.tileId);
  const before = cells;
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  expect(await mapCells(page, 10, 9)).toEqual(before);
});

test("rectangle outline: random saved stamp candidates stay inside the band", async ({ page }) => {
  await openToolsProject(page);
  await page.evaluate(async () => {
    const { useRandomBrush } = await import(/* @vite-ignore */ String("/src/commands/randomBrush.ts"));
    const { useProjectLibrary } = await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));
    const h = (window as unknown as { __smap: ToolsHook }).__smap;
    const ts = h.store.document.tilesets[0]!.id;
    h.editor.getState().setRandomSet([{ tilesetId: ts, tileId: 9 }]);
    useProjectLibrary.getState().addStamp({ id: "wide", name: "Wide", width: 3, height: 3, palette: [{ tilesetId: ts, tileId: 10 }], layers: [{ layerId: "source", name: "Zemin", cells: new Uint32Array(9).fill(1) }] });
    useRandomBrush.setState({ stamps: [{ kind: "stamp", stampId: "wide", weight: 100 }], randomFlip: true, chunk: { w: 2, h: 2 } });
    h.store.clearHistory();
  });
  await outline(page);
  await dragRectangle(page, 2, 2, 8, 7);
  const cells = await mapCells(page, 12, 12);
  let nonempty = 0;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (cells[y]![x]!.cell) {
    nonempty++;
    expect(x >= 2 && x <= 8 && y >= 2 && y <= 7).toBe(true);
    expect(x === 2 || x === 8 || y === 2 || y === 7).toBe(true);
  }
  expect(nonempty).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.undoDepth)).toBe(1);
});

test("rectangle outline: terrain band and Shift/Alt modifiers", async ({ page }) => {
  await openToolsProject(page, "blob47-godot-32.png");
  await page.evaluate(async () => {
    const { defineTerrain } = await import(/* @vite-ignore */ String("/src/commands/terrainActions.ts"));
    const h = (window as unknown as { __smap: ToolsHook }).__smap;
    const result = defineTerrain({ tilesetId: h.store.document.tilesets[0]!.id, template: "blob47-godot", origin: { col: 0, row: 0 }, setId: null, name: "Grass", color: "#5fb85f", background: 0 });
    if (!result) throw new Error("terrain fixture failed");
    h.store.clearHistory();
  });
  await outline(page);
  await dragRectangle(page, 2, 2, 8, 7);
  let cells = await mapCells(page, 15, 15);
  expect(cells[2]![2]!.tileId).not.toBeNull();
  expect(cells[4]![5]!.tileId).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { __smap: ToolsHook }).__smap.store.undoDepth)).toBe(1);
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Control+z");
  // Modifier keys pressed during the drag avoid the temporary Alt eyedropper at press.
  const { cellPoint } = await import("../support/toolFeatures");
  const a = await cellPoint(page, 7, 7);
  const b = await cellPoint(page, 10, 9);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.keyboard.down("Alt");
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.keyboard.up("Shift");
  cells = await mapCells(page, 15, 15);
  expect(cells[4]![4]!.tileId).not.toBeNull();
  expect(cells[10]![10]!.tileId).not.toBeNull();
  expect(cells[7]![7]!.tileId).toBeNull();
});
