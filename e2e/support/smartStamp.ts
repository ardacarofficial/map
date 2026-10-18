import type { Page } from "@playwright/test";
import { expect, startWithTileset } from "./fixtures";

/** Authored 3×3 border fixture: textured grass, edged road, asymmetric markings. */
export async function makeRoadStamp(page: Page): Promise<void> {
  await startWithTileset(page);
  await expect.poll(() => page.evaluate(() => Object.hasOwn(window, "__smap"))).toBe(true);
  await page.evaluate(async () => {
    const { saveSelectionAsStamp } = await import(/* @vite-ignore */ String("/src/commands/stampActions.ts"));
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { setTilesetImage } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const { useStampLibrary } = await import(/* @vite-ignore */ String("/src/ui/stamps/stampLibraryStore.ts"));
    const canvas = document.createElement("canvas"); canvas.width = 96; canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#3d6847"; ctx.fillRect(0, 0, 96, 96);
    for (let y = 0; y < 96; y += 4) for (let x = 0; x < 96; x += 4) { ctx.fillStyle = (x + y) % 12 ? "#46764e" : "#355e42"; ctx.fillRect(x, y, 2, 1); }
    ctx.fillStyle = "#524c42"; ctx.fillRect(6, 6, 84, 84);
    ctx.fillStyle = "#cabd94"; ctx.fillRect(8, 8, 80, 80);
    ctx.fillStyle = "#a89b78"; ctx.fillRect(11, 11, 74, 74);
    for (let y = 12; y < 84; y += 6) for (let x = 12; x < 84; x += 6) { ctx.fillStyle = (x + y) % 18 ? "#b4a884" : "#948867"; ctx.fillRect(x, y, 2, 1); }
    // The NW tile has a marker so X/Y/Z genuinely change the recipe's artwork.
    ctx.fillStyle = "#e0d4af"; ctx.fillRect(15, 17, 4, 2);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const editor = useEditorStore.getState(), store = editor.project.store, layer = store.document.layers.find((l: { type: string }) => l.type === "tile");
    const tileset = { id: "road-source", name: "Yol kaynağı", imagePath: "tilesets/road-source.png", tileWidth: 32, tileHeight: 32, columns: 3, rows: 3, margin: 0, spacing: 0 };
    setTilesetImage({ tilesetId: tileset.id, bytes, bitmap: await createImageBitmap(blob) });
    store.dispatch({ type: "addTileset", tileset });
    const cells = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y, cell: store.getOrAddPaletteIndex(tileset.id, y * 3 + x) });
    store.dispatch({ type: "paintCells", layerId: layer.id, cells });
    editor.setRegion({ x: 0, y: 0, width: 3, height: 3 });
    const stamp = saveSelectionAsStamp("Köy yolu");
    store.dispatch({ type: "paintCells", layerId: layer.id, cells: cells.map(c => ({ ...c, cell: 0 })) });
    editor.setRegion(null); editor.setTool("brush"); editor.setActiveLayer(layer.id);
    useStampLibrary.getState().select(stamp.id);
    const hook = (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap;
    hook.setCamera(24, 24, 1);
  });
  await expect(page.locator("[data-nine-slice]")).toBeVisible();
}
export async function acceptRoadStamp(page: Page): Promise<void> {
  await page.locator("[data-nine-slice]").click();
  const dialog = page.locator("[data-smart-stamp-dialog]");
  await expect(dialog.locator("[data-smart-stamp-preview]")).toHaveCount(5);
  await dialog.getByRole("button", { name: "Hazırla", exact: true }).click();
  await expect(dialog).toBeHidden();
  const place = page.locator("[data-action='placeStamp']");
  if (await place.isEnabled()) await place.click();
  await expect(page.locator("[data-smart-stamp-mode]")).toHaveAttribute("data-smart-stamp-mode", "area");
}
export async function cellPoint(page: Page, x: number, y: number) {
  return page.evaluate(([x, y]) => (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number; y: number } } }).__smap.cellCenter(x!, y!), [x, y]);
}
export async function dragRoad(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const first = await cellPoint(page, ...points[0]!);
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const p of points.slice(1)) { const at = await cellPoint(page, ...p); await page.mouse.move(at.x, at.y, { steps: 4 }); }
  await page.mouse.up();
}
