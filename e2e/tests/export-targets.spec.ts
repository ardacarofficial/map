import type { Page } from "@playwright/test";
import { expect, readOpfsText, startWithTileset, test } from "../support/fixtures";
import { openRoadSheet, selectRoad, dragRoad } from "../support/smartStampDock";

async function paint(page: Page, opacity = 1) {
  await page.evaluate(async opacity => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const store = useEditorStore.getState().project.store;
    const layer = store.document.layers.find((layer: { type: string }) => layer.type === "tile");
    store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x: 0, y: 0, cell: store.getOrAddPaletteIndex(store.document.tilesets[0].id, 0) }] });
    store.dispatch({ type: "setLayerProps", layerId: layer.id, props: { opacity } });
  }, opacity);
}
async function openExport(page: Page, target?: string) {
  await page.locator("[data-export-open][data-export-unity]").click();
  const dialog = page.getByRole("dialog", { name: "Dışa aktar", exact: true });
  await expect(dialog).toBeVisible();
  if (target) await dialog.getByRole("radio", { name: target, exact: true }).click();
  return dialog;
}
async function files(page: Page) {
  return page.evaluate(async () => {
    const result: { path: string; text?: string; width?: number; height?: number }[] = [];
    async function visit(dir: FileSystemDirectoryHandle, prefix = "") {
      for await (const [name, entry] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
        if (entry.kind === "directory") await visit(entry as FileSystemDirectoryHandle, `${prefix}${name}/`);
        else {
          const file = await (entry as FileSystemFileHandle).getFile();
          if (name.endsWith(".png")) {
            const bitmap = await createImageBitmap(file);
            result.push({ path: prefix + name, width: bitmap.width, height: bitmap.height });
            bitmap.close();
          } else result.push({ path: prefix + name, text: await file.text() });
        }
      }
    }
    await visit(await navigator.storage.getDirectory());
    return result;
  });
}

