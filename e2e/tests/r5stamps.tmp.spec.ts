import { confirmTilesetCard, dropFile, expect, sampleBytes, test } from "../support/fixtures";

const OUT = "/tmp/claude-0/-home-user-map/71aa0adb-d0ed-56a0-9a7b-c70c93d2a345/scratchpad/r5stamps/";

test("r5 stamps screens", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:5287/");
  await dropFile(page, "[role=button][tabindex='0']", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
  await page.waitForTimeout(500);
  // Paint a few blocks and save them as stamps with metadata.
  await page.evaluate(async () => {
    const im = (p: string) => import(/* @vite-ignore */ p);
    const { useEditorStore } = await im("/src/state/editorStore.ts");
    const actions = await im("/src/commands/stampActions.ts");
    const store = useEditorStore.getState().project.store;
    const layer = store.document.layers.find((l: { type: string }) => l.type === "tile");
    const defs = [
      { name: "Köy Evi", x: 2, y: 2, w: 3, h: 3, base: 40, cat: "Binalar", tags: ["köy"], fav: true },
      { name: "Gözcü Kulesi", x: 7, y: 2, w: 2, h: 4, base: 12, cat: "Binalar", tags: ["taş"] },
      { name: "Çam Ağaçları", x: 11, y: 2, w: 4, h: 2, base: 24, cat: "Doğa", tags: ["orman", "köy"] },
      { name: "Çiçek Tarlası", x: 2, y: 8, w: 3, h: 2, base: 4, cat: "Doğa", tags: ["köy"], fav: true },
      { name: "Kuyu", x: 7, y: 8, w: 2, h: 2, base: 50 },
      { name: "Sandık Yığını", x: 11, y: 8, w: 2, h: 1, base: 33, cat: "Eşyalar" },
    ];
    for (const d of defs) {
      const cells = [];
      for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) cells.push({ x: d.x + x, y: d.y + y, cell: store.getOrAddPaletteIndex(store.document.tilesets[0].id, d.base + y * 8 + x) });
      store.dispatch({ type: "paintCells", layerId: layer.id, cells });
      useEditorStore.getState().setTool("select");
      useEditorStore.getState().setRegion({ x: d.x, y: d.y, width: d.w, height: d.h });
      const s = actions.saveSelectionAsStamp(d.name);
      actions.setStampMeta(s.id, { ...(d.cat ? { category: d.cat } : {}), ...(d.tags ? { tags: d.tags } : {}), ...(d.fav ? { favorite: true } : {}) });
    }
    useEditorStore.getState().setRegion(null);
    useEditorStore.getState().setTool("brush");
  });
  await page.waitForTimeout(400);
  const lib = page.locator("[data-stamp-library]");
  await expect(lib.locator("[data-stamp-id]")).toHaveCount(6);
  await lib.locator("[data-stamp-id]").nth(2).click();
  await expect(page.locator("[data-stamp-inspector]")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + "01-library-inspector.png" });

  await lib.locator("[data-stamp-category-chip='Binalar']").click();
  await page.locator("[data-stamp-favorites]").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "02-filtered.png" });
  await page.locator("[data-stamp-favorites]").click();
  await lib.locator("[data-stamp-category-chip='*']").click();
  await page.locator("[data-stamp-view-button='list']").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "03-list.png" });
  await page.locator("[data-stamp-view-button='grid']").click();

  await lib.locator("[data-stamp-id]").first().click({ button: "right" });
  await expect(page.locator("[data-context-menu]")).toBeVisible();
  await page.screenshot({ path: OUT + "04-context-menu.png" });
  await page.keyboard.press("Escape");

  // Editor
  await lib.locator("[data-stamp-id]").first().click();
  const name = await lib.locator("[data-stamp-id]").first().getAttribute("data-stamp-id");
  await page.locator("[data-action='editStamp']").click();
  await expect(page.locator("[data-stamp-banner]")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "05-stamp-editor.png" });
  const level = await page.evaluate(() => (window as unknown as { __smap: { editor: { getState(): { project: { levelId: string } } } } }).__smap.editor.getState().project.levelId);
  expect(level).toBe(`stamp:${name}`);
  // Paint one more tile and save.
  const before = await page.evaluate(async (id) => {
    const { useProjectLibrary } = await import(/* @vite-ignore */ "/src/io/projectLibrary.ts");
    const s = useProjectLibrary.getState().stamps.find((x: { id: string }) => x.id === id);
    return [s.width, s.height];
  }, name);
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: { store: { document: { layers: { id: string; type: string }[]; tilesets: { id: string }[]; map: { width: number } }; getOrAddPaletteIndex(a: string, b: number): number; dispatch(o: unknown): void } } }).__smap;
    const st = h.store;
    const layer = st.document.layers.find((l) => l.type === "tile")!;
    st.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x: 1, y: 1, cell: st.getOrAddPaletteIndex(st.document.tilesets[0]!.id, 3) }] });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + "06-stamp-editor-dirty.png" });
  await page.locator("[data-stamp-tab] button").click();
  await expect(page.locator("[data-stamp-close-dialog]")).toBeVisible();
  await page.screenshot({ path: OUT + "07-close-ask.png" });
  await page.locator("[data-stamp-close-dialog] button", { hasText: /Kaydet|Save/ }).last().click();
  await expect(page.locator("[data-stamp-banner]")).toBeHidden();
  const after = await page.evaluate(async (id) => {
    const { useProjectLibrary } = await import(/* @vite-ignore */ "/src/io/projectLibrary.ts");
    const s = useProjectLibrary.getState().stamps.find((x: { id: string }) => x.id === id);
    return [s.width, s.height, s.category, s.favorite];
  }, name);
  console.log("before", before, "after", after);
  const back = await page.evaluate(() => (window as unknown as { __smap: { editor: { getState(): { project: { levelId: string } } } } }).__smap.editor.getState().project.levelId);
  expect(back.startsWith("stamp:")).toBe(false);
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + "08-after-save.png" });
  const body = await page.locator("body").innerText();
  for (const banned of [/linked prefab/i, /linked placements/i, /Used in \d+ maps/i, /Apply to \d+/i, /Detach/i, /Place linked/i]) expect(body).not.toMatch(banned);
  console.log("errors", errors);
});
