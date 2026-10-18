import { expect, test } from "../support/fixtures";
import { setup, state, click, wand, at, canvas } from "../support/connectedPick";

test("right pick activates the topmost visible source, including locks, without undo", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s = useEditorStore.getState(), store = s.project.store;
    const roof = store.document.layers.find((l: { name: string }) => l.name === "Roof");
    store.dispatch({ type: "setLayerProps", layerId: roof.id, props: { locked: true } });
    const hidden = store.dispatch({ type: "addLayer", layer: { name: "Hidden" } });
    store.dispatch({ type: "paintCells", layerId: hidden, cells: [{ x: 3, y: 3, cell: store.getOrAddPaletteIndex(store.document.tilesets[0].id, 3) }] });
    store.dispatch({ type: "setLayerProps", layerId: hidden, props: { visible: false } });
    store.clearHistory(); s.setTool("brush");
  });
  await click(page, 3, 3, "right");
  expect(await state(page)).toMatchObject({ active: "Roof", tile: 2, undo: 0 });
  await expect(page.getByRole("option").filter({ hasText: "Roof" })).toHaveAttribute("aria-selected", "true");
  await page.evaluate(async () => {
    const { getCanvasHandle } = await import(/* @vite-ignore */ String("/src/ui/canvas/canvasHandle.ts"));
    getCanvasHandle().onBlockedAction((action: { reason: string }) => { (window as unknown as { pickBlocked: string }).pickBlocked = action.reason; });
  });
  await click(page, 7, 5);
  expect((await state(page)).undo).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { pickBlocked: string }).pickBlocked)).toBe("locked");
});

