import { afterEach, expect, it, vi } from "vitest";
import type * as BakeModule from "../ui/stamps/smartStampBake";
import { createAgentApi, type AgentApi, type ToolName } from "@smap/agent";
import { encodeRgbaPng, makeCell, serializeLevel, type Stamp, type Tileset } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { closeProject, getLevelWorkspace, newProject, openLevel, saveCurrentProject } from "../io/session";
import { MemoryFileSystem } from "../io/memoryFs";
import { useProjectLibrary } from "../io/projectLibrary";
import { setTilesetImage } from "../state/tilesetImages";
import { createEditorHost } from "./editorHost";
vi.mock("../ui/stamps/smartStampBake", async original => ({ ...await original<typeof BakeModule>(), bakeSmartStamp: vi.fn(async (_stamp: Stamp, _layer: string, target: Tileset) => {
  const width = target.columns * target.tileWidth, height = target.rows * target.tileHeight;
  return { tilesetId: target.id, bytes: encodeRgbaPng(width, height, new Uint8Array(width * height * 4).fill(255)), bitmap: { width, height, close() {} } as ImageBitmap };
}) }));
let api: AgentApi | undefined;
afterEach(async () => { await api?.userAction("discard"); closeProject(); setPlatform(browserPlatform); });
for (const action of ["approve", "discard"] as const) it(`live smart source + draw_path ${action} keeps eager metadata followers atomic`, async () => {
  setPlatform({ ...browserPlatform, watchProject() {} });
  await newProject({ name: "Smart integration", width: 16, height: 16, tileSize: 5, folder: {fs: new MemoryFileSystem(), label:"Smart", ref:"smart"} });
  const ws = getLevelWorkspace()!, store = ws.active.store, mapId = ws.activeId, layerId = store.document.layers[0]!.id;
  store.dispatch({ type: "addTileset", tileset: { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: 5, tileHeight: 5, columns: 3, rows: 3, margin: 0, spacing: 0 } });
  setTilesetImage({ tilesetId: "art", bytes: encodeRgbaPng(15, 15, new Uint8Array(900).fill(255)), bitmap: { width: 15, height: 15, close() {} } as ImageBitmap });
  const stamp: Stamp = { id: "road", name: "Road", width: 3, height: 3, palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: "art", tileId })), layers: [{ layerId: "source", name: store.document.layers[0]!.name, cells: Uint32Array.from({ length: 9 }, (_, i) => makeCell(i + 1)) }] };
  useProjectLibrary.getState().addStamp(stamp);
  const follower = ws.add({ name: "Follower", width: 8, height: 8, tileSize: 5, layerName: "Ground" });
  const late = ws.add({ name: "Late", width: 8, height: 8, tileSize: 5, layerName: "Ground" });
  ws.pin(follower.id);
  await saveCurrentProject(false);
  const before = ws.cachedIds().map(id => [id, serializeLevel(ws.entry(id)!.store.document)]), recipesBefore = useProjectLibrary.getState().generatedRecipes, depth = ws.history.undoDepth;
  await openLevel(late.id); await openLevel(mapId);
  expect(ws.entry(late.id)).toBeUndefined();
  api = createAgentApi(createEditorHost());
  async function call(name: ToolName, args: object) {
    const result = await api!.executeTool({ name, arguments: args, clientSessionId: "client", clientInfo: { name: "Smart", version: "1" }, bridgeEpoch: "epoch", deadline: Date.now() + 30000, signal: { aborted: false, throwIfAborted() {}, onAbort: () => () => {} } });
    expect(result.structuredContent, `${name}: ${JSON.stringify(result.structuredContent)}`).toMatchObject({ ok: true });
    if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
    return result.structuredContent;
  }
  const readContext = { worldSessionId: api.getState().worldSessionId! };
  const context = () => ({ ...readContext, transactionId: api!.getState().transaction!.id, expectedRevision: api!.getState().revision, idempotencyKey: crypto.randomUUID() });
  await call("begin_edit", { context: readContext, expectedRevision: api.getState().revision, idempotencyKey: "begin-smart", requestLabel: "Road", mapIds: [mapId] });
  const source = await call("prepare_smart_source", { context: context(), mapId, source: { stampId: stamp.id }, force: true });
  const sourceId = (source.data as { sourceId: string }).sourceId;
  await call("draw_path", { context: context(), mapId, layerId, sourceId, kind: "path", points: [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 8 }], width: 1 });
  const created=await call("create_map", {context:context(),name:"After smart",width:8,height:8,tileWidth:5,tileHeight:5});
  const createdId=(created.data as {map:{id:string}}).map.id;
  const generated = store.document.tilesets.find(ts => ts.generated)!;
  expect(generated).toBeDefined();
  expect(ws.entry(follower.id)!.store.document.getTileset(generated.id)).toEqual(generated);
  expect(ws.entry(createdId)!.store.document.getTileset(generated.id)).toEqual(generated);
  await call("finish_edit", { context: context() });
  await openLevel(late.id);
  expect(ws.entry(late.id)!.store.document.getTileset(generated.id)).toBeUndefined();
  await api.userAction(action);
  if (action === "approve") {
    expect(ws.history.undoDepth).toBe(depth + 1);
    ws.history.undo();
  }
  expect(before.map(([id]) => [id, serializeLevel(ws.entry(id as string)!.store.document)])).toEqual(before);
  if(action==="discard")expect(ws.level(createdId)).toBeUndefined();
  else expect(ws.entry(createdId)!.store.document.getTileset(generated.id)).toBeUndefined();
  expect(useProjectLibrary.getState().generatedRecipes).toEqual(recipesBefore);
  if (action === "approve") {
    ws.history.redo();
    expect(ws.entry(follower.id)!.store.document.getTileset(generated.id)).toEqual(generated);
    expect(ws.entry(late.id)!.store.document.getTileset(generated.id)).toEqual(generated);
    expect(store.document.layers[0]!.getCell(5, 3)).not.toBe(0);
  }
});
