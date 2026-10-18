import type { Page } from "@playwright/test";
import { expect, startWithTileset, test } from "../support/fixtures";

async function setup(page: Page) {
  await page.goto("/");
  await startWithTileset(page);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s = useEditorStore.getState();
    const store = s.project.store;
    const ground = store.document.layers.find((l: { type: string }) => l.type === "tile").id;
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { name: "Ground" } });
    const roof = store.dispatch({ type: "addLayer", layer: { name: "Roof" } });
    const collision = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
    for (const [i, layerId] of [ground, roof].entries()) {
      const cell = store.getOrAddPaletteIndex(store.document.tilesets[0].id, i + 1);
      store.dispatch({ type: "paintCells", layerId, cells: [{ x: 3, y: 3, cell }, { x: 4, y: 3, cell }] });
    }
    store.dispatch({ type: "paintTerrain", layerId: collision, cells: [{ x: 3, y: 3, value: 1 }, { x: 4, y: 3, value: 2 }] });
    store.clearHistory();
    s.setActiveLayer(ground);
    s.setTool("select");
    s.setRegion({ x: 3, y: 3, width: 2, height: 1 });
  });
  await expect(page.locator("[data-tool-option='selection-scope']")).toBeVisible();
}

async function cells(page: Page, x = 3, y = 3, width = 2, height = 1): Promise<{ name: string; cells: number[] }[]> {
  return page.evaluate(async ({ x, y, width, height }) => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return useEditorStore.getState().project.store.document.layers.map((l: { name: string; getCell(x: number, y: number): number }) => ({
      name: l.name, cells: Array.from({ length: width * height }, (_, i) => l.getCell(x + i % width, y + Math.floor(i / width))),
    }));
  }, { x, y, width, height });
}

async function center(page: Page, x: number, y: number) {
  return page.evaluate(async ({ x, y }) => {
    const h = (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number; y: number } } }).__smap;
    return h.cellCenter(x, y);
  }, { x, y });
}
const canvas = (page: Page) => page.locator("canvas[aria-label='map canvas']").first();
async function visibleScope(page: Page) {
  await page.getByRole("radio", { name: "Görünür katmanlar", exact: true }).click();
  await canvas(page).focus();
}

test("selection scope moves a two-layer house and collision; one undo restores all", async ({ page }) => {
  await setup(page);
  const before = await cells(page);
  await expect(page.getByRole("radio", { name: "Etkin katman", exact: true })).toHaveAttribute("aria-checked", "true");
  await visibleScope(page);
  const a = await center(page, 3, 3), b = await center(page, 6, 5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  // The live preview moves all layers, before release.
  await expect.poll(() => cells(page, 6, 5)).toEqual(before);
  await page.mouse.up();
  await expect.poll(() => cells(page)).toEqual(before.map(l => ({ ...l, cells: [0, 0] })));
  await page.keyboard.press("Control+z");
  await expect.poll(() => cells(page)).toEqual(before);
  await expect.poll(() => cells(page, 6, 5)).toEqual(before.map(l => ({ ...l, cells: [0, 0] })));
});

test("multi-layer cut and paste restores collision and undoes each action once", async ({ page }) => {
  await setup(page);
  const before = await cells(page);
  await visibleScope(page);
  await page.keyboard.press("Control+x");
  await expect.poll(() => cells(page)).toEqual(before.map(l => ({ ...l, cells: [0, 0] })));
  await page.keyboard.press("Control+v");
  const at = await center(page, 7, 6);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => cells(page, 7, 6)).toEqual(before);
  await page.keyboard.press("Control+z");
  await expect.poll(() => cells(page, 7, 6)).toEqual(before.map(l => ({ ...l, cells: [0, 0] })));
  await page.keyboard.press("Control+z");
  await expect.poll(() => cells(page)).toEqual(before);
});

test("Z rotates selection layers and collision instead of the invisible brush", async ({ page }) => {
  await setup(page);
  const before = await cells(page);
  await visibleScope(page);
  await page.keyboard.press("z");
  await expect.poll(() => cells(page, 3, 3, 1, 2)).toEqual(before.map(l => l.name === "Collision" ? l : { ...l, cells: l.cells.map(c => (c | 0xa0000000) >>> 0) }));
  await page.keyboard.press("Control+z");
  await expect.poll(() => cells(page)).toEqual(before);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    useEditorStore.getState().setRegion({ x: 3, y: 3, width: 2, height: 1 });
  });
  await page.keyboard.press("Shift+z");
  await expect.poll(() => cells(page, 3, 3, 1, 2)).toEqual(before.map(l => ({ ...l, cells: [...l.cells].reverse().map(c => l.name === "Collision" ? c : (c | 0x60000000) >>> 0) })));
});