test("I scope and Alt temporary pick share source activation; area pick retains active-layer behavior", async ({ page }) => {
  await setup(page); await canvas(page).focus(); await page.keyboard.press("i");
  await expect(page.getByRole("radio", { name: "Tümü", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Etkin", exact: true }).click(); await click(page, 3, 3);
  expect(await state(page)).toMatchObject({ active: "Ground", tile: 1, undo: 0 });
  await page.keyboard.press("i"); await page.getByRole("radio", { name: "Tümü", exact: true }).click();
  await page.keyboard.press("b");
  await page.keyboard.down("Alt"); await click(page, 3, 3); await page.keyboard.up("Alt");
  expect(await state(page)).toMatchObject({ active: "Roof", tile: 2, tool: "brush", undo: 0 });
  const a = await at(page, 3, 3), b = await at(page, 4, 4);
  await page.mouse.move(a.x, a.y); await page.mouse.down({ button: "right" }); await page.mouse.move(b.x, b.y); await page.mouse.up({ button: "right" });
  expect(await state(page)).toMatchObject({ active: "Roof", undo: 0 });
  const clip = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s = useEditorStore.getState(); return { width: s.stamp.width, height: s.stamp.height, layer: s.stamp.layers[0].layerId === s.activeLayerId };
  });
  expect(clip).toEqual({ width: 2, height: 2, layer: true });
});

test("connected selection is flip-sensitive; Shift adds and Ctrl/Alt subtract without editing", async ({ page }) => {
  await setup(page); await wand(page);
  await page.keyboard.down("Shift"); await click(page, 6, 3); await page.keyboard.up("Shift");
  expect((await state(page)).region?.mask).toEqual([1, 1, 0, 1, 1, 0, 0, 0]);
  await page.keyboard.down("Control"); await click(page, 6, 3); await page.keyboard.up("Control");
  expect((await state(page)).region?.mask).toEqual([1, 1, 1, 0]);
  await page.keyboard.down("Alt"); await click(page, 3, 3); await page.keyboard.up("Alt");
  expect(await state(page)).toMatchObject({ region: null, tool: "select", undo: 0 });
  await click(page, 5, 3);
  expect((await state(page)).region).toMatchObject({ width: 1, height: 1, mask: [1] });
});

for (const key of ["Delete", "Control+x"] as const) test(`mask ${key} applies to scoped layers and one undo restores holes and cells`, async ({ page }) => {
  await setup(page); const before = await state(page); await wand(page, true); await page.keyboard.press(key);
  const after = await state(page);
  expect(after.undo).toBe(1);
  expect(after.layers).toEqual(before.layers.map(l => ({ ...l, cells: [0, 0, 0, l.cells[3]] })));
  await page.keyboard.press("Control+z"); expect((await state(page)).layers).toEqual(before.layers);
  await page.keyboard.press("Control+Shift+z"); expect((await state(page)).layers).toEqual(after.layers);
});

test("mask drag and arrow nudge move all scoped layers, preserve holes and cancel cleanly", async ({ page }) => {
  await setup(page); const before = await state(page); await wand(page, true);
  const a = await at(page, 3, 3), b = await at(page, 8, 5);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect((await state(page)).layers).toEqual(before.layers);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  expect(await state(page)).toMatchObject({ undo: 1, region: { x: 8, y: 5, mask: [1, 1, 1, 0] } });
  expect((await state(page)).layers).toEqual(before.layers.map(l => ({ ...l, cells: [0, 0, 0, l.cells[3]] })));
  await page.keyboard.press("ArrowRight"); expect((await state(page)).region?.x).toBe(9);
  await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z"); expect((await state(page)).layers).toEqual(before.layers);
});

for (const key of ["z", "Shift+z", "x", "y"] as const) test(`mask transform ${key} transforms membership and all scoped layers in one undo`, async ({ page }) => {
  await setup(page); const before = await state(page); await wand(page, true); await page.keyboard.press(key);
  expect((await state(page)).region?.mask).toEqual(key === "z" || key === "x" ? [1, 1, 0, 1] : [1, 0, 1, 1]);
  expect((await state(page)).undo).toBe(1);
  await page.keyboard.press("Control+z"); expect((await state(page)).layers).toEqual(before.layers);
});

test("mask copy, paste and saved stamp leave every hole empty in the clip", async ({ page }) => {
  await setup(page); await wand(page, true);
  await page.screenshot({ path: "test-results/connected-mask-outline.png" });
  await page.keyboard.press("Control+c");
  const clip: number[][] = await page.evaluate(async () => {
    const { getMemoryClip } = await import(/* @vite-ignore */ String("/src/commands/clipboard.ts"));
    const c = getMemoryClip(); return c.layers.map((l: { cells: Uint32Array }) => Array.from(l.cells));
  });
  expect(clip).toHaveLength(3); expect(clip.every(l => l[3] === 0 && l.slice(0, 3).every(c => c !== 0))).toBe(true);
  await page.locator('[data-action="stamp.saveSelection"]').click();
  const dialog = page.getByRole("dialog"); await dialog.getByRole("textbox").fill("Mask stamp");
  await dialog.getByRole("button", { name: /Kaydet/, exact: false }).click();
  const saved: number[][] = await page.evaluate(async () => {
    const { useProjectLibrary } = await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));
    return useProjectLibrary.getState().stamps.find((s: { name: string }) => s.name === "Mask stamp").layers.map((l: { cells: Uint32Array }) => Array.from(l.cells));
  });
  expect(saved).toEqual(clip);
  // Destination holes already contain data: pasting must leave it untouched.
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const store = useEditorStore.getState().project.store;
    for (const l of store.document.layers) store.dispatch({ type: l.type === "grid" ? "paintGrid" : "paintCells", layerId: l.id, cells: [{ x: 10, y: 7, ...(l.type === "grid" ? { value: 2 } : { cell: 2 }) }] });
    store.clearHistory();
  });
  await canvas(page).focus(); await page.keyboard.press("Control+v"); await click(page, 9, 6);
  const pasted: number[][] = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return useEditorStore.getState().project.store.document.layers.map((l: { getCell(x: number, y: number): number }) => [l.getCell(9, 6), l.getCell(10, 6), l.getCell(9, 7), l.getCell(10, 7)]);
  });
  expect(pasted.every(l => l[3] === 2 && l.slice(0, 3).every(c => c !== 0))).toBe(true);
  expect((await state(page)).undo).toBe(1);
  await page.keyboard.press("Control+z");
  expect(await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return useEditorStore.getState().project.store.document.layers.every((l: { getCell(x: number, y: number): number }) => l.getCell(9, 6) === 0 && l.getCell(10, 7) === 2);
  })).toBe(true);
});

