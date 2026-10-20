/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, readdir, unlink, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSaveFailureMatrix } from "../../editor/src/io/saveRecovery.testHelper";
import { createDocument, encodeRgbaPng, MapStore, serializeLevel } from "../../core/src/index";
import { loadProject, saveProject } from "../../editor/src/io/projectIo";
import { captureLevelBackup, restoreLevelBackup } from "../../editor/src/io/pixelBackups";
import { loadEditedRaster } from "../../editor/src/io/pixelAssetIo";
import { writeBackup } from "../../editor/src/io/backups";

// Exercise the real adapter and its raw byte/error translation against a real
// folder. Only the Rust invoke boundary is substituted; Windows remains a gate.
vi.mock("@smap/editor", async () => await import("../../editor/src/io/fs"));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: Record<string, unknown> | Uint8Array, options?: { headers?: Record<string, string> }) => {
  const fields = args as Record<string, unknown>;
  const path = options?.headers?.["x-smap-path"] ? decodeURIComponent(options.headers["x-smap-path"]) : fields.path as string;
  try {
    switch (command) {
      case "read_text": return await readFile(path, "utf8");
      case "read_file": { const data = await readFile(path); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); }
      case "write_text_atomic":
      case "write_file_atomic": {
        await writeFile(`${path}.tmp`, command === "write_text_atomic" ? fields.text as string : args as Uint8Array);
        await rename(`${path}.tmp`, path);
        return;
      }
      case "create_dir_all": await mkdir(path, { recursive: true }); return;
      case "list_dir": return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
      case "remove_file": await unlink(path); return;
      default: throw new Error(`Unexpected command ${command}`);
    }
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      if (command === "list_dir") return [];
      if (command === "remove_file") return;
      throw { kind: "NotFound", path, message: "missing" };
    }
    throw error;
  }
} }));
const { TauriFileSystem } = await import("./tauriFileSystem");
let root: string, next = 0;
beforeEach(async () => { root = await mkdtemp(fileURLToPath(new URL("../.save-test-", import.meta.url))); next = 0; });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe.each([false, true])("desktop save recovery (atlas growth: %s)", grow => {
  it("reopens old or new pixels for both maps at every PNG, root, level, recipe and stamp boundary", async () => {
    const result = await runSaveFailureMatrix(async () => new TauriFileSystem(join(root, `case-${next++}`)), grow);
    expect(result.boundaries).toContain("tilesets/bank.recipe.json");
    expect(result.boundaries).toContain("project.smap");
    expect(result.cases).toBeGreaterThan(20);
  }, 120_000);
});

it("desktop red → save → green → save → cold open restores historical red without touching a shared live slot", async () => {
  const fs = new TauriFileSystem(join(root, "backup")), decode = async () => ({ close() {} }) as ImageBitmap;
  const store = new MapStore(createDocument({ width: 1, height: 1, tileWidth: 1, tileHeight: 1 }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const slot = store.dispatch({ type: "allocateEditedTile", tileWidth: 1, tileHeight: 1, pixels: Uint8Array.of(255, 0, 0, 255) });
  store.dispatch({ type: "remapCells", layerId, cells: [{ x: 0, y: 0 }], tilesetId: slot.assetId, tileId: 0 });
  const save = () => saveProject(fs, { name: "W", document: store.document, levelPath: "levels/main.json", tilesetBytes: id => {
    const r = store.rasterAssets.getAsset(id)!; return encodeRgbaPng(r.width, r.height, r.data);
  } });
  const oldLevel = await save();
  const backup = await writeBackup(fs, "main", await captureLevelBackup(fs, oldLevel, await fs.readText("project.smap")), new Date());
  store.dispatch({ type: "editTilePixels", assetId: slot.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: Uint8Array.of(0, 255, 0, 255) });
  expect(await save()).toBe(oldLevel);
  const loaded = await loadProject(fs, decode), live = new MapStore(loaded.document);
  for (const image of loaded.images) loadEditedRaster(live, loaded.document.getTileset(image.tilesetId)!, image.bytes!);
  const other = live.createSibling(loaded.document);
  const historical = await restoreLevelBackup(fs, await fs.readText(backup), live.document, decode, live.rasterAssets.assetIds()), restored = live.createSibling(historical.document);
  for (const image of historical.images) loadEditedRaster(restored, historical.document.getTileset(image.tilesetId)!, image.bytes!);
  const id = historical.images[0]!.tilesetId;
  expect([...restored.rasterAssets.getTile(id, 0)!.data]).toEqual([255, 0, 0, 255]);
  expect([...other.rasterAssets.getTile(slot.assetId, 0)!.data]).toEqual([0, 255, 0, 255]);
  expect(serializeLevel(live.document)).toBe(oldLevel);
  // Native atomic writes do not create parents. Save As must create the
  // retained snapshot's nested tilesets directory in an empty destination.
  const next = new TauriFileSystem(join(root, "save-as"));
  const bytes = new Map([...loaded.images, ...historical.images].map(image => [image.tilesetId, image.bytes!]));
  await saveProject(next, { name: "W", document: restored.document, levelPath: "levels/main.json", tilesetBytes: id => bytes.get(id) });
  const reopened = await loadProject(next, decode), saved = new MapStore(reopened.document);
  for (const image of reopened.images) loadEditedRaster(saved, reopened.document.getTileset(image.tilesetId)!, image.bytes!);
  expect([...saved.rasterAssets.getTile(id, 0)!.data]).toEqual([255, 0, 0, 255]);
});
