import { afterEach, expect, it } from "vitest";
import { createAgentApi, type AgentApi, type ToolName } from "@smap/agent";
import { serializeLevel } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { closeProject, getLevelWorkspace, newProject } from "../io/session";
import { useProjectLibrary } from "../io/projectLibrary";
import { t } from "../i18n";
import { registerDockCommands } from "../ui/layout/dockCommands";
import { getCommand } from "../commands/registry";
import { createEditorHost } from "./editorHost";

let api: AgentApi | undefined;
afterEach(async () => { await api?.userAction("discard"); closeProject(); setPlatform(browserPlatform); });

for (const outcome of ["approve", "discard"] as const) it(`real API + live host ${outcome}: multi-map paint/stamp/create forms one atomic action`, async () => {
  setPlatform({ ...browserPlatform, watchProject() {} });
  await newProject({ name: "Integration", width: 16, height: 16, tileSize: 16 });
  const ws = getLevelWorkspace()!, store = ws.active.store, mapId = ws.activeId, layerId = store.document.layers[0]!.id;
  store.dispatch({ type: "addTileset", tileset: { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: 16, tileHeight: 16, columns: 8, rows: 8, margin: 0, spacing: 0 } });
  useProjectLibrary.getState().addStamp({ id: "house", name: "House", width: 2, height: 1, palette: [{ tilesetId: "art", tileId: 3 }], layers: [{ layerId: "source", name: store.document.layers[0]!.name, cells: Uint32Array.of(1, 1) }] });
  const other = ws.add({ name: "Follower", width: 4, height: 4, tileSize: 16, layerName: "Ground" });
  const before = serializeLevel(store.document), followerBefore = serializeLevel(ws.entry(other.id)!.store.document), depth = ws.history.undoDepth, maps = ws.levels.map(m => m.id);
  api = createAgentApi(createEditorHost());
  let key = 0;
  async function call(name: ToolName, args: object = {}) {
    const result = await api!.executeTool({ name, arguments: args, clientSessionId: "client", clientInfo: { name: "Integration", version: "1" }, bridgeEpoch: "epoch", deadline: Date.now() + 30000, signal: { aborted: false, throwIfAborted() {}, onAbort: () => () => {} } });
    expect(result.structuredContent, `${name}: ${JSON.stringify(result.structuredContent)}`).toMatchObject({ ok: true });
    if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
    return result.structuredContent;
  }
  const context = () => ({ worldSessionId: api!.getState().worldSessionId! });
  const edit = (name: ToolName, args: object = {}) => call(name, { context: { ...context(), transactionId: api!.getState().transaction!.id, expectedRevision: api!.getState().revision, idempotencyKey: `edit-call-${++key}` }, ...args });
  await call("begin_edit", { context: context(), expectedRevision: api.getState().revision, idempotencyKey: "begin-edit", requestLabel: "Village", mapIds: [mapId] });
  registerDockCommands();
  expect(getCommand("panel.aiActivity.right")!.enabled!()).toBe(true);
  await edit("paint_rect", { mapId, layerId, region: { x: 0, y: 0, width: 3, height: 3 }, value: { tilesetId: "art", tileId: 0 } });
  await edit("paint_cells", { mapId, layerId, cells: [{ x: 3, y: 3, value: { tilesetId: "art", tileId: 1, flags: 5 } }] });
  await edit("place_stamp", { mapId, stampId: "house", at: { x: 5, y: 5 } });
  const created = await edit("create_map", { name: "New map", width: 8, height: 8, tileWidth: 16, tileHeight: 16 });
  const data = created.data as { map: { id: string }; layers: { id: string; name: string }[] };
  expect(data.layers.map(l => l.name)).toEqual([t("layers.defaultName")]);
  await edit("paint_cells", { mapId: data.map.id, layerId: data.layers[0]!.id, cells: [{ x: 1, y: 1, value: { tilesetId: "art", tileId: 2 } }] });
  await edit("finish_edit");
  expect(ws.history.undoDepth).toBe(depth);
  const after = serializeLevel(store.document);
  await api.userAction(outcome);
  expect(ws.entry(other.id)!.store.inTransaction).toBe(false);
  expect(serializeLevel(ws.entry(other.id)!.store.document)).toBe(followerBefore);
  if (outcome === "discard") {
    expect(serializeLevel(store.document)).toBe(before);
    expect(ws.levels.map(m => m.id)).toEqual(maps);
    expect(ws.history.undoDepth).toBe(depth);
  } else {
    expect(ws.history.undoDepth).toBe(depth + 1);
    ws.history.undo();
    expect(serializeLevel(store.document)).toBe(before);
    expect(ws.level(data.map.id)).toBeDefined();
    expect(ws.entry(data.map.id)!.store.document.layers).toHaveLength(0);
    ws.history.redo();
    expect(serializeLevel(store.document)).toBe(after);
    expect(ws.entry(data.map.id)!.store.document.layers[0]!.getCell(1, 1)).not.toBe(0);
  }
});
