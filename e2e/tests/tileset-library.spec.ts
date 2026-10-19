import type { Page } from "@playwright/test";

import { confirmTilesetCard, dropFile, expect, sampleBytes, test, WELCOME_DROP } from "../support/fixtures";

type Hook = {
  store: {
    document: { collections: { id: string; name: string; cells: { tileId: number }[] }[]; tilesets: { id: string; name: string; group?: string }[] };
  };
};

const tilesetIds = (page: Page) =>
  page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.tilesets.map((t) => t.id));

/** Drops several files at once onto `selector`. */
async function dropFiles(page: Page, selector: string, files: { name: string; bytes: number[] }[]): Promise<void> {
  await page.evaluate(
    ({ selector, files }) => {
      const target = document.querySelector(selector)!;
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: "image/png" }));
      for (const kind of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { selector, files },
  );
}

async function startProject(page: Page): Promise<void> {
  await page.goto("/");
  await dropFile(page, WELCOME_DROP, "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
}

/** Page position of the centre of tile (col, row) of a tileset grid. */
async function tileCenter(page: Page, tilesetId: string, col: number, row: number) {
  const grid = page.locator(`[data-tileset-grid="${tilesetId}"]`);
  const box = (await grid.boundingBox())!;
  const scale = Number(await grid.getAttribute("data-tileset-scale"));
  return { x: box.x + (col + 0.5) * 32 * scale, y: box.y + (row + 0.5) * 32 * scale };
}

test("bulk import: 4 PNGs → one card → Hepsini ekle → 4 tilesets, no confirmation toast, one undo; Tümü shows them all", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await startProject(page);

  await dropFiles(page, "body", [
    { name: "dungeon-16.png", bytes: sampleBytes("tilesets/dungeon-16.png") },
    { name: "wang16-32.png", bytes: sampleBytes("tilesets/wang16-32.png") },
    { name: "blob47-32.png", bytes: sampleBytes("tilesets/blob47-32.png") },
    { name: "blob47-godot-32.png", bytes: sampleBytes("tilesets/blob47-godot-32.png") },
  ]);
  const card = page.getByTestId("bulk-import-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("tileset-card")).toHaveCount(0);
  await expect(card.locator("[data-bulk-row]")).toHaveCount(4);
  // Inferred sizes per row; the 16 px one is flagged against the 32 px map.
  await expect(card.locator("[data-bulk-row='dungeon-16.png'] [data-bulk-size]")).toHaveValue("16");
  await expect(card.locator("[data-bulk-row='dungeon-16.png']")).toHaveAttribute("data-verdict", "warn");
  await expect(card.locator("[data-bulk-row='wang16-32.png'] [data-bulk-grid]")).toHaveText("4×4");

  // Editing a size inline updates its grid.
  await card.locator("[data-bulk-row='dungeon-16.png'] [data-bulk-size]").fill("32");
  await expect(card.locator("[data-bulk-row='dungeon-16.png'] [data-bulk-grid]")).toHaveText("3×2");

  // A click on a row opens the detailed card for that file; cancelling returns to the list.
  await card.locator("[data-bulk-row='wang16-32.png']").click({ position: { x: 80, y: 20 } });
  const detail = page.getByTestId("tileset-card");
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "Vazgeç" }).click();
  await expect(detail).toBeHidden();
  await expect(card).toBeVisible();

  // Group for all, then add.
  await card.locator("[data-bulk-group]").selectOption({ label: "Yeni grup…" });
  await card.getByLabel("Grup adı").fill("Zindan");
  await card.getByRole("button", { name: "Hepsini ekle (4)" }).click();
  await expect(card).toBeHidden();
  await expect.poll(() => tilesetIds(page)).toHaveLength(5);
  await expect(page.getByRole("status").filter({ hasText: "4 tileset eklendi" })).toHaveCount(0);
  const groups = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.tilesets.map((t) => t.group ?? null));
  expect(groups).toEqual([null, "Zindan", "Zindan", "Zindan", "Zindan"]);

  // One undo removes all four, without a redundant dialog-confirmation toast.
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Control+z");
  await expect.poll(() => tilesetIds(page)).toEqual(["overworld-32"]);
  // Restore the same import to exercise the management view after testing undo.
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => tilesetIds(page)).toHaveLength(5);

  // "Tümü": every tileset in one scroll, with group headers and a section per tileset.
  await page.locator("[data-library-view='all']").click();
  await expect(page.locator("[data-tileset-section]")).toHaveCount(5);
  await expect(page.locator("[data-group-header='Zindan']")).toBeVisible();
  // Search filters; Enter jumps.
  await page.locator("[data-tileset-search]").fill("wang");
  await expect(page.locator("[data-tileset-section]")).toHaveCount(1);
  await page.locator("[data-tileset-search]").press("Escape");
  await expect(page.locator("[data-tileset-section]")).toHaveCount(5);

  // In "Tümü" a plain wheel scrolls the list; Ctrl + wheel zooms (all tilesets).
  // The hint is an info icon with a tooltip (its label says it).
  await expect(page.locator("[data-tileset-wheel-hint]")).toHaveAttribute("aria-label", /Ctrl\+tekerlek/);
  const list = page.locator("[data-tileset-view='all']");
  const scales = () => page.locator("[data-tileset-grid]").evaluateAll((els) => els.map((el) => el.getAttribute("data-tileset-scale")));
  const scales0 = await scales();
  const listBox = (await list.boundingBox())!;
  await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await scales()).toEqual(scales0);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(scales).not.toEqual(scales0);
  await page.locator("[data-tileset-zoom] button[aria-pressed]").click();
  // Fit now respects each section's visible width and height.
  await expect.poll(scales).not.toEqual(scales0);
  const fitted = await page.locator("[data-tileset-grid]").evaluateAll(els => els.map(el => Number(el.getAttribute("data-tileset-scale"))));
  expect(fitted.every(scale => [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].includes(scale))).toBe(true);

  await page.locator("[data-library-view='single']").click();
  expect(errors).toEqual([]);
});

