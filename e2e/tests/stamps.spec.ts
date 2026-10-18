import type { Page } from "@playwright/test";

import { expect, startWithTileset, test } from "../support/fixtures";

type Store = {
  document: {
    layers: { id: string; type: string; getCell(x: number, y: number): number }[];
    tilesets: { id: string }[];
  };
  getOrAddPaletteIndex(tilesetId: string, tileId: number): number;
  dispatch(op: unknown): unknown;
};
type Hook = {
  store: Store;
  editor: { getState(): { project: { levelId: string } | null; stamp: { width: number; height: number } | null } };
  cellCenter(x: number, y: number): { x: number; y: number } | null;
};
type LibStamp = { id: string; name: string; width: number; height: number; category?: string; favorite?: boolean; tags?: string[] };

const hook = (page: Page) => page.evaluate(() => Boolean((window as unknown as { __smap?: Hook }).__smap));

/** Library stamps (id, name, size, metadata). */
const libraryStamps = (page: Page) =>
  page.evaluate(async () => {
    const { useProjectLibrary } = await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));
    return (useProjectLibrary.getState().stamps as LibStamp[]).map((s) => ({ id: s.id, name: s.name, width: s.width, height: s.height, category: s.category, favorite: s.favorite }));
  });

/** Raw cells of the first tile layer in a rectangle (row-major). */
const cellsAt = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(
    ([x, y, w, h]) => {
      const store = (window as unknown as { __smap: Hook }).__smap.store;
      const layer = store.document.layers.find((l) => l.type === "tile")!;
      const out: number[] = [];
      for (let j = 0; j < h!; j++) for (let i = 0; i < w!; i++) out.push(layer.getCell(x! + i, y! + j));
      return out;
    },
    [x, y, w, h],
  );

const levelId = (page: Page) => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.editor.getState().project?.levelId ?? null);

const card = (page: Page, name: string) => page.locator("[data-stamp-library] [data-stamp-id]").filter({ hasText: name });

test("stamp library: search, category chips, ★, Kategori submenu, place from card, Rastgele sete ekle", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await startWithTileset(page);
  expect(await hook(page)).toBe(true);

  // Four stamps with library metadata (painted on the map, saved from a marquee).
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const actions = await import(/* @vite-ignore */ String("/src/commands/stampActions.ts"));
    const store = useEditorStore.getState().project.store;
    const layer = store.document.layers.find((l: { type: string }) => l.type === "tile");
    const defs = [
      { name: "Köy Evi", x: 2, y: 2, w: 3, h: 3, base: 40, cat: "Binalar", tags: ["köy"], fav: true },
      { name: "Gözcü Kulesi", x: 7, y: 2, w: 2, h: 4, base: 12, cat: "Binalar", tags: ["taş"] },
      { name: "Çam Ağaçları", x: 11, y: 2, w: 4, h: 2, base: 24, cat: "Doğa", tags: ["orman", "köy"] },
      { name: "Kuyu", x: 7, y: 8, w: 2, h: 2, base: 50 },
    ];
    for (const d of defs) {
      const cells = [];
      for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) cells.push({ x: d.x + x, y: d.y + y, cell: store.getOrAddPaletteIndex(store.document.tilesets[0].id, (d.base + y * 8 + x) % 64) });
      store.dispatch({ type: "paintCells", layerId: layer.id, cells });
      useEditorStore.getState().setTool("select");
      useEditorStore.getState().setRegion({ x: d.x, y: d.y, width: d.w, height: d.h });
      const s = actions.saveSelectionAsStamp(d.name);
      actions.setStampMeta(s.id, { ...(d.cat ? { category: d.cat } : {}), ...(d.tags ? { tags: d.tags } : {}), ...(d.fav ? { favorite: true } : {}) });
    }
    useEditorStore.getState().setRegion(null);
    useEditorStore.getState().setTool("brush");
  });

  const lib = page.locator("[data-stamp-library]");
  const cards = lib.locator("[data-stamp-id]");
  await expect(cards).toHaveCount(4);

  // Category chips carry counts; a chip filters.
  await expect(lib.locator("[data-stamp-category-chip='*']")).toContainText("4");
  await expect(lib.locator("[data-stamp-category-chip='Binalar']")).toContainText("2");
  await lib.locator("[data-stamp-category-chip='Binalar']").click();
  await expect(cards).toHaveCount(2);
  // ★ on top of the category: only the favourite house.
  await page.locator("[data-stamp-favorites]").click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Köy Evi");
  await page.locator("[data-stamp-favorites]").click();
  await lib.locator("[data-stamp-category-chip='*']").click();
  // Tag chip and search.
  await lib.locator("[data-stamp-tag-chip='köy']").click();
  await expect(cards).toHaveCount(2);
  await lib.locator("[data-stamp-tag-chip='köy']").click();
  await page.locator("[data-stamp-search]").fill("kule");
  await expect(cards).toHaveCount(1);
  await page.locator("[data-stamp-search]").fill("");
  await expect(cards).toHaveCount(4);

  // ★ on a card.
  await card(page, "Kuyu").hover();
  await card(page, "Kuyu").locator("[data-stamp-star]").click();
  await expect.poll(async () => (await libraryStamps(page)).find((s) => s.name === "Kuyu")?.favorite).toBe(true);

  // Right-click → Kategori ▸ Doğa (a real submenu).
  await card(page, "Kuyu").click({ button: "right" });
  await expect(page.locator("[data-context-menu]")).toBeVisible();
  await page.locator("[data-context-item='category']").hover();
  await page.locator("[data-context-submenu='category'] [data-context-item='category:Doğa']").click();
  await expect.poll(async () => (await libraryStamps(page)).find((s) => s.name === "Kuyu")?.category).toBe("Doğa");
  await expect(lib.locator("[data-stamp-category-chip='Doğa']")).toContainText("2");

  // Grid ↔ list, card size.
  await page.locator("[data-stamp-view-button='list']").click();
  await expect(lib.locator("[data-stamp-view='list']")).toBeVisible();
  await page.locator("[data-stamp-view-button='grid']").click();
  // Smallest cards first: at the 260 px default library width the default size already fills one column.
  await page.locator("[data-stamp-card-size]").fill("88");
  const width0 = (await cards.first().boundingBox())!.width;
  await page.locator("[data-stamp-card-size]").fill("200");
  await expect.poll(async () => (await cards.first().boundingBox())!.width).toBeGreaterThan(width0);

  // Single click selects the card, shows its inspector and arms the brush.
  await card(page, "Köy Evi").click();
  await expect(page.locator("[data-stamp-inspector]")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.editor.getState().stamp?.width ?? null)).toBe(3);
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await canvas.focus();
  await page.keyboard.press("Shift+Digit1");
  await page.waitForTimeout(300);
  const at = (await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.cellCenter(30, 20)))!; // the stamp's top-left cell follows the cursor
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await cellsAt(page, 30, 20, 3, 3)).join(",")).toBe((await cellsAt(page, 2, 2, 3, 3)).join(","));

  // "Rastgele sete ekle": the random brush gets the stamp, its chunk is the stamp's size.
  await card(page, "Gözcü Kulesi").click({ button: "right" });
  await page.locator("[data-context-item='addToRandom']").click();
  const chunk = await page.evaluate(async () => {
    const { useRandomBrush } = await import(/* @vite-ignore */ String("/src/commands/randomBrush.ts"));
    return useRandomBrush.getState().chunk;
  });
  expect(chunk).toEqual({ w: 2, h: 4 });
  expect(errors).toEqual([]);
});

