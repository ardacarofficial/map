/** Shared fault matrix for memory, real browser directory and desktop adapters. */
import { createDocument, MapStore, encodeRgbaPng, cellPaletteIndex, tileRect, type Stamp, type Tileset } from "@smap/core";
import type { ProjectFileSystem } from "./fs";
import { loadProject, saveProjectLevels, type SaveProjectInput } from "./projectIo";
import { decodeEditedPng } from "./editedPng";

const decode = async () => ({ close() {} }) as ImageBitmap;
const red = [255, 0, 0, 255], green = [0, 255, 0, 255];
export function saveFixture(grow: boolean) {
  const source = { id: "source", name: "Source", imagePath: "tilesets/source.png", tileWidth: 1, tileHeight: 1, columns: 1, rows: 1, margin: 0, spacing: 0 };
  const bank: Tileset = { ...source, id: "bank", name: "Road", imagePath: "tilesets/bank.png", columns: 8, rows: 8, generated: { kind: "nineSlice", stampId: "road", layerId: "s", sourceWidth: 3, sourceHeight: 3, layoutVersion: 1, sources: [{ tilesetId: "source", imageHash: "old" }] } };
  const recipe: Stamp = { id: "road", name: "before", width: 3, height: 3, palette: [{ tilesetId: "source", tileId: 0 }], layers: [{ layerId: "s", name: "Ground", cells: new Uint32Array(9).fill(1) }] };
  const a = new MapStore(createDocument({ width: 2, height: 2, tileWidth: 1, tileHeight: 1, tilesets: [source, bank] }));
  const layer = a.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const index = a.getOrAddPaletteIndex(source.id, 0), bankIndex = a.getOrAddPaletteIndex(bank.id, 0);
  a.dispatch({ type: "paintCells", layerId: layer, cells: [{ x: 0, y: 0, cell: index }, { x: 1, y: 0, cell: bankIndex }] });
  const allocate = () => a.dispatch({ type: "allocateEditedTile", tileWidth: 1, tileHeight: 1, pixels: Uint8Array.from(green) });
  if (grow) for (let i = 0; i < 16; i++) allocate();
  const b = a.createSibling(createDocument({ width: 2, height: 2, tileWidth: 1, tileHeight: 1, tilesets: a.document.tilesets }));
  const bl = b.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const bi = b.getOrAddPaletteIndex(source.id, 0), bb = b.getOrAddPaletteIndex(bank.id, 0);
  b.dispatch({ type: "paintCells", layerId: bl, cells: [{ x: 0, y: 0, cell: bi }, { x: 1, y: 0, cell: bb }] });
  let edited = false;
  const input = (): SaveProjectInput => ({ name: "World", document: a.document, levelPath: "levels/a.json", levels: [{ id: "a", name: "A", path: "levels/a.json" }, { id: "b", name: "B", path: "levels/b.json" }], otherLevels: [{ path: "levels/b.json", document: b.document }], stamps: [{ ...recipe, name: edited ? "after" : "before" }], generatedRecipes: [{ tilesetId: bank.id, stamp: { ...recipe, name: edited ? "after" : "before" } }], tilesetBytes: id => {
    if (id === source.id) return encodeRgbaPng(1, 1, Uint8Array.from(red));
    if (id === bank.id) { const pixels = new Uint8Array(8 * 8 * 4); for (let i = 0; i < pixels.length; i += 4) pixels.set(edited ? green : red, i); return encodeRgbaPng(8, 8, pixels); }
    const raster = a.rasterAssets.getAsset(id)!;
    return encodeRgbaPng(raster.width, raster.height, raster.data);
  } });
  const edit = () => {
    edited = true;
    const slot = allocate();
    a.dispatch({ type: "remapCells", layerId: layer, cells: [{ x: 0, y: 0 }], tilesetId: slot.assetId, tileId: slot.tileId });
    b.syncProjectData(a.document);
    b.getOrAddPaletteIndex(slot.assetId, slot.tileId);
    b.dispatch({ type: "remapCells", layerId: bl, cells: [{ x: 0, y: 0 }], tilesetId: slot.assetId, tileId: slot.tileId });
  };
  return { input, edit };
}
export async function savedVisibleSnapshot(fs: ProjectFileSystem) {
  const maps = [];
  for (const id of ["a", "b"]) {
    const loaded = await loadProject(fs, decode, { levelId: id }), doc = loaded.document;
    const cells = [];
    for (const x of [0, 1]) {
      const entry = doc.palette.get(cellPaletteIndex(doc.layers[0]!.getCell(x, 0)))!;
      const ts = doc.getTileset(entry.tilesetId);
      if (!ts) throw new Error(`Dangling visible cell: ${entry.tilesetId}`);
      const png = decodeEditedPng(await fs.readBytes(ts.imagePath)), rect = tileRect(ts, entry.tileId);
      const pixel = [...png.data.slice((rect.y * png.width + rect.x) * 4, (rect.y * png.width + rect.x) * 4 + 4)];
      if (pixel.length !== 4) throw new Error("Visible cell lies outside its atlas");
      cells.push(pixel);
    }
    maps.push({ cells, recipe: loaded.generatedRecipes[0]?.stamp.name, stamp: loaded.stamps[0]?.name });
    if (loaded.levels.some(l => !l.path.startsWith("levels/"))) throw new Error("Recovery did not restore canonical map paths");
  }
  return maps;
}

