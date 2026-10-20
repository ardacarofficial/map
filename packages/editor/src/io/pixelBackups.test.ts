import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cellPaletteIndex, encodeRgbaPng, serializeLevel } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { useEditorStore } from "../state/editorStore";
import { setTilesetImage } from "../state/tilesetImages";
import { autosaveNow, closeProject, getLevelWorkspace, listProjectBackups, newProject, openBackup, openProjectFromPicker } from "./session";
import { MemoryFileSystem } from "./memoryFs";
import { decodeEditedPng } from "./editedPng";
import { listBackups, rotateBackups, writeBackup } from "./backups";

const bitmap = () => ({ width: 16, height: 1, close() {} }) as ImageBitmap;
let fs: MemoryFileSystem;
const store = () => useEditorStore.getState().project!.store;
const pixels = () => {
  const s = store(), cell = s.document.layers[0]!.getCell(0, 0), entry = s.document.palette.get(cellPaletteIndex(cell))!;
  return [...s.rasterAssets.getTile(entry.tilesetId, entry.tileId)!.data.slice(0, 4)];
};
function publish() {
  for (const ts of store().document.tilesets) {
    const r = store().rasterAssets.getAsset(ts.id)!;
    setTilesetImage({ tilesetId: ts.id, bitmap: bitmap(), bytes: encodeRgbaPng(r.width, r.height, r.data) });
  }
  useEditorStore.getState().setDirty(true);
}
beforeEach(() => {
  fs = new MemoryFileSystem();
  setPlatform({ ...browserPlatform, watchProject() {}, openProjectDialog: async () => ({ fs, ref: "test", label: "test" }), recents: { ...browserPlatform.recents, add: async () => {}, list: async () => [] } });
  vi.stubGlobal("createImageBitmap", async () => bitmap());
});
afterEach(() => { closeProject(); setPlatform(browserPlatform); vi.unstubAllGlobals(); });

describe("historical raster backups through the production session", () => {
  it("red → save → green pixel-only patch → save → restart → old backup shows red, other maps stay green", async () => {
    await newProject({ name: "World", width: 2, height: 2, tileSize: 1, folder: { fs, ref: "test", label: "test" } });
    const s = store(), layerId = s.document.layers[0]!.id;
    const slot = s.dispatch({ type: "allocateEditedTile", tileWidth: 1, tileHeight: 1, pixels: Uint8Array.of(255, 0, 0, 255) });
    s.dispatch({ type: "remapCells", layerId, cells: [{ x: 0, y: 0 }], tilesetId: slot.assetId, tileId: 0 });
    publish(); await autosaveNow();
    const redBackup = (await listProjectBackups())[0]!;
    expect(redBackup).toBeDefined();
    const levelText = serializeLevel(s.document);
    s.dispatch({ type: "editTilePixels", assetId: slot.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: Uint8Array.of(0, 255, 0, 255) });
    expect(serializeLevel(s.document)).toBe(levelText);
    publish(); await autosaveNow();
    expect((await listProjectBackups()).length).toBeGreaterThanOrEqual(3); // initial empty, red, green (even within one second)
    closeProject(); await openProjectFromPicker(); expect(pixels()).toEqual([0, 255, 0, 255]);
    const ws = getLevelWorkspace()!, other = await ws.duplicate(ws.activeId, "Other", fs);
    const otherStore = ws.entry(other.id)!.store;
    expect(await openBackup(redBackup)).toBe(true);
    expect(pixels()).toEqual([255, 0, 0, 255]);
    expect([...otherStore.rasterAssets.getTile(slot.assetId, 0)!.data.slice(0, 4)]).toEqual([0, 255, 0, 255]);
    // Restored assets participate in ordinary saves and survive another restart.
    await autosaveNow(); closeProject(); await openProjectFromPicker(); expect(pixels()).toEqual([255, 0, 0, 255]);
    await getLevelWorkspace()!.activate(other.id, fs);
    const loadedOther = getLevelWorkspace()!.active.store;
    expect([...loadedOther.rasterAssets.getTile(slot.assetId, 0)!.data.slice(0, 4)]).toEqual([0, 255, 0, 255]);
  });

  it("retention never deletes raster revisions referenced by kept map backups", async () => {
    await newProject({ name: "World", width: 2, height: 2, tileSize: 1, folder: { fs, ref: "test", label: "test" } });
    const slot = store().dispatch({ type: "allocateEditedTile", tileWidth: 1, tileHeight: 1, pixels: Uint8Array.of(255, 0, 0, 255) });
    store().dispatch({ type: "remapCells", layerId: store().document.layers[0]!.id, cells: [{ x: 0, y: 0 }], tilesetId: slot.assetId, tileId: 0 });
    publish(); await autosaveNow();
    const backup = (await listProjectBackups())[0]!, text = await fs.readText(backup.path);
    for (let i = 0; i < 12; i++) await writeBackup(fs, "other", text, new Date(2026, 0, 1, 0, i));
    await rotateBackups(fs, "main", 1);
    expect(await listBackups(fs, "other")).toHaveLength(10);
    closeProject(); await openProjectFromPicker(); expect(await openBackup(backup)).toBe(true); expect(pixels()).toEqual([255, 0, 0, 255]);
    const images = [...fs.files].filter(([path]) => path.startsWith("tilesets/snapshots/") && path.endsWith(".png"));
    expect(images.length).toBeGreaterThan(0);
    expect(images.some(([, bytes]) => decodeEditedPng(bytes).data.includes(255))).toBe(true);
  });
});