test("stamp editor: Düzenle opens a tab, edits are saved cropped, existing placements unchanged, never listed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await startWithTileset(page);

  // One 2 × 2 stamp, placed once on the map at (20, 10).
  const id = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const actions = await import(/* @vite-ignore */ String("/src/commands/stampActions.ts"));
    const store = useEditorStore.getState().project.store;
    const layer = store.document.layers.find((l: { type: string }) => l.type === "tile");
    const ts = store.document.tilesets[0].id;
    const cells = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) cells.push({ x: 2 + x, y: 2 + y, cell: store.getOrAddPaletteIndex(ts, 9 + y * 8 + x) });
    store.dispatch({ type: "paintCells", layerId: layer.id, cells });
    store.dispatch({ type: "paintCells", layerId: layer.id, cells: cells.map((c: { x: number; y: number; cell: number }) => ({ ...c, x: c.x + 18, y: c.y + 8 })) });
    useEditorStore.getState().setTool("select");
    useEditorStore.getState().setRegion({ x: 2, y: 2, width: 2, height: 2 });
    const s = actions.saveSelectionAsStamp("Kulübe");
    useEditorStore.getState().setRegion(null);
    useEditorStore.getState().setTool("brush");
    return s.id as string;
  });
  const placed = await cellsAt(page, 20, 10, 3, 3);
  const maps = page.getByRole("listbox", { name: "Haritalar" }).getByRole("option");
  await page.locator("[data-library-tab-button='project']").click();
  await expect(maps).toHaveCount(1);
  await page.locator("[data-library-tab-button='stamps']").click();

  // Double-click opens the same stamp editor as Düzenle.
  await card(page, "Kulübe").dblclick();
  await expect(page.locator("[data-stamp-banner]")).toBeVisible();
  await expect(page.locator("[data-stamp-tab]")).toHaveAttribute("aria-selected", "true");
  expect(await levelId(page)).toBe(`stamp:${id}`);
  // The temporary document is not a map of the project.
  await page.locator("[data-library-tab-button='project']").click();
  await expect(maps).toHaveCount(1);
  await page.locator("[data-library-tab-button='stamps']").click();

  // Grow the stamp: one more tile right of it (the editing map centres the stamp with a margin).
  await page.evaluate(() => {
    const st = (window as unknown as { __smap: Hook }).__smap.store;
    const layer = st.document.layers.find((l) => l.type === "tile")!;
    let ox = -1;
    let oy = -1;
    for (let y = 0; y < 20 && ox < 0; y++) for (let x = 0; x < 20; x++) if (layer.getCell(x, y) !== 0) { ox = x; oy = y; break; }
    st.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x: ox + 2, y: oy, cell: st.getOrAddPaletteIndex(st.document.tilesets[0]!.id, 3) }] });
  });
  // Closing the tab with changes asks; "Vazgeç" keeps it open.
  await page.locator("[data-stamp-tab] button").click();
  const ask = page.locator("[data-stamp-close-dialog]");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Vazgeç" }).click();
  await expect(ask).toBeHidden();
  await expect(page.locator("[data-stamp-banner]")).toBeVisible();

  // Kaydet: the stamp is cropped to its content (3 × 2 now), the map tab comes back.
  await page.locator("[data-stamp-save]").click();
  await expect(page.locator("[data-stamp-banner]")).toBeHidden();
  await expect(page.locator("[data-stamp-tab]")).toHaveCount(0);
  await expect.poll(async () => (await libraryStamps(page)).find((s) => s.id === id)).toMatchObject({ width: 3, height: 2 });
  expect(await levelId(page)).not.toMatch(/^stamp:/);
  // Stamps are flat copies: the copy placed earlier did not change.
  expect(await cellsAt(page, 20, 10, 3, 3)).toEqual(placed);

  // Open again, discard: nothing changes.
  await card(page, "Kulübe").click();
  await page.locator("[data-stamp-inspector] [data-action='editStamp']").click();
  await expect(page.locator("[data-stamp-banner]")).toBeVisible();
  // "Haritaya git" for the map that is already open leaves the stamp tab (it stays open in the background).
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("haritaya git ana harita");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-stamp-banner]")).toBeHidden();
  await expect(page.locator("[data-stamp-tab]")).toHaveAttribute("aria-selected", "false");
  expect(await levelId(page)).not.toMatch(/^stamp:/);
  await page.locator("[data-stamp-tab]").click();
  await expect(page.locator("[data-stamp-banner]")).toBeVisible();
  await page.locator("[data-stamp-discard]").click();
  await expect(page.locator("[data-stamp-banner]")).toBeHidden();
  expect((await libraryStamps(page)).find((s) => s.id === id)).toMatchObject({ width: 3, height: 2 });

  // No linked-prefab wording anywhere (CLAUDE.md: Yapılmayacaklar).
  const body = await page.locator("body").innerText();
  for (const banned of [/linked prefab/i, /linked placements/i, /Used in \d+ maps/i, /Apply to \d+/i, /Detach/i, /Place linked/i]) expect(body).not.toMatch(banned);
  expect(errors).toEqual([]);
});

