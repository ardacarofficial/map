import type { Locator, Page } from "@playwright/test";

import { confirmTilesetCard, dropFile, expect, sampleBytes, test, WELCOME_DROP } from "../support/fixtures";

type Hook = {
  editor: { getState(): { stamp: { width: number; height: number } | null; selection: { tileId: number } | null; tool: string } };
  store: {
    document: {
      layers: { type: string; getCell(x: number, y: number): number }[];
      palette: { get(i: number): { tilesetId: string; tileId: number } | undefined };
    };
  };
  cellCenter(x: number, y: number): { x: number; y: number } | null;
};

/** Tile id drawn at (x, y) of the first tile layer (null = empty). */
const tileAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const store = (window as unknown as { __smap: Hook }).__smap.store;
      const layer = store.document.layers.find((l) => l.type === "tile")!;
      const cell = layer.getCell(x!, y!);
      return cell === 0 ? null : store.document.palette.get(cell & 0x1fffffff)!.tileId;
    },
    [x, y],
  );

const cellCenter = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => (window as unknown as { __smap: Hook }).__smap.cellCenter(x!, y!), [x, y]);

/** Page position of the centre of tileset cell (col, row). */
async function tilesetCell(image: Locator, col: number, row: number) {
  const box = (await image.boundingBox())!;
  const scale = Number(await image.getAttribute("data-tileset-scale"));
  const size = 32 * scale;
  return { x: box.x + (col + 0.5) * size, y: box.y + (row + 0.5) * size };
}

test("tileset panel: drag a 3×2 block, paint it, Ctrl-toggle, right-click pick highlights", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await dropFile(page, WELCOME_DROP, "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await expect(canvas).toBeVisible();

  const grid = page.getByRole("grid", { name: /overworld/i });
  const image = grid.locator("[data-tileset-grid]");
  await expect(image).toBeVisible();
  // The default left host fits the sheet at a crisp fractional scale.
  const initialScale = Number(await image.getAttribute("data-tileset-scale"));
  expect(initialScale).toBeGreaterThan(0);
  expect(initialScale * 32).toBe(Math.round(initialScale * 32));
  expect((await image.boundingBox())!.width).toBeLessThanOrEqual((await grid.boundingBox())!.width);
  const selected = grid.locator("[data-selected-tiles]");

  // ---- Drag-select cells (1,1)–(3,2): ids 9,10,11 / 17,18,19.
  const from = await tilesetCell(image, 1, 1);
  const to = await tilesetCell(image, 3, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(grid.locator("[data-tileset-cell-label]")).toHaveText("3 × 2");
  await page.mouse.up();
  await expect(selected).toHaveAttribute("data-selected-tiles", "9,10,11,17,18,19");
  const stamp = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.editor.getState().stamp);
  expect(stamp && [stamp.width, stamp.height]).toEqual([3, 2]);
  // The Denetçi's FIRÇA card shows the block.
  await expect(page.locator("[data-inspector-brush]")).toContainText("3 × 2 tile");

  // ---- Paint once on the map: 6 cells in the same layout.
  await canvas.focus();
  await page.keyboard.press("Shift+Digit1");
  await page.waitForTimeout(300);
  const at = (await cellCenter(page, 10, 10))!;
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => tileAt(page, 10, 10)).toBe(9);
  expect(await tileAt(page, 11, 10)).toBe(10);
  expect(await tileAt(page, 12, 10)).toBe(11);
  expect(await tileAt(page, 10, 11)).toBe(17);
  expect(await tileAt(page, 11, 11)).toBe(18);
  expect(await tileAt(page, 12, 11)).toBe(19);
  expect(await tileAt(page, 13, 10)).toBeNull();
  expect(await tileAt(page, 10, 12)).toBeNull();

  // ---- Ctrl + click adds a cell (a clip with holes), again removes it.
  const extra = await tilesetCell(image, 5, 0);
  await page.keyboard.down("Control");
  await page.mouse.click(extra.x, extra.y);
  await page.keyboard.up("Control");
  await expect(selected).toHaveAttribute("data-selected-tiles", "5,9,10,11,17,18,19");
  const holed = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.editor.getState().stamp);
  expect(holed && [holed.width, holed.height]).toEqual([5, 3]);
  await page.keyboard.down("Control");
  await page.mouse.click(extra.x, extra.y);
  await page.keyboard.up("Control");
  await expect(selected).toHaveAttribute("data-selected-tiles", "9,10,11,17,18,19");

  // ---- Plain click: one tile, arrow keys move it.
  const single = await tilesetCell(image, 6, 4);
  await page.mouse.click(single.x, single.y);
  await expect(selected).toHaveAttribute("data-selected-tiles", "38");
  await page.keyboard.press("ArrowRight");
  await expect(selected).toHaveAttribute("data-selected-tiles", "39");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(selected).toHaveAttribute("data-selected-tiles", "39,47");

  // ---- Right-click pick on the map highlights the picked tile in the panel.
  const pick = (await cellCenter(page, 11, 11))!;
  await page.mouse.click(pick.x, pick.y, { button: "right" });
  await expect(selected).toHaveAttribute("data-selected-tiles", "18");
  const sel = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.editor.getState().selection);
  expect(sel?.tileId).toBe(18);

  // ---- The mode control switches directly to Katı; Esc returns to picking.
  await page.locator("[data-tileset-mode='solid']").click();
  await expect(page.locator("[data-tileset-mode='solid']")).toHaveAttribute("aria-checked", "true");
  await page.locator("[data-tileset-mode='terrain']").click();
  await expect(page.locator("[data-tileset-mode='terrain']")).toHaveAttribute("aria-checked", "true");
  await grid.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-tileset-mode='pick']")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("[data-tileset-mode='pick']")).toHaveAttribute("aria-checked", "true");

  expect(errors).toEqual([]);
});

