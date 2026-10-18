import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { dropFile, expect, confirmTilesetCard, WELCOME_DROP } from "./fixtures";
import { dragRoad } from "./smartStamp";
export { dragRoad };

/** Only project/image setup and camera positioning; brush creation always uses UI. */
export async function openRoadSheet(page: Page, size = 32, variant = "", name = `smart-road-${size}`) {
  await page.goto("/");
  await expect(page.locator(WELCOME_DROP)).toBeVisible();
  const bytes = [...readFileSync(new URL(`../fixtures/smart-road-${size}${variant}.png`, import.meta.url))];
  await dropFile(page, WELCOME_DROP, `${name}.png`, bytes);
  await page.getByTestId("tileset-card").getByLabel("Tile genişliği", { exact: true }).fill(String(size));
  await confirmTilesetCard(page);
  await page.evaluate(() => (window as unknown as { __smap: { setCamera(x: number,y: number,z: number): void } }).__smap.setCamera(24,24,1));
}
export async function selectRoad(page: Page, width = 3, height = 3) {
  const grid = page.locator("[data-tileset-grid]").first();
  await expect(grid).toBeVisible();
  const box = (await grid.boundingBox())!;
  const cw = box.width / 12, ch = box.height / 8;
  await page.mouse.move(box.x + 2.5*cw, box.y + 1.5*ch);
  await page.mouse.down();
  await page.mouse.move(box.x + (2+width-.5)*cw, box.y + (1+height-.5)*ch, { steps: 4 });
  await page.mouse.up();
}
export async function saveRoad(page: Page) {
  await page.locator("[data-action='saveClipStamp']").click();
  await page.getByRole("textbox", { name: "Stamp adı", exact: true }).fill("Köy yolu");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
}
export async function roadCells(page: Page): Promise<{ cells: {x:number;y:number;tilesetId:string;tileId:number;flags:number}[]; generated: {id:string;name:string}[] }> {
  return page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const doc = useEditorStore.getState().project.store.document;
    const layer = doc.layers.find((l: { type: string }) => l.type === "tile");
    const cells = [];
    for (let y=0;y<doc.map.height;y++) for (let x=0;x<doc.map.width;x++) {
      const c = layer.getCell(x,y); if (!c) continue;
      const ref = doc.palette.get(c & 0x1fffffff);
      cells.push({ x,y,tilesetId:ref.tilesetId,tileId:ref.tileId,flags:(c & 0xe0000000)>>>0 });
    }
    return { cells, generated: doc.tilesets.filter((t: { generated?: unknown }) => t.generated).map((t: { id: string; name: string }) => ({ id:t.id,name:t.name })) };
  });
}
export async function waitForSaveIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    const { useUiStore } = await import(/* @vite-ignore */ String("/src/ui/uiStore.ts"));
    return useUiStore.getState().busy;
  })).toBe(false);
}