export function faultWrites(fs: ProjectFileSystem, failAt = -1, after = false) {
  const paths: string[] = [];
  const write = async (path: string, run: () => Promise<void>) => {
    const fail = paths.length === failAt; paths.push(path);
    if (fail && !after) throw new Error("injected");
    await run();
    if (fail && after) throw new Error("injected");
  };
  const wrapped: ProjectFileSystem = {
    name: fs.name,
    readText: fs.readText.bind(fs), readBytes: fs.readBytes.bind(fs), mkdir: fs.mkdir.bind(fs), list: fs.list.bind(fs), remove: fs.remove.bind(fs),
    writeText: (p, t) => write(p, () => fs.writeText(p, t)), writeBytes: (p, b) => write(p, () => fs.writeBytes(p, b)),
  };
  return { fs: wrapped, paths };
}

export async function runSaveFailureMatrix(makeFs: () => Promise<ProjectFileSystem>, grow: boolean): Promise<{ boundaries: string[]; cases: number }> {
  const probe = saveFixture(grow), baseline = await makeFs();
  await saveProjectLevels(baseline, probe.input());
  const old = JSON.stringify(await savedVisibleSnapshot(baseline));
  probe.edit();
  const recorder = faultWrites(baseline);
  await saveProjectLevels(recorder.fs, probe.input());
  const next = JSON.stringify(await savedVisibleSnapshot(baseline));
  if (old === next) throw new Error("Fixture did not change visible pixels");
  let cases = 0;
  for (const after of [false, true]) for (let failAt = 0; failAt < recorder.paths.length; failAt++) {
    const { input, edit } = saveFixture(grow), fs = await makeFs();
    await saveProjectLevels(fs, input()); edit();
    const fault = faultWrites(fs, failAt, after);
    let failed = false;
    try { await saveProjectLevels(fault.fs, input()); }
    catch (error) { if (!(error instanceof Error) || !error.message.includes("injected")) throw error; failed = true; }
    if (!failed) throw new Error(`Missed write boundary ${failAt}`);
    const snapshot = JSON.stringify(await savedVisibleSnapshot(fs));
    if (snapshot !== old && snapshot !== next) throw new Error(`Incoherent snapshot at ${recorder.paths[failAt]} (${after ? "after" : "before"}): ${snapshot}`);
    // The failed folder remains writable through the ordinary save path.
    await saveProjectLevels(fs, input());
    if (JSON.stringify(await savedVisibleSnapshot(fs)) !== next) throw new Error("Retry did not save the new snapshot");
    cases++;
  }
  return { boundaries: recorder.paths, cases };
}
