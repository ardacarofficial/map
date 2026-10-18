import type { Page } from "@playwright/test";
import { confirmTilesetCard, dropFile, expect, sampleBytes, WELCOME_DROP } from "./fixtures";

export interface ToolsHook {
  editor: { getState(): {
    activeLayerId: string;
    selection: { tilesetId: string; tileId: number } | null;
    tool: string;
    setRegion(region: { x: number; y: number; width: number; height: number } | null): void;
    setSelection(tile: { tilesetId: string; tileId: number }): void;
    setStamp(clip: unknown): void;
    setRandomSet(tiles: { tilesetId: string; tileId: number }[]): void;
    setActiveLayer(id: string): void;
  } };
  store: {
    document: {
      layers: { id: string; type: string; getCell(x: number, y: number): number }[];
      tilesets: { id: string }[];
      palette: { get(index: number): { tilesetId: string; tileId: number } | undefined };
    };
    undoDepth: number;
    getOrAddPaletteIndex(tilesetId: string, tileId: number): number;
    dispatch(op: unknown): string;
    clearHistory(): void;
  };
  cellCenter(x: number, y: number): { x: number; y: number };
}

export async function openToolsProject(page: Page, file = "overworld-32.png") {
  await page.goto("/");
  await dropFile(page, WELCOME_DROP, file, sampleBytes(`tilesets/${file}`));
  await confirmTilesetCard(page);
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Shift+Digit1");
  await page.waitForTimeout(200);
}

export async function cellPoint(page: Page, x: number, y: number) {
  return page.evaluate(([x, y]) => (window as unknown as { __smap: ToolsHook }).__smap.cellCenter(x!, y!), [x, y]);
}

export async function dragRectangle(page: Page, x0: number, y0: number, x1: number, y1: number) {
  const a = await cellPoint(page, x0, y0);
  const b = await cellPoint(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

export async function pickDockTile(page: Page, col: number, row: number) {
  const grid = page.locator("[data-tileset-grid]").first();
  const box = (await grid.boundingBox())!;
  const scale = Number(await grid.getAttribute("data-tileset-scale"));
  await page.mouse.click(box.x + (col + 0.5) * 32 * scale, box.y + (row + 0.5) * 32 * scale);
}

export async function mapCells(page: Page, width: number, height: number) {
  return page.evaluate(({ width, height }) => {
    const h = (window as unknown as { __smap: ToolsHook }).__smap;
    const layer = h.store.document.layers.find(l => l.id === h.editor.getState().activeLayerId)!;
    return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
      const cell = layer.getCell(x, y);
      return { cell, tileId: h.store.document.palette.get(cell & 0x1fffffff)?.tileId ?? null };
    }));
  }, { width, height });
}