test("Dışa aktar selects Godot, writes native resources and remembers successful options", async ({ page }) => {
  await page.goto("/"); await startWithTileset(page); await paint(page);
  const dialog = await openExport(page, "Godot 4");
  await dialog.getByRole("textbox").fill("game/maps");
  await expect(dialog.getByTestId("export-submit")).toBeEnabled();
  await dialog.getByTestId("export-submit").click();
  await expect(dialog).toBeHidden();
  const output = await files(page);
  // Export names follow the map display name; its internal path remains levels/main.json.
  expect(output.find(f => f.path === "game/maps/Ana harita.tscn")?.text).toContain('type="TileMapLayer"');
  expect(output.find(f => f.path === "game/maps/tileset.tres")?.text).toContain('type="TileSet"');
  expect(output.filter(f => f.path.endsWith(".png")).every(f => f.width! > 0 && f.height! > 0)).toBe(true);
  expect(output.filter(f => f.path.endsWith(".png"))).toHaveLength(1);
  expect(JSON.parse(output.find(f => f.path === "game/maps/Ana harita.json")!.text!).smapExport).toBe(1);
  await openExport(page);
  await expect(dialog.getByRole("radio", { name: "Godot 4", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("textbox")).toHaveValue("game/maps");
  await dialog.getByRole("textbox").fill("discarded");
  await page.keyboard.press("Escape");
  await openExport(page);
  await expect(dialog.getByRole("textbox")).toHaveValue("game/maps");
  await page.keyboard.press("Escape");
  await page.reload();
  const memory = await page.evaluate(async () => {
    // Read persisted rows independent of the in-memory cache and world startup.
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("smap-export", 1); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<{ target: string; targetOptions: object }[]>(resolve => { const r = db.transaction("settings").objectStore("settings").getAll(); r.onsuccess = () => resolve(r.result); });
    db.close();
    return rows.find(row => row.target === "godot");
  });
  expect(memory!.target).toBe("godot");
  expect(memory!.targetOptions).toMatchObject({ godot: { resourceRoot: "game/maps" } });
});

test("Defold command opens its target and exports a native collection", async ({ page }) => {
  await page.goto("/"); await startWithTileset(page); await paint(page);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("Dışa aktar: Defold");
  await page.getByRole("option", { name: /Dışa aktar: Defold/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "Defold", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByTestId("export-submit")).toBeEnabled();
  await dialog.getByTestId("export-submit").click();
  await expect(dialog).toBeHidden();
  const output = await files(page);
  expect(output.find(f => f.path.endsWith("map.collection"))?.text).toContain("map.go");
  expect(output.find(f => f.path.endsWith(".tilemap"))?.text).toContain("tile_set:");
  expect(output.some(f => f.path.endsWith(".png") && f.width! > 0)).toBe(true);
  await openExport(page);
  await expect(dialog.getByRole("radio", { name: "Defold", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("Defold preflight blocks unsupported opacity without writing or changing remembered target", async ({ page }) => {
  await page.goto("/"); await startWithTileset(page); await paint(page, 0.5);
  const dialog = await openExport(page, "Defold");
  await expect(dialog.getByTestId("export-preflight")).toContainText("%100");
  await expect(dialog.getByTestId("export-submit")).toBeDisabled();
  expect(await files(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await openExport(page);
  await expect(dialog.getByRole("radio", { name: "Unity", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("cancelling a folder picker keeps the last successful target and options", async ({ page }) => {
  await page.goto("/"); await startWithTileset(page); await paint(page);
  const dialog = await openExport(page, "Godot 4");
  await dialog.getByRole("textbox").fill("cancelled");
  await expect(dialog.getByTestId("export-submit")).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => { throw new DOMException("cancelled", "AbortError"); }; });
  await dialog.getByTestId("export-submit").click();
  await expect(dialog.getByTestId("export-submit")).toBeEnabled();
  await expect(dialog).toBeVisible();
  expect(await files(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await openExport(page, "Godot 4");
  await expect(dialog.getByRole("textbox")).toHaveValue("smap");
  await page.keyboard.press("Escape");
  await openExport(page);
  await expect(dialog.getByRole("radio", { name: "Unity", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("engine and legacy folder targets include painted road and edited PNGs and preserve unrelated files", async ({ page }) => {
  test.setTimeout(180_000);
  await openRoadSheet(page); await selectRoad(page);
  await expect(page.getByRole("radio", { name: "Yol", exact: true })).toBeVisible();
  await dragRoad(page, [[4, 4], [7, 4]]);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { setTilesetImage } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const store = useEditorStore.getState().project.store;
    const layer = store.document.layers.find((l: { type: string }) => l.type === "tile");
    const pixels = new Uint8Array(32 * 32 * 4).fill(255);
    const slot = store.dispatch({ type: "allocateEditedTile", tileWidth: 32, tileHeight: 32, pixels });
    store.dispatch({ type: "remapCells", layerId: layer.id, cells: [{ x: 1, y: 1 }], tilesetId: slot.assetId, tileId: slot.tileId });
    const asset = store.rasterAssets.getAsset(slot.assetId);
    const canvas = new OffscreenCanvas(asset.width, asset.height);
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(asset.data), asset.width, asset.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    setTilesetImage({ tilesetId: slot.assetId, bitmap: await createImageBitmap(blob), bytes: new Uint8Array(await blob.arrayBuffer()) });
    const root = await navigator.storage.getDirectory();
    const writer = await (await root.getFileHandle("keep.txt", { create: true })).createWritable();
    await writer.write("unrelated"); await writer.close();
  });
  for (const target of ["Godot 4", "Defold", "Unity", "Tiled"]) {
    const dialog = await openExport(page, target);
    await expect(dialog.getByTestId("export-submit")).toBeEnabled();
    await dialog.getByTestId("export-submit").click();
    await expect(dialog).toBeHidden();
    const output = await files(page);
    const prefix = target === "Godot 4" ? "smap/" : target === "Defold" ? "exported/Ana harita/" : "";
    expect(output.filter(f => f.path.startsWith(prefix) && f.path.endsWith(".png") && (prefix !== "" || !f.path.includes("/")))).toHaveLength(2);
    if (target === "Unity") {
      const map = JSON.parse((await readOpfsText(page, "Ana harita.smapmap"))!);
      expect(map.tilesets).toHaveLength(2);
      expect(map.tilesets.some((ts: { name: string }) => ts.name.includes("(yol)"))).toBe(true);
      expect(map.tilesets.some((ts: { name: string }) => ts.name.includes("Düzenlenen"))).toBe(true);
    }
    expect(await readOpfsText(page, "keep.txt")).toBe("unrelated");
  }
  expect(await readOpfsText(page, "Ana harita.smapmap")).not.toBeNull();
  expect(await readOpfsText(page, "Ana harita.tmj")).not.toBeNull();
});

for (const target of ["Godot 4", "Defold"]) test(`${target} exports manual collision with every tile layer excluded`, async ({ page }) => {
  await page.goto("/"); await startWithTileset(page);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const store = useEditorStore.getState().project.store;
    const layer = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintGrid", layerId: layer, cells: [{ x: 1, y: 1, value: 1 }] });
  });
  const dialog = await openExport(page, target);
  await dialog.getByTestId("export-layers").getByRole("checkbox").uncheck();
  await expect(dialog.getByTestId("export-submit")).toBeEnabled();
  await dialog.getByTestId("export-submit").click();
  await expect(dialog).toBeHidden();
  const output = await files(page);
  expect(output.some(f => f.path.endsWith(target === "Godot 4" ? ".tscn" : ".collisionobject"))).toBe(true);
  expect(output.some(f => f.path.endsWith(".png"))).toBe(false);
});
