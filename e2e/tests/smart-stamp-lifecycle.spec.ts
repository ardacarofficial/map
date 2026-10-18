import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { acceptRoadStamp, cellPoint, dragRoad, makeRoadStamp } from "../support/smartStamp";

async function changeSource(page: Page, pauseBake = false) {
  return page.evaluate(async pauseBake => {
    const images = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const store = useEditorStore.getState().project.store;
    const bank = store.document.tilesets.find((t: { generated?: unknown }) => t.generated);
    const source = images.getTilesetImage("road-source");
    const canvas = new OffscreenCanvas(source.bitmap.width, source.bitmap.height), ctx = canvas.getContext("2d")!;
    ctx.drawImage(source.bitmap, 0, 0); ctx.fillStyle = "#695336"; ctx.fillRect(32, 32, 32, 32);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    if (pauseBake) {
      const gate = { entered: false, release: () => {} };
      (window as unknown as { lifecycleGate: typeof gate }).lifecycleGate = gate;
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
        if (this.width === bank.columns * bank.tileWidth && this.height === bank.rows * bank.tileHeight) {
          HTMLCanvasElement.prototype.toBlob = encode;
          encode.call(this, blob => { gate.release = () => callback(blob); gate.entered = true; }, ...args);
        } else encode.call(this, callback, ...args);
      };
    }
    const before = { generated: bank.generated, bytes: [...images.getTilesetImage(bank.id).bytes], depth: store.undoDepth, id: bank.id };
    images.setTilesetImage({ tilesetId: "road-source", bytes: new Uint8Array(await blob.arrayBuffer()), bitmap: await createImageBitmap(blob) });
    return before;
  }, pauseBake);
}

async function bankState(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { getTilesetImage } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const store = useEditorStore.getState().project.store;
    const bank = store.document.tilesets.find((t: { generated?: unknown }) => t.generated);
    return { generated: bank.generated, bytes: [...getTilesetImage(bank.id).bytes], depth: store.undoDepth, id: bank.id };
  });
}

async function waitForBake(page: Page) {
  await page.evaluate(async () => {
    const commands = await import(/* @vite-ignore */ String("/src/commands/smartStampCommands.ts"));
    await commands.waitForSmartStampRegeneration();
  });
}

test("generated removal confirms stamp-only usage; undo/redo retains nineSlice and restores smart painting", async ({ page }) => {
  await page.goto("/"); await makeRoadStamp(page); await acceptRoadStamp(page);
  const remove = async () => page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { removeTileset } = await import(/* @vite-ignore */ String("/src/commands/tilesetActions.ts"));
    const bank = useEditorStore.getState().project.store.document.tilesets.find((t: { generated?: unknown }) => t.generated);
    void removeTileset(bank.id);
  });
  await remove();
  const dialog = page.locator("[data-dialog='remove-tileset']");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-remove-usage]")).toHaveText("1 stamp etkileniyor.");
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(page.locator("[data-smart-stamp-mode]")).toBeVisible();
  await remove(); await dialog.getByRole("button", { name: "Hücreleri temizle ve sil", exact: true }).click();
  await expect(dialog).toBeHidden();
  const state = async () => page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { useProjectLibrary } = await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));
    return { banks: useEditorStore.getState().project.store.document.tilesets.filter((t: { generated?: unknown }) => t.generated).length, marked: !!useProjectLibrary.getState().stamps[0].nineSlice };
  });
  expect(await state()).toEqual({ banks: 0, marked: true });
  await page.keyboard.press("Control+z");
  await expect(page.locator("[data-smart-stamp-mode]")).toBeVisible();
  expect(await state()).toEqual({ banks: 1, marked: true });
  await page.keyboard.press("Control+Shift+z"); expect(await state()).toEqual({ banks: 0, marked: true });
  await page.keyboard.press("Control+z");
  await dragRoad(page, [[2, 2], [4, 3]]);
  expect(await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const doc = useEditorStore.getState().project.store.document, layer = doc.layers.find((l: { type: string }) => l.type === "tile");
    const ref = doc.palette.get(layer.getCell(2, 2) & 0x1fffffff);
    return !!doc.getTileset(ref.tilesetId).generated;
  })).toBe(true);
});