test("Tile değiştir counts and changes only masked cells in the selected layer scope", async ({ page }) => {
  await setup(page); await wand(page, true);
  const result = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { openTileReplacement, useTileReplacement, replacementPlan } = await import(/* @vite-ignore */ String("/src/commands/replaceTiles.ts"));
    const s = useEditorStore.getState(), tilesetId = s.project.store.document.tilesets[0].id;
    openTileReplacement({ tilesetId, tileId: 2 }, { tilesetId, tileId: 3 });
    const d = useTileReplacement.getState().draft;
    return replacementPlan(d).reduce((n: number, p: { cells: unknown[] }) => n + p.cells.length, 0);
  });
  expect(result).toBe(3);
  const dialog = page.getByTestId("replace-tiles-dialog");
  await expect(dialog.locator("[data-replace-count]")).toHaveText("3 hücre değişecek");
  await dialog.getByRole("button", { name: "Değiştir", exact: true }).click();
  const changed = await state(page); expect(changed.layers[1]!.cells[3]).toBe(changed.layers[0]!.cells[3]); expect(changed.undo).toBe(1);
});




test("selection and pick options are reachable through the command palette", async ({ page }) => {
  await setup(page); await canvas(page).focus(); await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByRole("combobox").fill("Seçim biçimini değiştir"); await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "Bağlı alan", exact: true })).toHaveAttribute("aria-checked", "true");
  await canvas(page).focus(); await page.keyboard.press("i"); await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByRole("combobox").fill("Damlalığın katman kapsamını değiştir"); await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "Etkin", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("selection fill uses the mask and leaves disconnected tiles unchanged", async ({ page }) => {
  await setup(page); await wand(page);
  await page.locator('[data-action="fill"]').click();
  const filled = await state(page); expect(filled.undo).toBe(1);
  expect(filled.layers[0]!.cells).toEqual(Array(4).fill(filled.layers[0]!.cells[3]));
  await canvas(page).focus(); await page.keyboard.press("Control+z");
  expect((await state(page)).layers[0]!.cells.slice(0, 3)).toEqual([1, 1, 1]);
});

test("mask scope skips layers hidden or locked after selection", async ({ page }) => {
  await setup(page); const before = await state(page); await wand(page, true);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const store = useEditorStore.getState().project.store;
    for (const l of store.document.layers) {
      if (l.name === "Roof") store.dispatch({ type: "setLayerProps", layerId: l.id, props: { locked: true } });
      if (l.name === "Collision") store.dispatch({ type: "setLayerProps", layerId: l.id, props: { visible: false } });
    }
    store.clearHistory();
  });
  await page.keyboard.press("Delete");
  expect((await state(page)).layers).toEqual(before.layers.map(l => l.name === "Ground" ? { ...l, cells: [0, 0, 0, l.cells[3]] } : l));
});

test("All picks tiles across a grid layer; Active keeps the manual grid value eyedropper", async ({ page }) => {
  await setup(page);
  await page.getByRole("option").filter({ hasText: "Collision" }).click();
  await canvas(page).focus(); await page.keyboard.press("i");
  await click(page, 3, 3);
  expect(await state(page)).toMatchObject({ active: "Roof", tile: 2, undo: 0 });
  await page.getByRole("option").filter({ hasText: "Collision" }).click();
  await canvas(page).focus(); await page.keyboard.press("i");
  await page.getByRole("radio", { name: "Etkin", exact: true }).click();
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    useEditorStore.getState().setGridValue(2);
  });
  await click(page, 3, 3);
  expect(await state(page)).toMatchObject({ active: "Collision", undo: 0 });
  expect(await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return useEditorStore.getState().gridValue;
  })).toBe(1);
});

test("connected clicks replace a prior rectangle or union while dragging keeps the whole mask", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    useEditorStore.getState().setRegion({ x: 0, y: 0, width: 64, height: 48 });
  });
  await page.getByRole("radio", { name: "Bağlı alan", exact: true }).click();
  await click(page, 3, 3);
  expect((await state(page)).region?.mask).toEqual([1, 1, 1, 0]);
  await page.keyboard.down("Shift"); await click(page, 6, 3); await page.keyboard.up("Shift");
  expect((await state(page)).region?.mask).toEqual([1, 1, 0, 1, 1, 0, 0, 0]);
  await click(page, 3, 3);
  expect((await state(page)).region?.mask).toEqual([1, 1, 1, 0]);
  expect((await state(page)).undo).toBe(0);
  await page.keyboard.down("Shift"); await click(page, 6, 3); await page.keyboard.up("Shift");
  const a = await at(page, 3, 3), b = await at(page, 4, 5);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  expect(await state(page)).toMatchObject({ undo: 1, region: { x: 4, y: 5, mask: [1, 1, 0, 1, 1, 0, 0, 0] } });
});
