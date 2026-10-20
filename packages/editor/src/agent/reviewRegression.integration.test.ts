import { afterEach, expect, it, vi } from "vitest";
import type * as BakeModule from "../ui/stamps/smartStampBake";
import { AGENT_LIMITS, createAgentApi, type AgentApi, type AgentSignal, type ToolName } from "@smap/agent";
import { encodeRgbaPng, makeCell, parseProject, serializeLevel, type Stamp, type Tileset } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { closeProject, getLevelWorkspace, newProject, openLevel, openProjectFromPicker, saveCurrentProject } from "../io/session";
import { MemoryFileSystem } from "../io/memoryFs";
import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { bakeSmartStamp } from "../ui/stamps/smartStampBake";
import { createEditorHost } from "./editorHost";
import { createAgentSignal } from "./runtime";
vi.mock("../ui/stamps/smartStampBake", async original => ({ ...await original<typeof BakeModule>(), bakeSmartStamp: vi.fn(async (_stamp: Stamp, _layer: string, target: Tileset) => {
  const width = target.columns * target.tileWidth, height = target.rows * target.tileHeight;
  return { tilesetId: target.id, bytes: encodeRgbaPng(width, height, new Uint8Array(width * height * 4).fill(255)), bitmap: { width, height, close: vi.fn() } as unknown as ImageBitmap };
}) }));
const signal: AgentSignal = { aborted: false, throwIfAborted() {}, onAbort: () => () => {} };
let api: AgentApi | undefined;
afterEach(async () => { await api?.userAction("discard"); closeProject(); setPlatform(browserPlatform); vi.mocked(bakeSmartStamp).mockClear(); });
async function setup() {
  const fs = new MemoryFileSystem();
  setPlatform({ ...browserPlatform, watchProject() {}, openProjectDialog: async () => ({ fs, label: "Review", ref: "review" }) });
  await newProject({ name: "Review", width: 8, height: 8, tileSize: 5, folder: { fs, label: "Review", ref: "review" } });
  const ws = getLevelWorkspace()!, store = ws.active.store, mapId = ws.activeId, layerId = store.document.layers[0]!.id;
  store.dispatch({ type: "addTileset", tileset: { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: 5, tileHeight: 5, columns: 3, rows: 3, margin: 0, spacing: 0 } });
  const source = (value: number) => ({ tilesetId: "art", bytes: encodeRgbaPng(15, 15, new Uint8Array(900).fill(value)), bitmap: { width: 15, height: 15, close: vi.fn() } as unknown as ImageBitmap });
  setTilesetImage(source(255));
  useProjectLibrary.getState().addStamp({ id: "road", name: "Road", width: 3, height: 3, palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: "art", tileId })), layers: [{ layerId: "source", name: store.document.layers[0]!.name, cells: Uint32Array.from({ length: 9 }, (_, i) => makeCell(i + 1)) }] });
  const b = ws.add({ name: "B", width: 8, height: 8, tileSize: 5, layerName: "Ground" });
  const c = ws.add({ name: "C", width: 8, height: 8, tileSize: 5, layerName: "Ground" });
  await saveCurrentProject(false);
  const host = createEditorHost(); api = createAgentApi(host);
  const context = () => ({ worldSessionId: api!.getState().worldSessionId! });
  const editContext = () => ({ ...context(), transactionId: api!.getState().transaction!.id, expectedRevision: api!.getState().revision, idempotencyKey: crypto.randomUUID() });
  const call = (name: ToolName, args: object, callSignal = signal) => api!.executeTool({ name, arguments: args, clientSessionId: "client", clientInfo: { name: "Review", version: "1" }, bridgeEpoch: "epoch", deadline: Date.now() + 30000, signal: callSignal });
  const ok = async (name: ToolName, args: object) => { const result = (await call(name, args)).structuredContent; expect(result, `${name}: ${JSON.stringify(result)}`).toMatchObject({ ok: true }); if (!result.ok) throw Error(result.message); return result; };
  const begin = (id = mapId) => ok("begin_edit", { context: context(), expectedRevision: api!.getState().revision, idempotencyKey: crypto.randomUUID(), requestLabel: "Review", mapIds: [id] });
  const prepare = () => ({ context: editContext(), mapId, source: { stampId: "road" }, force: true });
  return { fs, ws, store, mapId, layerId, b, c, host, source, context, editContext, call, ok, begin, prepare };
}
it("inactive-map atlas survives approval, save from another tab, undo/redo and reopen (#1)", async () => {
  const h = await setup(); await h.begin(h.b.id);
  await h.ok("prepare_smart_source", { ...h.prepare(), mapId: h.b.id });
  const target = h.ws.entry(h.b.id)!.store;
  const generated = target.document.tilesets.find(ts => ts.generated)!;
  await h.ok("paint_cells", { context: h.editContext(), mapId: h.b.id, layerId: target.document.layers[0]!.id, cells: [{ x: 1, y: 1, value: { tilesetId: generated.id, tileId: 0 } }] });
  const painted = serializeLevel(target.document);
  expect(h.ws.activeId).toBe(h.mapId);
  await api!.userAction("approve");
  h.ws.history.undo(); expect(h.store.document.getTileset(generated.id)).toBeUndefined();
  h.ws.history.redo(); expect(h.store.document.getTileset(generated.id)).toEqual(generated);
  expect(await saveCurrentProject(false)).toBe(true);
  expect(parseProject(await h.fs.readText("project.smap")).tilesets).toContainEqual(generated);
  expect(await h.fs.readBytes(generated.imagePath)).toEqual(getTilesetImage(generated.id)!.bytes);
  closeProject(); await openProjectFromPicker();
  expect(getLevelWorkspace()!.active.store.document.getTileset(generated.id)).toEqual(generated);
  await openLevel(h.b.id); expect(getLevelWorkspace()!.active.store.document.getTileset(generated.id)).toEqual(generated);
  expect(serializeLevel(getLevelWorkspace()!.active.store.document)).toBe(painted);
});
it("successive late map reads preserve the original clean rollback baseline (#2)", async () => {
  const h = await setup();
  await h.ws.activate(h.b.id, h.fs); await h.ws.activate(h.c.id, h.fs); await h.ws.activate(h.mapId, h.fs);
  expect(h.ws.entry(h.b.id)).toBeUndefined(); expect(h.ws.entry(h.c.id)).toBeUndefined();
  const before = serializeLevel(h.store.document);
  await h.begin(); await h.ok("prepare_smart_source", h.prepare());
  const generated = h.store.document.tilesets.find(ts => ts.generated)!;
  for (const id of [h.b.id, h.c.id]) {
    // Enlisting staged metadata advances the revision; retry the now-loaded read.
    const args = { context: h.context(), mapId: id };
    const result = (await h.call("get_map_info", args)).structuredContent;
    if (!result.ok) expect(result.code).toBe("REVISION_CONFLICT");
    await h.ok("get_map_info", args);
  }
  await api!.userAction("discard");
  expect(serializeLevel(h.store.document)).toBe(before);
  for (const id of [h.mapId, h.b.id, h.c.id]) { expect(h.ws.entry(id)!.store.document.getTileset(generated.id)).toBeUndefined(); expect(h.ws.isDirty(id)).toBe(false); }
  expect(useEditorStore.getState().dirty).toBe(false); expect(getTilesetImage(generated.id)).toBeUndefined();
});
it("cancelling source preparation synchronously seals writes and preserves earlier work for review (#6)", async () => {
  const h = await setup(); await h.begin();
  await h.ok("paint_cells", { context: h.editContext(), mapId: h.mapId, layerId: h.layerId, cells: [{ x: 0, y: 0, value: { tilesetId: "art", tileId: 0 } }] });
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const original = vi.mocked(bakeSmartStamp).getMockImplementation()!;
  vi.mocked(bakeSmartStamp).mockImplementationOnce(async (...args) => { await gate; return original(...args); });
  const controller = new AbortController();
  const preparing = h.call("prepare_smart_source", h.prepare(), createAgentSignal(controller));
  await vi.waitFor(() => expect(bakeSmartStamp).toHaveBeenCalled());
  const queued = h.call("paint_cells", { context: h.editContext(), mapId: h.mapId, layerId: h.layerId, cells: [{ x: 1, y: 0, value: { tilesetId: "art", tileId: 1 } }] });
  controller.abort();
  expect(api!.getState().phase).toBe("stopped");
  expect((await preparing).structuredContent).toMatchObject({ ok: false, code: "CANCELLED" });
  expect((await queued).structuredContent).toMatchObject({ ok: false, code: "TRANSACTION_SEALED" });
  resume();
  const atlas = await vi.mocked(bakeSmartStamp).mock.results[0]!.value;
  await vi.waitFor(() => expect(atlas.bitmap.close).toHaveBeenCalledOnce());
  expect(h.store.document.layers[0]!.getCell(0, 0)).not.toBe(0); expect(h.store.document.layers[0]!.getCell(1, 0)).toBe(0);
  await api!.userAction("approve"); expect(h.store.document.layers[0]!.getCell(0, 0)).not.toBe(0);
});
it("same-size image replacement during a catalog read returns REVISION_CONFLICT (#8)", async () => {
  const h = await setup(), original = h.host.images.tileFingerprint;
  vi.spyOn(h.host.images, "tileFingerprint").mockImplementationOnce(async (...args) => {
    const fingerprint = await original(...args); setTilesetImage(h.source(128)); return fingerprint;
  });
  const revision = api!.getState().revision;
  const result = await h.call("get_tile_catalog", { context: h.context(), tilesetId: "art", tileIds: [0, 1] });
  expect(result.structuredContent).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
  expect(api!.getState().revision).toBeGreaterThan(revision);
});
it("repeated rejected preparations release private bitmaps before returning (#7)", async () => {
  const h = await setup(); await h.begin();
  const original = h.host.smartSources.prepare, rejectedIds:string[]=[];
  vi.spyOn(h.host.smartSources, "prepare").mockImplementation(async (args, call) => {
    const source = await original(args, call); rejectedIds.push(source.sourceId);source.retainedBytes = AGENT_LIMITS.retainedBytes + 1; return source;
  });
  for (let i = 0; i < 3; i++) {
    expect((await h.call("prepare_smart_source", h.prepare())).structuredContent).toMatchObject({ ok: false, code: "LIMIT_EXCEEDED" });
    const image = await vi.mocked(bakeSmartStamp).mock.results[i]!.value;
    expect(image.bitmap.close).toHaveBeenCalledOnce();
    expect(h.host.smartSources.get(rejectedIds[i]!)).toBeUndefined();
  }
  expect(api!.getState().transaction!.counters.retainedBytes).toBe(0);
});

