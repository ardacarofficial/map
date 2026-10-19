import type * as BakeModule from "../ui/stamps/smartStampBake";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, makeCell, MapStore, serializeLevel, serializeStamp, parseStamp, type Stamp, type Tileset } from "@smap/core";
import { clearTilesetImages, getTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { useEditorStore } from "../state/editorStore";
import { useProjectLibrary } from "../io/projectLibrary";
import { acceptSmartStamp, disableSmartStamp, prepareSmartStamp, installSmartStamps, waitForSmartStampRegeneration } from "./smartStampCommands";
import { pickStamp, replaceStampContent } from "./stampActions";
import { bakeSmartStamp } from "../ui/stamps/smartStampBake";
import { MemoryFileSystem } from "../io/memoryFs";
import { loadProject, saveProject } from "../io/projectIo";
import { tmjExportFiles, unityExportFiles } from "../export/exportFiles";
import { compositeOps } from "../export/pngComposite";
import { layerDrawList } from "@smap/core";
vi.mock("../ui/stamps/smartStampBake", async importOriginal => ({
  ...await importOriginal<typeof BakeModule>(),
  bakeSmartStamp: vi.fn(async (_stamp: Stamp, _id: string, target: Tileset) => ({ tilesetId: target.id, bytes: Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), bitmap: { width: target.columns * target.tileWidth, height: target.rows * target.tileHeight, close: vi.fn() } as unknown as ImageBitmap })),
}));
const source: Tileset = { id: "source", name: "Source", imagePath: "tilesets/source.png", tileWidth: 5, tileHeight: 5, columns: 3, rows: 3, margin: 0, spacing: 0 };
function setup(multi = false) {
  const store = new MapStore(createDocument({ width: 20, height: 20, tileWidth: 5, tileHeight: 5 }));
  store.dispatch({ type: "addTileset", tileset: source });
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const layer = { layerId, name: "Ground", cells: Uint32Array.from({ length: 9 }, (_, i) => makeCell(i + 1)) };
  const stamp: Stamp = { id: "road", name: "Road", width: 3, height: 3, palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: source.id, tileId })), layers: [layer, ...(multi ? [{ ...layer, layerId: "overlay", name: "Overlay" }] : [])] };
  setTilesetImage({ tilesetId: source.id, bytes: Uint8Array.of(1, 2, 3), bitmap: { width: 15, height: 15, close: vi.fn() } as unknown as ImageBitmap });
  useEditorStore.getState().setProject({ name: "Test", store, levelPath: "levels/main.json" });
  useProjectLibrary.getState().load({ stamps: [stamp], levels: [{ id: "main", name: "Main", path: "levels/main.json", world: { x: 0, y: 0 } }] });
  return { stamp, store, layerId };
}
beforeEach(async () => {
  await waitForSmartStampRegeneration();
  clearTilesetImages(); vi.mocked(bakeSmartStamp).mockClear();
  installSmartStamps();
});
describe("smart stamp authoring", () => {
  it("a later-layer bake failure leaves no tileset, image or metadata behind", async () => {
    const { store, stamp } = setup(true), before = serializeLevel(store.document);
    vi.mocked(bakeSmartStamp).mockImplementationOnce(async (_stamp, _layer, target) => ({ tilesetId: target.id, bytes: new Uint8Array(), bitmap: { close: vi.fn() } as unknown as ImageBitmap })).mockRejectedValueOnce(new Error("decode failed"));
    await expect(prepareSmartStamp(stamp)).rejects.toThrow("decode failed");
    expect(serializeLevel(store.document)).toBe(before); expect(useProjectLibrary.getState().stamps[0]).toBe(stamp);
    expect(store.document.tilesets).toHaveLength(1);
  });
  it("keeps source read-only, registers a separate generated group, preserves identity on rebuild and keeps used cells when disabled", async () => {
    const { store, stamp, layerId } = setup(), original = getTilesetImage(source.id);
    const p = await prepareSmartStamp(stamp); acceptSmartStamp(p);
    const asset = store.document.tilesets.find(t => t.generated)!;
    expect(asset.group).toBe("Üretilen"); expect(getTilesetImage(source.id)).toBe(original);
    expect(asset.imagePath).not.toBe(source.imagePath);
    store.dispatch({ type: "paintCells", layerId, cells: [{ x: 1, y: 1, cell: store.getOrAddPaletteIndex(asset.id, 16) }] });
    const before = store.document.getLayer(layerId)!.getCell(1, 1);
    disableSmartStamp(stamp.id); expect(store.document.getTileset(asset.id)).toBeDefined(); expect(store.document.getLayer(layerId)!.getCell(1, 1)).toBe(before);
    const rebuilt = await prepareSmartStamp(useProjectLibrary.getState().stamps[0]!); acceptSmartStamp(rebuilt);
    expect(store.document.tilesets).toHaveLength(2); expect(store.document.getTileset(asset.id)?.columns).toBe(asset.columns);
  });
  it("preserves/revalidates metadata through unchanged stamp-editor saves; content edits require rebuilding", async () => {
    const { stamp } = setup(); acceptSmartStamp(await prepareSmartStamp(stamp));
    const smart = useProjectLibrary.getState().stamps[0]!;
    const { nineSlice: _old, ...flat } = smart;
    const edited = { ...flat, layers: flat.layers.map(l => ({ ...l, layerId: "temporary" })) };
    expect(replaceStampContent(stamp.id, edited)?.nineSlice).toEqual(smart.nineSlice);
    const changed = { ...edited, layers: edited.layers.map(l => ({ ...l, cells: Uint32Array.from(l.cells, (_, i) => makeCell(i === 0 ? 2 : i + 1)) })) };
    expect(replaceStampContent(stamp.id, changed)?.nineSlice).toBeUndefined();
  });
  it("keeps canonical layer ids unique when the temporary editor inserts or reorders layers", () => {
    const { stamp } = setup(true);
    const saved = replaceStampContent(stamp.id, { ...stamp, layers: [
      { ...stamp.layers[0]!, layerId: "temporary-new" },
      { ...stamp.layers[0]!, layerId: "temporary-ground" },
      stamp.layers[1]!,
    ] })!;
    expect(new Set(saved.layers.map(l => l.layerId)).size).toBe(3);
    expect(parseStamp(serializeStamp(saved)).layers).toHaveLength(3);
  });

  it("content rebuilding allocates a fresh bank while retaining the old recipe and placed art", async () => {
    const { store, stamp, layerId } = setup(); acceptSmartStamp(await prepareSmartStamp(stamp));
    const old = store.document.tilesets.find(t => t.generated)!;
    store.dispatch({ type: "paintCells", layerId, cells: [{ x: 1, y: 1, cell: store.getOrAddPaletteIndex(old.id, 0) }] });
    const cells = new Uint32Array(stamp.layers[0]!.cells); cells[0] = makeCell(2);
    replaceStampContent(stamp.id, { ...stamp, layers: [{ ...stamp.layers[0]!, cells }] });
    const edited = useProjectLibrary.getState().stamps[0]!;
    expect(edited.nineSlice).toBeUndefined();
    acceptSmartStamp(await prepareSmartStamp(edited));
    const next = useProjectLibrary.getState().stamps[0]!.nineSlice!.tileLayers[0]!.tilesetId;
    expect(next).not.toBe(old.id); expect(store.document.getTileset(old.id)).toBeDefined();
    expect(useProjectLibrary.getState().generatedRecipes).toHaveLength(2);
    expect(useProjectLibrary.getState().generatedRecipes.find(r => r.tilesetId === old.id)?.stamp.layers[0]?.cells).toEqual(stamp.layers[0]?.cells);
  });

  it("saves and reopens generated PNGs and stamp metadata, exports the bank through Unity, TMJ and the PNG draw list", async () => {
    const { stamp, store, layerId } = setup(); acceptSmartStamp(await prepareSmartStamp(stamp));
    const asset = store.document.tilesets.find(t => t.generated)!;
    store.dispatch({ type: "paintCells", layerId, cells: [{ x: 2, y: 3, cell: store.getOrAddPaletteIndex(asset.id, 16) }] });
    const bytes = (id: string) => getTilesetImage(id)?.bytes;
    const fs = new MemoryFileSystem("Test");
    await saveProject(fs, { name: "Test", document: store.document, levelPath: "levels/main.json", stamps: useProjectLibrary.getState().stamps, generatedRecipes: useProjectLibrary.getState().generatedRecipes, tilesetBytes: bytes });
    const loaded = await loadProject(fs, async () => ({ width: 40, height: 40, close() {} }) as ImageBitmap);
    expect(loaded.document.tilesets.find(t => t.generated)?.id).toBe(asset.id);
    expect(loaded.generatedRecipes).toHaveLength(1);
    expect(loaded.generatedRecipes[0]?.stamp.layers[0]?.cells).toEqual(stamp.layers[0]?.cells);
    for (const exported of [unityExportFiles(store.document, "main", bytes), tmjExportFiles(store.document, "main", bytes)]) {
      expect(exported.missingImages).toEqual([]); expect(exported.files.some(f => f.data === bytes(asset.id))).toBe(true);
    }
    const list = layerDrawList(store.document, { layers: [layerId] });
    expect(compositeOps(list, 1).some(op => "tilesetId" in op && op.tilesetId === asset.id)).toBe(true);
  });
});


