import type { Page } from "@playwright/test";
import { expect, startWithTileset } from "./fixtures";

export const canvas = (page: Page) => page.locator("canvas[aria-label='map canvas']").first();
export async function at(page: Page, x: number, y: number) {
  return page.evaluate(({ x, y }) => (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number; y: number } } }).__smap.cellCenter(x, y), { x, y });
}
export async function click(page: Page, x: number, y: number, button: "left" | "right" = "left") {
  const p = await at(page, x, y); await page.mouse.click(p.x, p.y, { button });
}
export async function setup(page: Page) {
  await page.goto("/"); await startWithTileset(page);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s = useEditorStore.getState(), store = s.project.store;
    const ground = store.document.layers.find((l: { type: string }) => l.type === "tile").id;
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { name: "Ground" } });
    const roof = store.dispatch({ type: "addLayer", layer: { name: "Roof" } });
    const collision = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
    const tilesetId = store.document.tilesets[0].id, a = store.getOrAddPaletteIndex(tilesetId, 1), b = store.getOrAddPaletteIndex(tilesetId, 2);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 3, y: 3, cell: a }, { x: 4, y: 3, cell: a }, { x: 3, y: 4, cell: a }, { x: 4, y: 4, cell: b }, { x: 6, y: 3, cell: a }, { x: 5, y: 3, cell: (a | 0x80000000) >>> 0 }] });
    const cells = [3, 4].flatMap(y => [3, 4].map(x => ({ x, y, cell: b })));
    store.dispatch({ type: "paintCells", layerId: roof, cells });
    store.dispatch({ type: "paintGrid", layerId: collision, cells: cells.map(c => ({ x: c.x, y: c.y, value: 1 })) });
    s.setActiveLayer(ground); s.setStamp(null); s.setSelection({ tilesetId, tileId: 2 }); s.setTool("select"); s.setRegion(null); store.clearHistory();
  });
}
export async function state(page: Page): Promise<{
  active: string; tool: string; tile: number | undefined; undo: number;
  region: { x: number; y: number; width: number; height: number; mask: number[] } | null;
  layers: { name: string; cells: number[] }[];
}> {
  return page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s = useEditorStore.getState(), store = s.project.store;
    return { active: store.document.getLayer(s.activeLayerId)?.name, tool: s.tool, tile: s.selection?.tileId, undo: store.undoDepth,
      region: s.region ? { x: s.region.x, y: s.region.y, width: s.region.width, height: s.region.height, mask: Array.from(s.region.mask ?? []) } : null,
      layers: store.document.layers.map((l: { name: string; getCell(x: number, y: number): number }) => ({ name: l.name, cells: [l.getCell(3, 3), l.getCell(4, 3), l.getCell(3, 4), l.getCell(4, 4)] })),
    };
  });
}
export async function wand(page: Page, visible = false) {
  await page.getByRole("radio", { name: "Bağlı alan", exact: true }).click();
  if (visible) await page.getByRole("radio", { name: "Görünür katmanlar", exact: true }).click();
  await click(page, 3, 3);
  await expect.poll(async () => (await state(page)).region?.mask).toEqual([1, 1, 1, 0]);
  await canvas(page).focus();
}
