import { LevelWorkspace } from "./levelWorkspace";
import { describe, expect, it } from 'vitest';
import { exportGameJson, createDocument, MapStore, encodeRgbaPng, serializeLevel, parseProject } from '@smap/core';
import { MemoryFileSystem } from './memoryFs';
import { loadProject, projectFiles, saveProject } from './projectIo';
import { decodeEditedPng } from './editedPng';
import { loadEditedRaster } from './pixelAssetIo';
import { unityExportFiles, tmjExportFiles } from '../export/exportFiles';
import { snapshotGodot, godotTarget } from '../export/targets/godot';
import { defoldTarget } from '../export/targets/defold';

function fixture() {
  const store = new MapStore(createDocument({ width: 4, height: 4, tileWidth: 16, tileHeight: 16 }));
  const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
  const pixels = new Uint8Array(16 * 16 * 4); pixels.set([18, 52, 86, 7]); pixels.set([255, 0, 99, 255], 4);
  const slot = store.dispatch({ type: 'allocateEditedTile', tileWidth: 16, tileHeight: 16, pixels });
  store.dispatch({ type: 'remapCells', layerId, cells: [{ x: 0, y: 0 }], tilesetId: slot.assetId, tileId: slot.tileId });
  const ts = store.document.getTileset(slot.assetId)!, raster = store.rasterAssets.getAsset(slot.assetId)!, png = encodeRgbaPng(raster.width, raster.height, raster.data);
  const input = { name: 'World', document: store.document, levelPath: 'levels/main.json', tilesetBytes: () => png };
  return { store, ts, pixels, png, input };
}
const decode = async (bytes: Uint8Array) => { const { width, height } = decodeEditedPng(bytes); return { width, height, close() {} } as ImageBitmap; };
describe('edited pixel persistence and exports', () => {
  it('writes content-addressed PNG before manifests, reopens exact low-alpha pixels and reuses bytes', async () => {
    const { store, ts, pixels, png, input } = fixture(), fs = new MemoryFileSystem();
    expect(projectFiles(input).map(f => f.path)).toEqual([ts.imagePath, 'levels/main.json', 'project.smap']);
    await saveProject(fs, input);
    const loaded = await loadProject(fs, decode), reopened = new MapStore(loaded.document);
    loadEditedRaster(reopened, loaded.document.getTileset(ts.id)!, loaded.images[0]!.bytes!);
    expect(reopened.rasterAssets.getTile(ts.id, 0)!.data).toEqual(pixels);
    expect(serializeLevel(reopened.document)).toBe(serializeLevel(store.document));
    expect(await fs.readBytes(ts.imagePath)).toEqual(png);
    const writes: string[] = [], write = fs.writeBytes.bind(fs); fs.writeBytes = async (p, b) => { writes.push(p); await write(p, b); };
    await saveProject(fs, input); expect(writes).not.toContain(ts.imagePath);
  });
  it('keeps the previous PNG/manifest usable at each failed write boundary', async () => {
    const { store, ts, input } = fixture();
    for (let failAt = 0; failAt < 3; failAt++) {
      const fs = new MemoryFileSystem(); await saveProject(fs, input);
      const manifest = await fs.readText('project.smap'), oldPng = await fs.readBytes(ts.imagePath);
      store.dispatch({ type: 'editTilePixels', assetId: ts.id, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: new Uint8Array([failAt + 3, 5, 6, 255]) });
      const raster = store.rasterAssets.getAsset(ts.id)!, next = { ...input, tilesetBytes: () => encodeRgbaPng(raster.width, raster.height, raster.data) };
      let n = 0; const write = fs.writeBytes.bind(fs); fs.writeBytes = async (path, bytes) => { if (n++ === failAt) throw new Error('injected'); await write(path, bytes); };
      await expect(saveProject(fs, next)).rejects.toThrow('injected');
      expect(await fs.readText('project.smap')).toBe(manifest); expect(await fs.readBytes(ts.imagePath)).toEqual(oldPng);
      expect(parseProject(manifest).tilesets[0]!.imagePath).toBe(ts.imagePath);
      // Restore this revision as the baseline for the next injected boundary.
      store.undo();
    }
  });
  it('includes generated PNGs in Unity, TMJ, JSON/project Zip, Godot and Defold', async () => {
    const { store, ts, png, input } = fixture(), bytes = () => png;
    for (const set of [unityExportFiles(store.document, 'main', bytes), tmjExportFiles(store.document, 'main', bytes)]) expect(set.files.some(f => f.data === png)).toBe(true);
    expect(exportGameJson(store.document)).toContain(ts.imagePath.split("/").at(-1));
    expect(projectFiles(input).some(f => f.path === ts.imagePath && f.data === png)).toBe(true);
    const godot = await godotTarget.planFiles(await snapshotGodot({ maps: [{ doc: store.document, name: 'main' }], bytes }));
    expect(godot.files.some(f => f.data instanceof Uint8Array && f.data.length === png.length)).toBe(true);
    const defold = await defoldTarget.planFiles({ doc: store.document, levelName: 'main', bytes }, {});
    expect(defold.some(f => f.data instanceof Uint8Array && f.data.length === png.length)).toBe(true);
  });
});

it('Save As includes clean cached maps and edited PNGs in the destination', async () => {
  const { store, png, ts } = fixture();
  const ws = new LevelWorkspace({ name: 'W', levels: [{ id: 'a', name: 'A', path: 'levels/a.json', world: { x: 0, y: 0 } }], active: { id: 'a', store, knownText: null } });
  const b = ws.add({ name: 'B', width: 4, height: 4, tileSize: 16, layerName: 'Ground' });
  const old = new MemoryFileSystem(), next = new MemoryFileSystem();
  await ws.save(old, { tilesetBytes: () => png });
  expect(ws.entry(b.id)!.dirty).toBe(false);
  await ws.save(next, { tilesetBytes: () => png, allLevels: true });
  expect(await next.readText(ws.level(b.id)!.path)).toBe(await old.readText(ws.level(b.id)!.path));
  expect(await next.readBytes(ts.imagePath)).toEqual(png);
});
it('refuses missing or corrupt authoritative edited PNGs before opening for edits', async () => {
  const { input, ts, png } = fixture(), fs = new MemoryFileSystem(); await saveProject(fs, input);
  await fs.remove(ts.imagePath); await expect(loadProject(fs, decode)).rejects.toThrow();
  const bad = png.slice(); bad[bad.length - 1] = bad[bad.length - 1]! ^ 1; await fs.writeBytes(ts.imagePath, bad);
  await expect(loadProject(fs, decode)).rejects.toThrow();
});
