import { expect, it } from "vitest";
import { createDocument, encodeRgbaPng, MapStore, serializeLevel, cellPaletteIndex, parseProject, parseLevel } from "@smap/core";
import { MemoryFileSystem } from "./memoryFs";
import { saveProject } from "./projectIo";
import { captureLevelBackup, restoreLevelBackup } from "./pixelBackups";
import { decodeEditedPng } from "./editedPng";
import { loadEditedRaster } from "./pixelAssetIo";
const decode = async () => ({ close() {} }) as ImageBitmap;
const red = Uint8Array.of(255, 0, 0, 255), green = Uint8Array.of(0, 255, 0, 255);

it("backs up source bytes independently of later disk changes and retains legacy level-only backups", async () => {
  const ts = { id: "source", name: "Source", imagePath: "tilesets/source.png", tileWidth: 1, tileHeight: 1, columns: 1, rows: 1, margin: 0, spacing: 0 };
  const store = new MapStore(createDocument({ width: 1, height: 1, tilesets: [ts] }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  store.dispatch({ type: "paintCells", layerId, cells: [{ x: 0, y: 0, cell: store.getOrAddPaletteIndex(ts.id, 0) }] });
  const fs = new MemoryFileSystem(), levelText = serializeLevel(store.document);
  await saveProject(fs, { name: "W", document: store.document, levelPath: "levels/main.json", tilesetBytes: () => encodeRgbaPng(1, 1, red) });
  const text = await captureLevelBackup(fs, levelText, await fs.readText("project.smap"));
  expect(await captureLevelBackup(fs, levelText, await fs.readText("project.smap"))).toBe(text);
  await fs.writeBytes(ts.imagePath, encodeRgbaPng(1, 1, green));
  expect(await captureLevelBackup(fs, levelText, await fs.readText("project.smap"))).not.toBe(text);
  const restored = await restoreLevelBackup(fs, text, store.document, decode, store.rasterAssets.assetIds());
  expect([...decodeEditedPng(restored.images[0]!.bytes!).data]).toEqual([...red]);
  expect(restored.images[0]!.tilesetId).not.toBe(ts.id);
  expect(serializeLevel(store.document)).toBe(levelText);
  expect(decodeEditedPng(await fs.readBytes(ts.imagePath)).data).toEqual(green);
  expect(serializeLevel((await restoreLevelBackup(fs, levelText, store.document, decode, store.rasterAssets.assetIds())).document)).toBe(levelText);
});

it("restores a shared-slot backup after COW without overwriting any live raster slot", async () => {
  const store = new MapStore(createDocument({ width: 2, height: 1, tileWidth: 1, tileHeight: 1 }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const slot = store.dispatch({ type: "allocateEditedTile", tileWidth: 1, tileHeight: 1, pixels: red });
  store.dispatch({ type: "remapCells", layerId, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }], tilesetId: slot.assetId, tileId: 0 });
  const fs = new MemoryFileSystem();
  async function save() {
    await saveProject(fs, { name: "W", document: store.document, levelPath: "levels/main.json", tilesetBytes: id => { const r = store.rasterAssets.getAsset(id)!; return encodeRgbaPng(r.width, r.height, r.data); } });
    return captureLevelBackup(fs, serializeLevel(store.document), await fs.readText("project.smap"));
  }
  const text = await save();
  const clone = store.dispatch({ type: "allocateEditedTile", tileWidth: 1, tileHeight: 1, pixels: green });
  store.dispatch({ type: "remapCells", layerId, cells: [{ x: 0, y: 0 }], tilesetId: clone.assetId, tileId: clone.tileId });
  await save();
  const restored = await restoreLevelBackup(fs, text, store.document, decode, store.rasterAssets.assetIds()), sibling = store.createSibling(restored.document);
  for (const image of restored.images) loadEditedRaster(sibling, restored.document.getTileset(image.tilesetId)!, image.bytes!);
  for (const x of [0, 1]) {
    const e = sibling.document.palette.get(cellPaletteIndex(sibling.document.layers[0]!.getCell(x, 0)))!;
    expect(sibling.rasterAssets.getTile(e.tilesetId, e.tileId)!.data).toEqual(red);
  }
  expect(store.rasterAssets.getTile(clone.assetId, clone.tileId)!.data).toEqual(green);
  expect(store.rasterAssets.getTile(slot.assetId, slot.tileId)!.data).toEqual(red);
  // Validation precedes publication, so a corrupt historical revision cannot
  // partially replace current metadata or raster state.
  const backup = JSON.parse(text) as { project: unknown };
  const path = parseProject(JSON.stringify(backup.project)).tilesets[0]!.imagePath;
  await fs.writeBytes(path, encodeRgbaPng(1, 1, green));
  const before = serializeLevel(store.document);
  await expect(restoreLevelBackup(fs, text, store.document, decode, store.rasterAssets.assetIds())).rejects.toThrow();
  expect(serializeLevel(store.document)).toBe(before);
  expect(store.rasterAssets.getTile(clone.assetId, clone.tileId)!.data).toEqual(green);
});

it("restores generated road artwork as a frozen snapshot independent of source regeneration", async () => {
  const { saveFixture } = await import("./saveRecovery.testHelper");
  const { saveProjectLevels } = await import("./projectIo");
  const fixture = saveFixture(false), fs = new MemoryFileSystem();
  await saveProjectLevels(fs, fixture.input());
  const before = await captureLevelBackup(fs, await fs.readText("levels/a.json"), await fs.readText("project.smap"));
  fixture.edit(); await saveProjectLevels(fs, fixture.input());
  const live = fixture.input().document, restored = await restoreLevelBackup(fs, before, live, decode, []);
  const bankId = restored.document.palette.entries()[1]!.tilesetId;
  expect(restored.document.getTileset(bankId)!.generated).toBeUndefined();
  expect(restored.document.getTileset("bank")!.generated).toBeDefined();
  const image = restored.images.find(i => i.tilesetId === bankId)!;
  expect([...decodeEditedPng(image.bytes!).data.slice(0, 4)]).toEqual([...red]);
  expect([...decodeEditedPng(await fs.readBytes("tilesets/bank.png")).data.slice(0, 4)]).toEqual([...green]);
});

it("never reuses a raster id still retained by another map or its undo history", async () => {
  const store = new MapStore(createDocument({ width: 1, height: 1, tileWidth: 1, tileHeight: 1 }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const slot = store.dispatch({ type: "allocateEditedTile", tileWidth: 1, tileHeight: 1, pixels: red });
  store.dispatch({ type: "remapCells", layerId, cells: [{ x: 0, y: 0 }], tilesetId: slot.assetId, tileId: 0 });
  const fs = new MemoryFileSystem();
  await saveProject(fs, { name: "W", document: store.document, levelPath: "levels/main.json", tilesetBytes: id => { const r = store.rasterAssets.getAsset(id)!; return encodeRgbaPng(r.width, r.height, r.data); } });
  const backup = await captureLevelBackup(fs, serializeLevel(store.document), await fs.readText("project.smap"));
  const first = await restoreLevelBackup(fs, backup, store.document, decode, store.rasterAssets.assetIds()), live = store.createSibling(first.document), id = first.images[0]!.tilesetId;
  loadEditedRaster(live, first.document.getTileset(id)!, first.images[0]!.bytes!);
  live.dispatch({ type: "editTilePixels", assetId: id, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: green });
  const other = live.createSibling(parseLevel(serializeLevel(live.document), live.document.tilesets));
  // Drop the metadata from this map while the raster remains shared/undoable.
  live.dispatch({ type: "removeTileset", tilesetId: id });
  const second = await restoreLevelBackup(fs, backup, live.document, decode, live.rasterAssets.assetIds());
  expect(second.images[0]!.tilesetId).not.toBe(id);
  const restored = live.createSibling(second.document);
  loadEditedRaster(restored, second.document.getTileset(second.images[0]!.tilesetId)!, second.images[0]!.bytes!);
  expect(restored.rasterAssets.getTile(second.images[0]!.tilesetId, 0)!.data).toEqual(red);
  expect(other.rasterAssets.getTile(id, 0)!.data).toEqual(green);
});