test("automatic bake waits for a real pointer gesture and stays outside undo with coherent PNG provenance", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/"); await makeRoadStamp(page); await acceptRoadStamp(page); await waitForBake(page);
  const before = await changeSource(page, true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { lifecycleGate: { entered: boolean } }).lifecycleGate.entered)).toBe(true);
  const at = await cellPoint(page, 4, 4); await page.mouse.move(at.x, at.y); await page.mouse.down();
  await page.evaluate(() => (window as unknown as { lifecycleGate: { release(): void } }).lifecycleGate.release());
  // Let PNG decode finish while the pointer transaction remains open.
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  expect(await bankState(page)).toEqual(before);
  await page.mouse.up(); await waitForBake(page);
  const updated = await bankState(page);
  expect(updated.id).toBe(before.id); expect(updated.depth).toBe(before.depth + 1);
  expect(updated.generated).not.toEqual(before.generated); expect(updated.bytes).not.toEqual(before.bytes);
  await page.mouse.move(10, 10); await page.keyboard.press("Control+z");
  const undone = await bankState(page);
  expect(undone.generated).toEqual(updated.generated); expect(undone.bytes).toEqual(updated.bytes);
  expect(undone.depth).toBe(before.depth);
  await page.keyboard.press("Control+Shift+z"); expect(await bankState(page)).toEqual(updated);
  expect(errors).toEqual([]);
});

test("source PNG refresh preserves the store and undo/redo history of another open level", async ({ page }) => {
  await page.goto("/"); await makeRoadStamp(page); await acceptRoadStamp(page); await waitForBake(page);
  const ids = await page.evaluate(async () => {
    const session = await import(/* @vite-ignore */ String("/src/io/session.ts"));
    const ws = session.getLevelWorkspace(), main = ws.activeId;
    const level = ws.add({ name: "Other", width: 20, height: 20, tileSize: 32, layerName: "Ground" });
    session.publishLevelState({ listChanged: true });
    await session.openLevel(level.id);
    const store = ws.active.store, layer = store.document.layers.find((l: { type: string }) => l.type === "tile");
    store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x: 2, y: 2, cell: store.getOrAddPaletteIndex("road-source", 0) }] });
    store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x: 3, y: 2, cell: store.getOrAddPaletteIndex("road-source", 1) }] });
    store.undo();
    (window as unknown as { lifecycleCachedStore: unknown }).lifecycleCachedStore = store;
    const history = store.historyEntries();
    await session.openLevel(main);
    return { main, other: level.id, history };
  });
  const before = await changeSource(page); await waitForBake(page);
  const updated = await bankState(page); expect(updated.generated).not.toEqual(before.generated);
  const result = await page.evaluate(async ids => {
    const session = await import(/* @vite-ignore */ String("/src/io/session.ts"));
    await session.openLevel(ids.other);
    const store = session.getLevelWorkspace().active.store;
    const sameStore = store === (window as unknown as { lifecycleCachedStore: unknown }).lifecycleCachedStore;
    const history = store.historyEntries();
    const generated = store.document.tilesets.find((t: { generated?: unknown }) => t.generated).generated;
    store.redo();
    const layer = store.document.layers.find((l: { type: string }) => l.type === "tile"), redoCell = layer.getCell(3, 2);
    store.undo(); store.undo();
    return { sameStore, history, generated, redoCell, undoneCell: layer.getCell(2, 2) };
  }, ids);
  expect(result.sameStore).toBe(true); expect(result.history).toEqual(ids.history);
  expect(result.generated).toEqual(updated.generated); expect(result.redoCell).not.toBe(0); expect(result.undoneCell).toBe(0);
});
