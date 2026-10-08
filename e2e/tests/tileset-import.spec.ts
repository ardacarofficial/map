import { confirmTilesetCard, dropFile, expect, sampleBytes, test } from "../support/fixtures";

type Hook = {
  store: {
    document: {
      layers: { type: string; id: string; getCell(x: number, y: number): number }[];
      palette: { get(i: number): { tilesetId: string; tileId: number } | undefined };
      getTileset(id: string): { tileWidth: number; columns: number; rows: number } | undefined;
    };
    getOrAddPaletteIndex(tilesetId: string, tileId: number): number;
    dispatch(op: unknown): unknown;
  };
};

/** Tile id drawn at (x, y) of the first tile layer (null = empty). */
const tileAt = (page: import("@playwright/test").Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const store = (window as unknown as { __smap: Hook }).__smap.store;
      const layer = store.document.layers.find((l) => l.type === "tile")!;
      const cell = layer.getCell(x!, y!);
      return cell === 0 ? null : store.document.palette.get(cell & 0x1fffffff)!.tileId;
    },
    [x, y],
  );

test("tileset import card: inferred 16 px in a 32 px project, then settings to 32 px and undo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Tileset'i buraya bırak")).toBeVisible();

  // A 32 px project from the welcome drop.
  await dropFile(page, "[role=button][tabindex='0']", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();

  // Drop a 16 px tileset anywhere on the editor: the card infers 16 × 16.
  await dropFile(page, "body", "dungeon-16.png", sampleBytes("tilesets/dungeon-16.png"));
  const card = page.getByTestId("tileset-card");
  await expect(card).toBeVisible();
  await expect(card.getByLabel("Tile genişliği")).toHaveValue("16");
  await expect(card.getByLabel("Tile yüksekliği")).toHaveValue("16");
  await expect(page.getByTestId("tileset-card-summary")).toHaveText(/6 × 4 = 24 tile/);
  await expect(card.getByText(/Haritanın tile'ı 32×32 px, bu tileset 16×16 px/)).toBeVisible();
  await expect(card.getByRole("button", { name: /16×16.*dosya adından/ })).toBeVisible();

  // Enter imports.
  await page.keyboard.press("Enter");
  await expect(card).toBeHidden();
  await expect(page.getByText("Tileset eklendi: dungeon-16 · 24 tile")).toBeVisible();

  // Paint two dungeon tiles: id 2 (x = 32 px) and id 3 (x = 48 px).
  await page.evaluate(() => {
    const store = (window as unknown as { __smap: Hook }).__smap.store;
    const layer = store.document.layers.find((l) => l.type === "tile")!;
    const a = store.getOrAddPaletteIndex("dungeon-16", 2);
    const b = store.getOrAddPaletteIndex("dungeon-16", 3);
    store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x: 1, y: 1, cell: a }, { x: 2, y: 1, cell: b }] });
  });
  expect(await tileAt(page, 1, 1)).toBe(2);

  // Settings from the command palette → 32 px.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Komut yaz…" }).fill("Tileset ayarları");
  await page.getByRole("option", { name: /dungeon-16/ }).click();
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "Tileset ayarları" })).toBeVisible();
  await expect(card.getByLabel("Tile genişliği")).toHaveValue("16");
  await card.getByLabel("Tile genişliği").fill("32");
  await expect(card.getByLabel("Tile yüksekliği")).toHaveValue("32"); // linked
  await expect(page.getByTestId("tileset-card-summary")).toHaveText(/3 × 2 = 6 tile/);
  await card.getByRole("button", { name: "Uygula" }).click();
  await expect(card).toBeHidden();

  const result = page.getByText("Izgara güncellendi: 1 tile yeniden eşlendi, 1 hücre temizlendi");
  await expect(result).toBeVisible();
  expect(await tileAt(page, 1, 1)).toBe(1);
  expect(await tileAt(page, 2, 1)).toBeNull();

  // Undo from the toast restores the grid and both cells.
  await page.getByRole("status").filter({ hasText: "Izgara güncellendi" }).getByRole("button", { name: "Geri al" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.getTileset("dungeon-16")!.tileWidth)).toBe(16);
  expect(await tileAt(page, 1, 1)).toBe(2);
  expect(await tileAt(page, 2, 1)).toBe(3);
  expect(errors).toEqual([]);
});

test("tileset import card: leftover pixels are reported with a margin/spacing suggestion", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Tileset'i buraya bırak")).toBeVisible();
  // A 103 × 69 image: 6 × 4 tiles of 16 px with 1 px spacing and margin.
  const bytes = await page.evaluate(async () => {
    const c = new OffscreenCanvas(103, 69);
    const ctx = c.getContext("2d")!;
    for (let r = 0; r < 4; r++) {
      for (let col = 0; col < 6; col++) {
        ctx.fillStyle = `hsl(${(r * 6 + col) * 15} 60% 50%)`;
        ctx.fillRect(1 + col * 17, 1 + r * 17, 16, 16);
      }
    }
    return [...new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer())];
  });
  await dropFile(page, "[role=button][tabindex='0']", "spaced.png", bytes);
  const card = page.getByTestId("tileset-card");
  await expect(card).toBeVisible();
  // Transparent gutters → margin 1, spacing 1 are found right away.
  await expect(card.getByLabel("Kenar (margin)")).toHaveValue("1");
  await expect(card.getByLabel("Aralık (spacing)")).toHaveValue("1");
  await card.getByLabel("Kenar (margin)").fill("0");
  await card.getByLabel("Aralık (spacing)").fill("0");
  await expect(page.getByTestId("tileset-card-leftover")).toContainText("Sağda 7 px, altta 5 px artıyor — margin/spacing önerisi: 1 / 1");
  await card.getByRole("button", { name: "Öneriyi uygula" }).click();
  await expect(page.getByTestId("tileset-card-leftover")).toBeHidden();
  await expect(page.getByTestId("tileset-card-summary")).toHaveText(/6 × 4 = 24 tile/);
});
