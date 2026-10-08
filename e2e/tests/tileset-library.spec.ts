import type { Page } from "@playwright/test";

import { confirmTilesetCard, dropFile, expect, sampleBytes, test } from "../support/fixtures";

type Hook = {
  store: {
    document: { tilesets: { id: string; name: string; group?: string; solidTiles?: number[] }[] };
  };
};

const tilesetIds = (page: Page) =>
  page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.tilesets.map((t) => t.id));

const solidOf = (page: Page, id: string) =>
  page.evaluate((id) => [...((window as unknown as { __smap: Hook }).__smap.store.document.tilesets.find((t) => t.id === id)?.solidTiles ?? [])], id);

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
  await dropFile(page, "[role=button][tabindex='0']", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
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

test("bulk import: 4 PNGs → one card → Hepsini ekle → 4 tilesets, one toast, one undo; Tümü shows them all", async ({ page }) => {
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
  const toast = page.getByRole("status").filter({ hasText: "4 tileset eklendi" });
  await expect(toast).toHaveCount(1);
  const groups = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.tilesets.map((t) => t.group ?? null));
  expect(groups).toEqual([null, "Zindan", "Zindan", "Zindan", "Zindan"]);

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
  await expect(page.locator("[data-tileset-wheel-hint]")).toContainText("Ctrl+tekerlek");
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
  await expect.poll(scales).toEqual(scales0);

  // One "Geri al" removes all four.
  await toast.getByRole("button", { name: "Geri al" }).click();
  await expect.poll(() => tilesetIds(page)).toEqual(["overworld-32"]);
  await page.locator("[data-library-view='single']").click();
  expect(errors).toEqual([]);
});

test("tileset modes: right-drag in Katı unmarks, tile context menu, remove an unused tileset with Geri al", async ({ page }) => {
  await startProject(page);
  await page.locator("[data-library-view='single']").click();

  // Katı: left-drag marks three tiles, right-drag unmarks two of them.
  await page.locator("[data-tileset-mode='solid']").click();
  await expect(page.locator("[data-tileset-hint]")).toContainText("Sol: işaretle · Sağ: kaldır");
  const a = await tileCenter(page, "overworld-32", 0, 0);
  const c = await tileCenter(page, "overworld-32", 2, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => solidOf(page, "overworld-32")).toEqual([0, 1, 2]);
  const b = await tileCenter(page, "overworld-32", 1, 0);
  // The right button decides the direction (unmark), not the first tile.
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up({ button: "right" });
  await expect.poll(() => solidOf(page, "overworld-32")).toEqual([0]);
  await expect(page.locator("[data-tile-menu]")).toHaveCount(0);

  // Seç: right click on a tile opens its menu; "Katı yap" marks it.
  await page.locator("[data-tileset-mode='pick']").click();
  const d = await tileCenter(page, "overworld-32", 3, 1);
  await page.mouse.click(d.x, d.y, { button: "right" });
  const menu = page.locator("[data-tile-menu]");
  await expect(menu).toBeVisible();
  await menu.locator("[data-tile-menu-item='solid']").click();
  await expect.poll(() => solidOf(page, "overworld-32")).toEqual([0, 11]);

  // A second, unused tileset is removed right away with "Geri al".
  await dropFile(page, "body", "dungeon-16.png", sampleBytes("tilesets/dungeon-16.png"));
  await confirmTilesetCard(page);
  await expect.poll(() => tilesetIds(page)).toEqual(["overworld-32", "dungeon-16"]);
  await page.locator("[data-tileset-menu]").click();
  await page.locator("[data-tileset-menu-item='remove']").click();
  const removed = page.getByRole("status").filter({ hasText: "Tileset kaldırıldı: dungeon-16" });
  await expect(removed).toBeVisible();
  await expect.poll(() => tilesetIds(page)).toEqual(["overworld-32"]);
  await removed.getByRole("button", { name: "Geri al" }).click();
  await expect.poll(() => tilesetIds(page)).toEqual(["overworld-32", "dungeon-16"]);
});