test("tileset panel: the wheel works like the map (notch zooms at the cursor, Shift scrolls sideways, trackpad pans), Space-drag pans", async ({ page }) => {
  await page.goto("/");
  await dropFile(page, WELCOME_DROP, "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  const grid = page.getByRole("grid", { name: /overworld/i });
  const image = grid.locator("[data-tileset-grid]");
  await expect(image).toBeVisible();
  const scale = async () => Number(await image.getAttribute("data-tileset-scale"));
  const scroll = () => grid.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
  const before = await scale();

  // Mouse notches zoom at the cursor; reach 4× so both host dimensions overflow.
  const box = (await grid.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.wheel(0, -100);
  await expect.poll(scale).toBeGreaterThan(before);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(300);
  const zoomed = await scale();
  expect(zoomed).toBeGreaterThan(before);
  // It is this tileset's own zoom: the footer offers a reset.
  await expect(page.locator("[data-tileset-zoom-override]")).toBeVisible();

  // Shift + wheel: sideways, zoom unchanged.
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await scroll()).left).toBeGreaterThan(0);
  expect(await scale()).toBe(zoomed);

  // Trackpad two-finger swipe (small deltas, both axes): pans.
  const top0 = (await scroll()).top;
  for (let i = 0; i < 5; i++) await page.mouse.wheel(1, 8);
  await expect.poll(async () => (await scroll()).top).toBeGreaterThan(top0);
  expect(await scale()).toBe(zoomed);

  // Space + drag pans without selecting.
  const selectedNow = () => grid.evaluate((el) => el.querySelector("[data-selected-tiles]")?.getAttribute("data-selected-tiles") ?? null);
  const selectedBefore = await selectedNow();
  await grid.evaluate((el) => el.scrollTo(0, 0));
  const s0 = await scroll();
  await page.mouse.move(box.x + box.width / 2, box.y + 120);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  const s1 = await scroll();
  expect(s1.left).toBeGreaterThan(s0.left);
  expect(s1.top).toBeGreaterThan(s0.top);
  expect(await selectedNow()).toBe(selectedBefore);

  // Reset the own zoom: back to the global zoom (fit).
  await page.locator("[data-tileset-zoom-override]").click();
  await expect.poll(scale).toBe(before);
});

test("selected tile starts a 4×4 marquee, randomizes immediately, and mode hints stay in the dock header", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await dropFile(page, WELCOME_DROP, "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  const image = page.locator("[data-tileset-grid]").first();
  const a = await tilesetCell(image, 0, 0);
  const b = await tilesetCell(image, 3, 3);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const ids = "0,1,2,3,8,9,10,11,16,17,18,19,24,25,26,27";
  await expect(page.locator("[data-selected-tiles]")).toHaveAttribute("data-selected-tiles", ids);
  await page.locator("[data-action='makeRandom']").click();
  await expect(page.locator("[data-action='makeRandom']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-random-tile]")).toHaveCount(16);
  await expect(page.locator("[data-random-brush] [role='spinbutton']")).toHaveCount(16);
  const candidates = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return useEditorStore.getState().randomSet.map((tile: { tileId: number }) => tile.tileId).join(",");
  });
  expect(candidates).toBe(ids);

  // Both modes reuse the existing 32px row, giving the grid its full height.
  const viewport = page.locator("[data-tileset-viewport]");
  const before = (await viewport.boundingBox())!;
  for (const mode of ["solid", "terrain"]) {
    await page.locator(`[data-tileset-mode='${mode}']`).click();
    await expect(page.locator("[data-tileset-side] [data-tileset-hint]")).toBeVisible();
    await expect(page.locator("[data-library-view]")).toHaveCount(0);
    await expect(page.locator("[data-palette-new]")).toHaveCount(0);
    const during = (await viewport.boundingBox())!;
    expect(during.y).toBe(before.y);
    expect(during.height).toBe(before.height);
    await page.locator("[data-tileset-side]").getByRole("button", { name: "Bitti", exact: true }).click();
  }
});