test("tile context menu and removing an unused tileset with Geri al", async ({ page }) => {
  await startProject(page);
  await page.locator("[data-library-view='single']").click();

  const d = await tileCenter(page, "overworld-32", 3, 1);
  await page.mouse.click(d.x, d.y, { button: "right" });
  const menu = page.locator("[data-tile-menu]");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");

  // A second, unused tileset is removed right away with "Geri al".
  await dropFile(page, "body", "dungeon-16.png", sampleBytes("tilesets/dungeon-16.png"));
  await confirmTilesetCard(page);
  await expect.poll(() => tilesetIds(page)).toEqual(["overworld-32", "dungeon-16"]);
  const dungeonId = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.tilesets.find((ts) => ts.name === "dungeon-16")!.id);
  await page.locator("[data-tileset-switcher]").click();
  await page.locator(`[data-tileset-menu='${dungeonId}']`).click();
  await page.locator("[data-tileset-menu-item='remove']").click();
  const removed = page.getByRole("status").filter({ hasText: "Tileset kaldırıldı: dungeon-16" });
  await expect(removed).toBeVisible();
  await expect.poll(() => tilesetIds(page)).toEqual(["overworld-32"]);
  await removed.getByRole("button", { name: "Geri al" }).click();
  await expect.poll(() => tilesetIds(page)).toEqual(["overworld-32", "dungeon-16"]);
});

test("tileset host: compact two-row header, searchable switcher and remembered zone size", async ({ page }) => {
  await startProject(page);
  const dock = page.locator("[data-dock-zone=left]");
  const header = page.locator("[data-tileset-side]");
  const resize = page.locator("[data-zone-splitter=left]");
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => header.evaluate((el) => ({ height: el.getBoundingClientRect().height, fits: el.clientWidth <= 260 }))).toEqual({ height: 65, fits: true });
    // Narrow hosts keep both fixed-height rows inside the panel without scrolling.
    const layouts = await header.evaluate(async (el) => {
      const states = [];
      for (let i = 0; i < 12; i++) {
        await new Promise(requestAnimationFrame);
        states.push(Array.from(el.querySelectorAll("[data-header-label]")).map((span) => getComputedStyle(span).visibility).join(","));
      }
      return [...new Set(states)];
    });
    expect(layouts).toHaveLength(1);
  }
  await page.locator("[data-tileset-switcher]").click();
  const search = page.locator("[data-tileset-switcher-search]");
  await expect(search).toBeFocused();
  await search.fill("over");
  await expect(page.locator("[data-tileset-option]")).toHaveCount(1);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(search).toBeHidden();
  await expect(page.locator("[data-tileset-switcher-name]")).toHaveText("overworld-32");
  const defaultWidth = await dock.evaluate(el => el.getBoundingClientRect().width);
  expect(defaultWidth).toBe(260);
  await resize.focus(); await resize.press("ArrowRight");
  await expect.poll(() => dock.evaluate(el => el.getBoundingClientRect().width)).toBe(defaultWidth + 16);
  await resize.press("Home");
  await resize.dblclick();
  await expect.poll(() => dock.evaluate(el => el.getBoundingClientRect().width)).toBe(28);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("smap.layout.v2")!).zones.left.state)).toBe("collapsed");
  await page.locator("[data-dock-tab-button='tileset']").click();
  await expect(header).toBeVisible(); await expect(resize).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("smap.layout.v2")!).zones.left.state)).toBe("expanded");
  const fit = page.locator("[data-tileset-zoom-fit]");
  const png = page.locator("[data-tileset-grid]").first();
  await png.hover(); await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await png.getAttribute("data-tileset-scale"))).toBeGreaterThan(1);
  await expect(page.locator("[data-tileset-zoom-label]")).toHaveText(/%\d+/);
  await fit.click();
  await expect.poll(async () => Number(await png.getAttribute("data-tileset-scale"))).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.locator("[data-zone-splitter=bottom]").focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => page.locator("[data-canvas-host]").evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(160);

});

