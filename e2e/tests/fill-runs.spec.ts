import { expect, startWithTileset, test } from "../support/fixtures";

for (const kind of ["tile", "grid"] as const) {
  test(`fill ${kind}: preview region, intervening edit, exact writes and one-step undo/redo`, async ({ page }) => {
    await page.goto("/");
    await startWithTileset(page);
    await page.evaluate(async (kind) => {
      const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
      const state = useEditorStore.getState();
      const store = state.project.store;
      store.dispatch({ type: "resizeMap", width: 64, height: 48 });
      const id = store.dispatch({ type: "addLayer", layer: { name: "Fill test", ...(kind === "grid" ? { type: "grid", role: "collision" } : {}) } });
      state.setActiveLayer(id);
      if (kind === "tile") state.setSelection({ tilesetId: store.document.tilesets[0].id, tileId: 9 });
      state.setTool("fill");
      const wall = Array.from({ length: 48 }, (_, y) => kind === "grid" ? { x: 32, y, value: 1 } : { x: 32, y, cell: store.getOrAddPaletteIndex(store.document.tilesets[0].id, 1) });
      store.dispatch({ type: kind === "grid" ? "paintTerrain" : "paintCells", layerId: id, cells: wall });
      store.clearHistory();
      (window as unknown as { __smap: { setCamera(x: number, y: number, z: number): void } }).__smap.setCamera(40, 40, 0.25);
    }, kind);
    const position = await page.evaluate(() => (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number; y: number } } }).__smap.cellCenter(4, 4));
    await page.mouse.move(position.x, position.y);
    // Wait for the real hover render, then edit the region under its cached mask.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(async (kind) => {
      const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
      const state = useEditorStore.getState();
      const store = state.project.store;
      const wall = Array.from({ length: 48 }, (_, y) => kind === "grid" ? { x: 16, y, value: 1 } : { x: 16, y, cell: store.getOrAddPaletteIndex(store.document.tilesets[0].id, 1) });
      store.dispatch({ type: kind === "grid" ? "paintTerrain" : "paintCells", layerId: state.activeLayerId, cells: wall });
      store.clearHistory();
    }, kind);
    await page.mouse.move(position.x + 8, position.y);
    const preview = await page.evaluate(async () => {
      const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
      const { fillRegionPlan } = await import(/* @vite-ignore */ String("/src/canvas/fillRegionPlan.ts"));
      const state = useEditorStore.getState();
      const store = state.project.store;
      const plan = fillRegionPlan(store, store.document.getLayer(state.activeLayerId), { x: 5, y: 4 });
      return { count: plan.mask.reduce((a: number, b: number) => a + b, 0), image: [plan.image.x, plan.image.y, plan.image.width, plan.image.height] };
    });
    expect(preview).toEqual({ count: 16 * 48, image: [0, 0, 16, 48] });
    await page.mouse.click(position.x + 8, position.y + 16);
    const snapshot = () => page.evaluate(async () => {
      const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
      const state = useEditorStore.getState();
      const store = state.project.store;
      const layer = store.document.getLayer(state.activeLayerId);
      return { depth: store.undoDepth, cells: Array.from({ length: 48 }, (_, y) => Array.from({ length: 64 }, (_, x) => layer.getCell(x, y))) };
    });
    const filled = await snapshot();
    expect(filled.depth).toBe(1);
    const value = filled.cells[0]![0]!;
    expect(value).toBeGreaterThan(0);
    for (const row of filled.cells) {
      expect(row.slice(0, 16)).toEqual(Array(16).fill(value));
      expect(row.slice(17, 32)).toEqual(Array(15).fill(0));
      expect(row.slice(33)).toEqual(Array(31).fill(0));
    }
    await page.keyboard.press("Control+z");
    const undone = await snapshot();
    expect(undone.depth).toBe(0);
    expect(undone.cells.every((row) => row.slice(0, 16).every((cell) => cell === 0))).toBe(true);
    await page.keyboard.press("Control+Shift+z");
    expect(await snapshot()).toEqual(filled);
    await page.mouse.click(position.x + 8, position.y + 16);
    expect((await snapshot()).depth).toBe(1); // no-op fill adds no history
  });
}