function replaceSource(byte: number): void {
  setTilesetImage({ tilesetId: source.id, bytes: Uint8Array.of(byte), bitmap: { width: 15, height: 15, close: vi.fn() } as unknown as ImageBitmap });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

it("regeneration waits for a gesture begun during baking, then leaves its undo/redo and new image coherent", async () => {
  const { store, stamp, layerId } = setup(); acceptSmartStamp(await prepareSmartStamp(stamp));
  await waitForSmartStampRegeneration();
  const bank = store.document.tilesets.find(t => t.generated)!;
  const old = getTilesetImage(bank.id)!;
  const entered = deferred(), release = deferred();
  vi.mocked(bakeSmartStamp).mockImplementationOnce(async (_s, _l, target) => {
    entered.resolve(); await release.promise;
    return { tilesetId: target.id, bytes: Uint8Array.of(20), bitmap: { close: vi.fn() } as unknown as ImageBitmap };
  });
  const history = store.undoDepth;
  useProjectLibrary.setState({ generatedRecipes: [] }); // Early v3 library fallback.
  replaceSource(20); await entered.promise;
  store.beginTransaction();
  store.dispatch({ type: "paintCells", layerId, cells: [{ x: 1, y: 1, cell: store.getOrAddPaletteIndex(bank.id, 0) }] });
  release.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(getTilesetImage(bank.id)).toBe(old);
  expect(store.document.getTileset(bank.id)?.generated).toEqual(bank.generated);
  store.commit(); await waitForSmartStampRegeneration();
  const current = store.document.getTileset(bank.id)!.generated;
  expect(current).not.toEqual(bank.generated);
  expect(getTilesetImage(bank.id)?.bytes).toEqual(Uint8Array.of(20));
  expect(store.undoDepth).toBe(history + 1);
  expect(useProjectLibrary.getState().generatedRecipes.map(r => r.tilesetId)).toEqual([bank.id]);
  store.undo();
  expect(store.document.getLayer(layerId)?.getCell(1, 1)).toBe(0);
  expect(store.document.getTileset(bank.id)?.generated).toEqual(current);
  expect(getTilesetImage(bank.id)?.bytes).toEqual(Uint8Array.of(20));
  store.redo(); expect(store.document.getLayer(layerId)?.getCell(1, 1)).not.toBe(0);
  expect(store.document.getTileset(bank.id)?.generated).toEqual(current);
});

it("discards stale decoded output, retries latest source after the gesture, and saves only current provenance", async () => {
  const { store, stamp } = setup(); acceptSmartStamp(await prepareSmartStamp(stamp));
  await waitForSmartStampRegeneration();
  const bank = store.document.tilesets.find(t => t.generated)!;
  const entered = deferred(), release = deferred(), close = vi.fn();
  vi.mocked(bakeSmartStamp).mockImplementationOnce(async (_s, _l, target) => {
    entered.resolve(); await release.promise;
    return { tilesetId: target.id, bytes: Uint8Array.of(10), bitmap: { close } as unknown as ImageBitmap };
  });
  replaceSource(10); await entered.promise;
  store.beginTransaction(); release.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  replaceSource(30);
  store.rollback(); await waitForSmartStampRegeneration();
  expect(close).toHaveBeenCalledExactlyOnceWith();
  const { pngHash } = await import("../ui/stamps/smartStampBake");
  expect(store.document.getTileset(bank.id)?.generated?.sources[0]?.imageHash).toBe(await pngHash(Uint8Array.of(30)));
  expect(getTilesetImage(bank.id)?.bitmap.close).not.toHaveBeenCalled();
  const fs = new MemoryFileSystem();
  await saveProject(fs, { name: "Test", document: store.document, levelPath: "levels/main.json", tilesetBytes: id => getTilesetImage(id)?.bytes });
  expect(await fs.readBytes(bank.imagePath)).toEqual(getTilesetImage(bank.id)?.bytes);
});

it("releases output when a project closes during the post-bake transaction wait", async () => {
  const { store, stamp } = setup(); acceptSmartStamp(await prepareSmartStamp(stamp));
  await waitForSmartStampRegeneration();
  const entered = deferred(), release = deferred(), close = vi.fn();
  vi.mocked(bakeSmartStamp).mockImplementationOnce(async (_s, _l, target) => {
    entered.resolve(); await release.promise;
    return { tilesetId: target.id, bytes: Uint8Array.of(10), bitmap: { close } as unknown as ImageBitmap };
  });
  replaceSource(10); await entered.promise;
  store.beginTransaction(); release.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  useEditorStore.getState().setProject(null);
  await waitForSmartStampRegeneration();
  expect(close).toHaveBeenCalledExactlyOnceWith();
  store.rollback();
});

it("generated removal, undo, redo and rollback preserve canonical nineSlice metadata and restore the suspended brush", async () => {
  const { store, stamp } = setup(); acceptSmartStamp(await prepareSmartStamp(stamp));
  await waitForSmartStampRegeneration();
  const smart = useProjectLibrary.getState().stamps[0]!;
  useEditorStore.getState().setStamp(smart);
  const bank = smart.nineSlice!.tileLayers[0]!.tilesetId;
  store.dispatch({ type: "removeTileset", tilesetId: bank });
  expect(useProjectLibrary.getState().stamps[0]).toBe(smart);
  expect(useEditorStore.getState().stamp).toBeNull();
  pickStamp(stamp.id); expect(useEditorStore.getState().stamp).toBeNull();
  store.undo(); expect(useEditorStore.getState().stamp).toBe(smart);
  store.redo(); expect(useEditorStore.getState().stamp).toBeNull();
  store.undo(); expect(useEditorStore.getState().stamp).toBe(smart);
  store.beginTransaction(); store.dispatch({ type: "removeTileset", tilesetId: bank }); store.rollback();
  expect(useProjectLibrary.getState().stamps[0]).toBe(smart);
  expect(useEditorStore.getState().stamp).toBe(smart);
});


it("rejects an incompatible legacy target before baking instead of retrying forever", async () => {
  const { store, stamp } = setup(); acceptSmartStamp(await prepareSmartStamp(stamp));
  await waitForSmartStampRegeneration();
  const bank = store.document.tilesets.find(t => t.generated)!, image = getTilesetImage(bank.id);
  const changed: Stamp = { ...stamp, width: 4, layers: stamp.layers.map(l => ({ ...l, cells: new Uint32Array(12).fill(makeCell(1)) })) };
  useProjectLibrary.setState({ stamps: [changed], generatedRecipes: [] });
  vi.mocked(bakeSmartStamp).mockClear();
  replaceSource(40); await waitForSmartStampRegeneration();
  expect(vi.mocked(bakeSmartStamp)).not.toHaveBeenCalled();
  expect(store.document.tilesets).toHaveLength(2);
  expect(store.document.getTileset(bank.id)?.generated).toEqual(bank.generated);
  expect(getTilesetImage(bank.id)).toBe(image);
});

it("archives a valid thick source and regenerates layout 2 without moving cells or overwriting the PNG",async()=>{
 const ts={...source,columns:6,rows:6},store=new MapStore(createDocument({width:20,height:20,tileWidth:5,tileHeight:5}));
 store.dispatch({type:"addTileset",tileset:ts});const layerId=store.dispatch({type:"addLayer",layer:{name:"Ground"}});
 const draft:Stamp={id:"selection-thick",name:"Thick",width:6,height:6,palette:Array.from({length:36},(_,tileId)=>({tilesetId:ts.id,tileId})),layers:[{layerId:"s",name:"Source",cells:Uint32Array.from({length:36},(_,i)=>i+1)}],nineSlice:{border:2,tileLayers:[]}};
 const image={tilesetId:ts.id,bytes:Uint8Array.of(1,2,3),bitmap:{width:30,height:30,close:vi.fn()}as unknown as ImageBitmap};setTilesetImage(image);
 useEditorStore.getState().setProject({name:"Thick",store,levelPath:"levels/main.json"});useProjectLibrary.getState().load({stamps:[],levels:[]});
 const prepared=await prepareSmartStamp(draft),asset=prepared.assets[0]!;
 expect(parseStamp(serializeStamp(prepared.source)).nineSlice?.border).toBe(2);expect(asset.tileset.generated).toMatchObject({layoutVersion:2,border:2});
 store.dispatch({type:"addTileset",tileset:asset.tileset});setTilesetImage(asset.image);useProjectLibrary.getState().rememberGeneratedRecipes([{tilesetId:asset.tileset.id,stamp:prepared.source}]);
 store.dispatch({type:"paintCells",layerId,cells:[{x:2,y:3,cell:store.getOrAddPaletteIndex(asset.tileset.id,204)}]});const before=serializeLevel(store.document),depth=store.undoDepth;
 setTilesetImage({...image,bytes:Uint8Array.of(4,5,6)});await waitForSmartStampRegeneration();
 expect(store.document.tilesets).toHaveLength(2);expect(serializeLevel(store.document)).toBe(before);expect(store.undoDepth).toBe(depth);
 expect(store.document.getTileset(asset.tileset.id)?.generated).toMatchObject({layoutVersion:2,border:2});expect(getTilesetImage(ts.id)?.bytes).toEqual(Uint8Array.of(4,5,6));
 for(const files of [unityExportFiles(store.document,"main",id=>getTilesetImage(id)?.bytes),tmjExportFiles(store.document,"main",id=>getTilesetImage(id)?.bytes)])expect(files.missingImages).toEqual([]);
});
