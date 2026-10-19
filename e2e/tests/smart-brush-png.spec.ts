import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { test, expect, readOpfsText } from "../support/fixtures";
import { openRoadSheet, selectRoad, dragRoad, waitForSaveIdle } from "../support/smartStampDock";

for (const alpha of [false, true]) test(`preview and painting need no PNG; saving preserves legacy bytes (alpha=${alpha})`, async ({ page }) => {
  await openRoadSheet(page);
  if (alpha) await page.evaluate(async () => {
    const { getTilesetImage, setTilesetImage } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const image = getTilesetImage("smart-road-32"), canvas = new OffscreenCanvas(image.bitmap.width, image.bitmap.height), ctx = canvas.getContext("2d")!;
    ctx.drawImage(image.bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i]) pixels.data[i] = 127;
    ctx.putImageData(pixels, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    setTilesetImage({ tilesetId: image.tilesetId, bitmap: await createImageBitmap(blob), bytes: new Uint8Array(await blob.arrayBuffer()) });
  });
  await selectRoad(page);
  await expect(page.getByRole("radio", { name: "Yol", exact: true })).toBeVisible();
  const expected = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { autoBrush } = await import(/* @vite-ignore */ String("/src/commands/smartBrushActions.ts"));
    const { getTilesetImage } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const { rasterizeSmartStamp } = await import(/* @vite-ignore */ String("/src/ui/stamps/smartStampBake.ts"));
    const editor = useEditorStore.getState(), prepared = autoBrush(editor.stamp).prepared, asset = prepared.assets[0];
    const sources = new Map();
    for (const [id, image] of prepared.sources) {
      // Independent legacy whole-sheet read and native PNG path, including alpha quantization.
      const canvas = document.createElement("canvas"); canvas.width = image.bitmap.width; canvas.height = image.bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(image.bitmap, 0, 0);
      sources.set(id, { tileset: editor.project.store.document.getTileset(id), pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) });
    }
    const pixels = rasterizeSmartStamp(prepared.source, asset.tileset.generated.layerId, asset.tileset, sources);
    const canvas = document.createElement("canvas"); canvas.width = pixels.width; canvas.height = pixels.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
    return { bytes: [...new Uint8Array(await blob.arrayBuffer())], id: asset.tileset.id, path: asset.tileset.imagePath, encoded: getTilesetImage(asset.tileset.id).bytes !== undefined };
  });
  expect(expected.encoded).toBe(false);
  await dragRoad(page, [[4, 4], [7, 4]]);
  expect(await page.evaluate(async id => {
    const { getTilesetImage } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts")); return getTilesetImage(id).bytes !== undefined;
  }, expected.id)).toBe(false);
  await page.keyboard.press("Control+s"); await expect.poll(() => readOpfsText(page, "project.smap")).not.toBeNull(); await waitForSaveIdle(page);
  const saved = await page.evaluate(async path => {
    let dir = await navigator.storage.getDirectory(); const parts = path.split("/"), file = parts.pop()!;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    return [...new Uint8Array(await (await (await dir.getFileHandle(file)).getFile()).arrayBuffer())];
  }, expected.path);
  expect(saved).toEqual(expected.bytes);
});


test("Zip preview stays unencoded and exporting before save includes the generated PNG", async ({ page }) => {
  await openRoadSheet(page); await selectRoad(page);
  await expect(page.getByRole("radio", { name: "Yol", exact: true })).toBeVisible();
  await dragRoad(page, [[4, 4], [7, 4]]);
  await page.keyboard.press("Control+e");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /^Zip/ }).click();
  const asset = await page.evaluate(async () => {
    const { getTilesetImage } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const bank = useEditorStore.getState().project.store.document.tilesets.find((t: { generated?: unknown }) => t.generated);
    return { id: bank.id, path: bank.imagePath, encoded: getTilesetImage(bank.id).bytes !== undefined };
  });
  expect(asset.encoded).toBe(false);
  expect(await readOpfsText(page, "project.smap")).toBeNull();
  const downloaded = page.waitForEvent("download");
  await dialog.getByTestId("export-submit").click();
  const zip = readFileSync((await (await downloaded).path())!);
  let png: Buffer | undefined;
  // Local ZIP headers carry sizes (the app does not use data descriptors).
  for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) {
    const method = zip.readUInt16LE(offset + 8), size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extra, data = zip.subarray(start, start + size);
    if (name === asset.path) png = method === 8 ? inflateRawSync(data) : data;
    offset = start + size;
  }
  expect(png).toBeDefined();
  const bytes = await page.evaluate(async id => {
    const { getTilesetImage } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts")); return [...getTilesetImage(id).bytes];
  }, asset.id);
  expect([...png!]).toEqual(bytes);
});