test("stamp cards arm with click or Enter, yield to a marquee at pointer-down, and clear on a tile pick", async ({ page }) => {
  await page.goto("/");
  await startWithTileset(page);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { saveSelectionAsStamp } = await import(/* @vite-ignore */ String("/src/commands/stampActions.ts"));
    const editor = useEditorStore.getState();
    const store = editor.project.store;
    const layer = store.document.layers.find((l: { type: string }) => l.type === "tile");
    store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x: 2, y: 2, cell: store.getOrAddPaletteIndex(store.document.tilesets[0].id, 9) }] });
    editor.setTool("select");
    editor.setRegion({ x: 2, y: 2, width: 1, height: 1 });
    saveSelectionAsStamp("Marquee test");
    useEditorStore.getState().setRegion(null);
    useEditorStore.getState().setTool("fill");
  });
  const stampCard = card(page, "Marquee test");
  await stampCard.click();
  await expect(page.locator("[data-inspector-section]")).toHaveCount(1);
  await expect.poll(() => page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return useEditorStore.getState().tool;
  })).toBe("fill");
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    useEditorStore.getState().setTool("select");
  });
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await canvas.focus();
  await page.keyboard.press("Shift+Digit1");
  await page.waitForTimeout(300);
  const a = (await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.cellCenter(5, 5)))!;
  const b = (await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.cellCenter(7, 7)))!;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await expect(page.locator("[data-stamp-inspector]")).toHaveCount(0);
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("[data-inspector]")).toHaveAttribute("data-inspector-mode", "region");
  await expect(page.locator("[data-inspector-section]")).toHaveCount(1);
  await stampCard.focus();
  await stampCard.press("Enter");
  await expect(page.locator("[data-stamp-inspector]")).toBeVisible();
  const grid = page.locator("[data-tileset-grid]").first();
  await grid.click({ position: { x: 8, y: 8 } });
  await expect(page.locator("[data-stamp-inspector]")).toHaveCount(0);
  await expect(page.locator("[data-inspector]")).toHaveAttribute("data-inspector-mode", "brush");
});