test("default edits only active layer; visible delete skips hidden and locked layers", async ({ page }) => {
  await setup(page);
  const before = await cells(page);
  await canvas(page).focus();
  await page.keyboard.press("Delete");
  await expect.poll(() => cells(page)).toEqual(before.map(l => l.name === "Ground" ? { ...l, cells: [0, 0] } : l));
  await page.keyboard.press("Control+z");
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const store = useEditorStore.getState().project.store;
    for (const l of store.document.layers) {
      if (l.name === "Roof") store.dispatch({ type: "setLayerProps", layerId: l.id, props: { locked: true } });
      if (l.name === "Collision") store.dispatch({ type: "setLayerProps", layerId: l.id, props: { visible: false } });
    }
  });
  await visibleScope(page);
  await page.keyboard.press("Delete");
  await expect.poll(() => cells(page)).toEqual(before.map(l => l.name === "Ground" ? { ...l, cells: [0, 0] } : l));
  await expect(page.getByText("Atlanan katmanlar: Roof", { exact: true })).toBeVisible();
});

test("changing scope during a drag keeps the captured layers; Escape restores preview", async ({ page }) => {
  await setup(page);
  const before = await cells(page);
  await visibleScope(page);
  const a = await center(page, 3, 3), b = await center(page, 5, 4), c = await center(page, 7, 5);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    useEditorStore.getState().setSelectionScope("active");
  });
  await page.mouse.move(c.x, c.y);
  await expect.poll(() => cells(page, 7, 5)).toEqual(before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => cells(page)).toEqual(before);
  await expect.poll(() => cells(page, 7, 5)).toEqual(before.map(l => ({ ...l, cells: [0, 0] })));
});


test("scope has one visible control, keyboard navigation, and a palette toggle", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  const group = page.getByRole("radiogroup", { name: "Katmanlar", exact: true });
  await expect(group).toHaveCount(1);
  await page.getByRole("radio", { name: "Etkin katman", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Görünür katmanlar", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("[data-selection-scope-fact]")).toContainText("Görünür katmanlar");
  await canvas(page).focus();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByRole("combobox").fill("Seçimin katman kapsamını değiştir");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "Etkin katman", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("hidden active layer disables copy, cut and delete without changing cells or clipboard", async ({ page }) => {
  await setup(page);
  const before = await cells(page);
  await canvas(page).focus();
  await page.keyboard.press("Control+c");
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s = useEditorStore.getState();
    s.project.store.dispatch({ type: "setLayerProps", layerId: s.activeLayerId, props: { visible: false } });
    s.project.store.clearHistory();
  });
  for (const key of ["Control+c", "Control+x", "Delete"]) await page.keyboard.press(key);
  expect(await cells(page)).toEqual(before);
  const result = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { captureSelectionScope } = await import(/* @vite-ignore */ String("/src/commands/selectionScope.ts"));
    const { getMemoryClip } = await import(/* @vite-ignore */ String("/src/commands/clipboard.ts"));
    const { getCommand, isEnabled } = await import(/* @vite-ignore */ String("/src/commands/registry.ts"));
    const s = useEditorStore.getState();
    return {
      undo: s.project.store.undoDepth,
      captured: captureSelectionScope(s.project.store.document),
      enabled: ["edit.copy", "edit.cut", "edit.delete"].map(id => isEnabled(getCommand(id))),
      clipLayers: getMemoryClip().layers.map((l: { layerId: string }) => l.layerId),
      active: s.activeLayerId,
    };
  });
  expect(result).toEqual({ undo: 0, captured: [], enabled: [false, false, false], clipLayers: [result.active], active: result.active });
});

test("brush right-click picks without a menu; S then opens copy in the selection menu", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s = useEditorStore.getState();
    s.setRegion(null);
    s.setTool("brush");
  });
  const at = await center(page, 3, 3);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("s");
  const a = await center(page, 2, 2), b = await center(page, 5, 4);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  await page.mouse.click(at.x, at.y, { button: "right" });
  const copy = page.getByRole("menuitem", { name: /^Kopyala/ });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.getByText(/4 × 3 hücre kopyalandı/)).toBeVisible();
});
