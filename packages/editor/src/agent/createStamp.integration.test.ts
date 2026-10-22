import { afterEach, expect, it } from "vitest";
import { createAgentApi, type AgentApi, type ToolName } from "@smap/agent";
import { parseStamp, serializeLevel } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { MemoryFileSystem } from "../io/memoryFs";
import { closeProject, getLevelWorkspace, newProject, reloadFromDisk, saveCurrentProject } from "../io/session";
import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { createEditorHost } from "./editorHost";

let api: AgentApi | undefined;
afterEach(async () => { await api?.userAction("discard"); closeProject(); setPlatform(browserPlatform); });

async function setup() {
  const fs = new MemoryFileSystem();
  setPlatform({ ...browserPlatform, watchProject() {} });
  await newProject({ name: "Capture", width: 8, height: 8, tileSize: 16, folder: { fs, label: "Capture", ref: "capture" } });
  const ws = getLevelWorkspace()!, store = ws.active.store, mapId = ws.activeId;
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
  expect(await saveCurrentProject(false)).toBe(true);
  api = createAgentApi(createEditorHost());
  let key = 0;
  const context = () => ({ worldSessionId: api!.getState().worldSessionId! });
  async function call(name: ToolName, args: object = {}) {
    const result = await api!.executeTool({ name, arguments: args, clientSessionId: "client", clientInfo: { name: "Capture test", version: "1" },
      bridgeEpoch: "epoch", deadline: Date.now() + 30000, signal: { aborted: false, throwIfAborted() {}, onAbort: () => () => {} } });
    expect(result.structuredContent, `${name}: ${JSON.stringify(result.structuredContent)}`).toMatchObject({ ok: true });
    if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
    return result.structuredContent;
  }
  const edit = (name: ToolName, args: object = {}) => call(name, { context: { ...context(), transactionId: api!.getState().transaction!.id,
    expectedRevision: api!.getState().revision, idempotencyKey: `edit-call-${++key}` }, ...args });
  const begin = () => call("begin_edit", { context: context(), expectedRevision: api!.getState().revision, idempotencyKey: `begin-edit-${++key}`,
    requestLabel: "Capture collision", mapIds: [mapId] });
  const capture = () => edit("create_stamp", { name: "Collision", category: "Blockers", tags: ["wall"],
    source: { mapId, region: { x: 1, y: 1, width: 2, height: 1 }, layerIds: [layerId] } });
  const paint = () => edit("paint_cells", { mapId, layerId, cells: [{ x: 1, y: 1, value: { collision: 2 } }] });
  return { fs, ws, store, mapId, layerId, context, call, edit, begin, capture, paint };
}

it("live capture rollback restores library, map, dirty state and disk bytes", async () => {
  const h = await setup(), beforeText = serializeLevel(h.store.document), beforeRevision = useProjectLibrary.getState().revision,
    beforeDirty = useEditorStore.getState().dirty, beforeDisk = [...h.fs.files], depth = h.ws.history.undoDepth;
  await h.begin(); await h.paint(); await h.capture(); await h.edit("finish_edit");
  expect(useProjectLibrary.getState().stamps).toHaveLength(1);
  expect(await saveCurrentProject(false)).toBe(false);
  expect([...h.fs.files]).toEqual(beforeDisk);
  await api!.userAction("discard");
  expect(useProjectLibrary.getState().stamps).toEqual([]);
  expect(useProjectLibrary.getState().revision).toBe(beforeRevision);
  expect(useEditorStore.getState().dirty).toBe(beforeDirty);
  expect(serializeLevel(h.store.document)).toBe(beforeText);
  expect(h.ws.history.undoDepth).toBe(depth);
  expect([...h.fs.files]).toEqual(beforeDisk);
});