it("the real API reserves budget before baking and leaves rejected sources unretained (#7)", async () => {
  const h = await setup(); await h.begin();
  const original = h.host.smartSources.prepare;
  vi.spyOn(h.host.smartSources, "prepare").mockImplementation((args, call, reserve) => original(args, call, bytes => reserve!(AGENT_LIMITS.retainedBytes + bytes)));
  for (let i = 0; i < 3; i++) expect((await h.call("prepare_smart_source", h.prepare())).structuredContent).toMatchObject({ ok: false, code: "LIMIT_EXCEEDED" });
  expect(bakeSmartStamp).not.toHaveBeenCalled();expect(api!.getState().transaction!.counters.retainedBytes).toBe(0);
});
it("cancelling a read leaves the owning map edit writable (#6)", async () => {
  const h = await setup(); await h.begin();let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  vi.spyOn(h.host.images,"tileFingerprint").mockImplementationOnce(async()=>{entered();return new Promise(()=>{});});
  const controller=new AbortController();
  const reading=h.call("get_tile_catalog",{context:h.context(),tilesetId:"art",tileIds:[0]},createAgentSignal(controller));
  await started;controller.abort();expect((await reading).structuredContent).toMatchObject({ok:false,code:"CANCELLED"});
  expect(api!.getState().phase).toBe("running");
  await h.ok("paint_cells",{context:h.editContext(),mapId:h.mapId,layerId:h.layerId,cells:[{x:0,y:0,value:{tilesetId:"art",tileId:0}}]});
});
it("cancel_edit reports success while releasing its own generated images (#8)", async () => {
  const h = await setup();await h.begin();await h.ok("prepare_smart_source",h.prepare());
  await h.ok("cancel_edit",{context:h.editContext()});expect(api!.getState().phase).toBe("ready");
});

it("same-size image replacement across preview preparation invalidates the API read (#8)", async () => {
  const h = await setup();
  h.store.dispatch({type:"paintCells",layerId:h.layerId,cells:[{x:0,y:0,cell:makeCell(h.store.getOrAddPaletteIndex("art",0))}]});
  const original=h.host.images.renderPreview;
  vi.spyOn(h.host.images,"renderPreview").mockImplementationOnce(async(...args)=>{const image=await original(...args);setTilesetImage(h.source(128));return image;});
  expect((await h.call("render_preview",{context:h.context(),mapId:h.mapId})).structuredContent).toMatchObject({ok:false,code:"REVISION_CONFLICT"});
});