test("dock palettes: create, drop through the header, rename and delete through the switcher", async ({ page }) => {
  await startProject(page);
  const dockHeight = await page.locator("[data-dock]").evaluate((el) => el.getBoundingClientRect().height);
  await page.locator("[data-palette-new]").click();
  const prompt = page.locator("[data-dialog='text-prompt']");
  await prompt.getByLabel("Palet adı").fill("Ground");
  await prompt.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(prompt).toBeHidden();
  const palettes = () => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.collections);
  await expect.poll(async () => (await palettes()).map((p) => p.name)).toEqual(["Ground"]);
  const paletteId = (await palettes())[0]!.id;
  await expect(page.locator("[data-palette-grid]")).toHaveAttribute("data-palette-grid", paletteId);
  await expect(page.locator("[data-palette-columns]")).toBeVisible();
  await expect.poll(() => page.locator("[data-dock]").evaluate((el) => el.getBoundingClientRect().height)).toBe(dockHeight);
  await page.locator("[data-tileset-switcher]").click();
  await page.locator("[data-tileset-option='overworld-32']").click();
  const cell = await tileCenter(page, "overworld-32", 1, 1);
  await page.mouse.click(cell.x, cell.y);
  await page.mouse.move(cell.x, cell.y);
  await page.mouse.down();
  await page.mouse.move(cell.x + 12, cell.y, { steps: 3 });
  // In-grid movement stays a marquee; leaving the grid reveals palette targets.
  const sourceBox = (await page.locator("[data-tileset-grid='overworld-32']").boundingBox())!;
  await page.mouse.move(cell.x + 12, sourceBox.y - 4, { steps: 4 });
  const target = page.locator(`[data-tileset-side] [data-palette-drop='${paletteId}']`);
  await expect(target).toBeVisible();
  await expect(target).toHaveAttribute("data-palette-card", paletteId);
  const targetBox = (await target.boundingBox())!;
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await palettes())[0]!.cells.map((c) => c.tileId)).toEqual([9]);
  await expect(target).toHaveCount(0);
  await page.locator("[data-tileset-switcher]").click();
  await page.locator(`[data-palette-menu='${paletteId}']`).click();
  await page.locator("[data-palette-menu-item='rename']").click();
  await prompt.getByLabel("Palet adı").fill("Ground renamed");
  await prompt.getByRole("button", { name: "Adlandır", exact: true }).click();
  await expect.poll(async () => (await palettes())[0]!.name).toBe("Ground renamed");
  await page.keyboard.press("Escape");
  await page.locator("[data-tileset-switcher]").click();
  await page.locator(`[data-palette-option='${paletteId}']`).click();
  await expect(page.locator("[data-tileset-switcher-name]")).toHaveText("Ground renamed");
  await page.locator("[data-tileset-switcher]").click();
  await page.locator(`[data-palette-menu='${paletteId}']`).click();
  await page.locator("[data-palette-menu-item='delete']").click();
  await expect.poll(palettes).toEqual([]);
});

test("dock content default stays fixed across tilesets, views and tabs", async ({ page }) => {
  await startProject(page);
  const geometry = () => page.evaluate(() => {
    const dock = document.querySelector("[data-dock]")!.getBoundingClientRect();
    const canvas = document.querySelector("canvas[aria-label='map canvas']")!.getBoundingClientRect();
    return { dock: dock.height, canvas: canvas.height, top: canvas.y };
  });
  const initial = await geometry();
  await dropFile(page, "body", "dungeon-16.png", sampleBytes("tilesets/dungeon-16.png"));
  await confirmTilesetCard(page);
  await expect.poll(geometry).toEqual(initial);
  for (const id of ["overworld-32", "dungeon-16"]) {
    await page.locator("[data-tileset-switcher]").click();
    await page.locator(`[data-tileset-option='${id}']`).click();
    await expect(page.locator("[data-tileset-viewport]")).toHaveAttribute("data-tileset-shown", id);
    await expect.poll(geometry).toEqual(initial);
  }
  await page.locator("[data-library-view='all']").click();
  await expect.poll(geometry).toEqual(initial);
  await page.locator("[data-dock-tab-button='recent']").click();
  await expect.poll(geometry).toEqual(initial);
  await page.locator("[data-dock-tab-button='tileset']").click();
  await expect.poll(geometry).toEqual(initial);
  await page.locator("[data-library-view='single']").click();
  await expect.poll(geometry).toEqual(initial);
});