it("live capture approval persists only after review and shares map undo, redo and reopen", async () => {
  const h = await setup(), depth = h.ws.history.undoDepth, beforeText = serializeLevel(h.store.document);
  await h.begin(); await h.paint(); await h.capture(); await h.edit("finish_edit");
  expect(await h.fs.list("stamps")).toEqual([]);
  expect(h.ws.history.undoDepth).toBe(depth);
  await api!.sessionEnded("client");
  expect(api!.getState().phase).toBe("awaitingApproval");
  await api!.userAction("approve");
  expect(h.ws.history.undoDepth).toBe(depth + 1);
  expect(useEditorStore.getState().dirty).toBe(true);
  const afterText = serializeLevel(h.store.document);
  expect(await saveCurrentProject(false)).toBe(true);
  expect(parseStamp(await h.fs.readText("stamps/collision.json"))).toMatchObject({ id: "collision", category: "Blockers", tags: ["wall"] });
  h.ws.history.undo();
  expect(serializeLevel(h.store.document)).toBe(beforeText);
  expect(useProjectLibrary.getState().stamps).toEqual([]);
  expect(await saveCurrentProject(false)).toBe(true);
  expect(await h.fs.list("stamps")).toEqual([]);
  h.ws.history.redo();
  expect(serializeLevel(h.store.document)).toBe(afterText);
  expect(await saveCurrentProject(false)).toBe(true);
  await reloadFromDisk();
  expect(useProjectLibrary.getState().stamps).toHaveLength(1);
  expect(useProjectLibrary.getState().stamps[0]).toMatchObject({ id: "collision", layers: [{ grid: true, role: "collision" }] });
  expect(getLevelWorkspace()!.active.store.document.getLayer(h.layerId)!.getCell(1, 1)).toBe(2);
});

it("capture reserves names belonging to unreadable stamp files", async () => {
  const h = await setup();
  await h.fs.writeText("stamps/collision.json", "unreadable stamp bytes");
  useProjectLibrary.setState({ brokenStampFiles: ["stamps/collision.json"] });
  await h.begin(); await h.paint();
  expect(await h.capture()).toMatchObject({ data: { stampId: "collision-2" } });
  await h.edit("finish_edit"); await api!.userAction("approve");
  expect(await saveCurrentProject(false)).toBe(true);
  expect(await h.fs.readText("stamps/collision.json")).toBe("unreadable stamp bytes");
  expect(await h.fs.list("stamps")).toEqual(["collision-2.json", "collision.json"]);
});

it("undo/redo replays only the created stamp and retains later manual library work", async () => {
  const h = await setup();
  const original = { id: "original", name: "Original", width: 1, height: 1, palette: [],
    layers: [{ layerId: "collision", name: "Collision", grid: true, role: "collision" as const, cells: Uint32Array.of(1) }] };
  useProjectLibrary.getState().addStamp(original);
  await h.begin(); await h.paint(); await h.capture();
  await h.edit("finish_edit"); await api!.userAction("approve");
  useProjectLibrary.getState().renameStamp("original", "Renamed original");
  useProjectLibrary.getState().renameStamp("collision", "Renamed AI");
  useProjectLibrary.getState().addStamp({ ...original, id: "manual", name: "Manual creation" });
  const independent = useProjectLibrary.getState().stamps.filter(stamp => stamp.id !== "collision");
  h.ws.history.undo();
  expect(useProjectLibrary.getState().stamps).toEqual(independent);
  expect(await saveCurrentProject(false)).toBe(true);
  expect(await h.fs.list("stamps")).toEqual(["manual.json", "original.json"]);
  h.ws.history.redo();
  expect(useProjectLibrary.getState().stamps.filter(stamp => stamp.id !== "collision")).toEqual(independent);
  expect(useProjectLibrary.getState().stamps.find(stamp => stamp.id === "collision")!.name).toBe("Collision");
  expect(await saveCurrentProject(false)).toBe(true);
  expect(await h.fs.list("stamps")).toEqual(["collision.json", "manual.json", "original.json"]);
});
