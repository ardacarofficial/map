import { afterEach, expect, it } from "vitest";
import { encodeRgbaPng, serializeLevel } from "@smap/core";
import type { AgentConnection, AgentConnectionStatus, AgentToolResult, BridgeControl, BridgeReply, BridgeRequest } from "@smap/agent";
import { browserPlatform, setPlatform } from "../platform";
import { MemoryFileSystem } from "../io/memoryFs";
import { closeProject, getLevelWorkspace, newProject, saveCurrentProject } from "../io/session";
import { loadProject } from "../io/projectIo";
import { setTilesetImage } from "../state/tilesetImages";
import { getAgentRuntime, installAgentRuntime } from "./runtime";
import { editGate } from "./editGate";

afterEach(async () => { await getAgentRuntime()?.dispose(); closeProject(); setPlatform(browserPlatform); });

async function setup() {
  const fs = new MemoryFileSystem();
  setPlatform({ ...browserPlatform, watchProject() {}, onFileChanged: () => () => {} });
  await newProject({ name: "Collaborative runtime", width: 8, height: 8, tileSize: 4, folder: { fs, ref: "collaborative", label: "Collaborative" } });
  const ws = getLevelWorkspace()!, store = ws.active.store, mapId = ws.activeId, layerId = store.document.layers[0]!.id;
  store.dispatch({ type: "addTileset", tileset: { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: 4, tileHeight: 4,
    columns: 2, rows: 1, margin: 0, spacing: 0 } });
  const bitmap = () => ({ width: 8, height: 4, close() {} }) as ImageBitmap;
  setTilesetImage({ tilesetId: "art", bytes: encodeRgbaPng(8, 4, new Uint8Array(8 * 4 * 4).fill(255)), bitmap: bitmap() });
  expect(await saveCurrentProject(false)).toBe(true);
  store.clearHistory();
  const requests = new Set<(request: BridgeRequest) => void>(), controls = new Set<(control: BridgeControl) => void>();
  const statuses = new Set<(status: AgentConnectionStatus) => void>();
  const replies = new Map<string, BridgeReply>();
  let status: AgentConnectionStatus = { state: "listening", port: 48765, clients: [] };
  const connection: AgentConnection = {
    onRequest(handler) { requests.add(handler); return () => { requests.delete(handler); }; },
    onControl(handler) { controls.add(handler); return () => { controls.delete(handler); }; },
    async reply(reply) { replies.set(reply.requestId, reply); },
    async publishStatus() {}, async ready() {},
    async getSettings() { return { revision: 0, settings: { enabled: true, port: 48765 } }; },
    async setSettings(settings) { return { ok: true, snapshot: { revision: 1, settings }, status }; },
    async revealToken() { return "token"; }, async copyToken() {},
    async regenerateToken() { return { revision: 1, settings: { enabled: true, port: 48765 } }; },
    get status() { return status; },
    subscribeStatus(handler) { statuses.add(handler); return () => { statuses.delete(handler); }; },
  };
  const runtime = await installAgentRuntime({ connection });
  const revisions = new Map<string, number>();
  let next = 0;
  const context = () => ({ worldSessionId: runtime.api.getState().worldSessionId! });
  function dispatch(client: string, name: string, args: Record<string, unknown>) {
    const requestId = `collaborative-request-${++next}`;
    const request: BridgeRequest = { type: "tools/call", requestId, bridgeEpoch: runtime.bridgeEpoch, clientSessionId: client,
      clientInfo: { name: client, version: "1" }, name, deadline: Date.now() + 30000, arguments: args as BridgeRequest["arguments"] };
    for (const handler of requests) handler(request);
    return requestId;
  }
  async function call(client: string, name: string, args: Record<string, unknown>): Promise<AgentToolResult> {
    const requestId = dispatch(client, name, args);
    await expect.poll(() => replies.has(requestId)).toBe(true);
    const reply = replies.get(requestId)!;
    expect(reply.type, JSON.stringify(reply)).toBe("result");
    if (reply.type !== "result") throw new Error(JSON.stringify(reply));
    return reply.result;
  }
  async function ok(client: string, name: string, args: Record<string, unknown>) {
    const result = (await call(client, name, args)).structuredContent;
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const memberRevision = (result as unknown as { memberRevision?: number }).memberRevision;
    if (memberRevision !== undefined) revisions.set(client, memberRevision);
    return result;
  }
  const writeContext = (client: string) => ({ ...context(), transactionId: runtime.api.getState().transaction!.id,
    expectedMemberRevision: revisions.get(client)!, idempotencyKey: `collab-write-${++next}` });
  const claim = (x: number) => ({ mapId, layerIds: [layerId], region: { x, y: 0, width: 4, height: 8 } });
  await ok("A", "begin_edit", { context: context(), mapIds: [mapId], requestLabel: "Live team", expectedRevision: runtime.api.getState().revision,
    idempotencyKey: "begin-team", collaboration: { mode: "regions", claims: [claim(0)] } });
  await ok("B", "join_edit", { context: context(), transactionId: runtime.api.getState().transaction!.id,
    expectedRevision: runtime.api.getState().revision, idempotencyKey: "join-team", claims: [claim(4)] });
  const paint = (client: string, x: number, tileId = 0) => ok(client, "paint_cells", { context: writeContext(client), mapId, layerId,
    cells: [{ x, y: 1, value: { tilesetId: "art", tileId } }] });
  const end = (client: string) => { for (const handler of controls) handler({ type: "sessionEnded", bridgeEpoch: runtime.bridgeEpoch,
    clientSessionId: client, reason: "disconnect" }); };
  return { fs, ws, store, mapId, layerId, runtime, call, dispatch, replies, ok, writeContext, context, paint, end, bitmap,
    disable() { status = { state: "disabled", port: 48765, clients: [] }; for (const handler of statuses) handler(status); },
    cell: (x: number) => store.document.getLayer(layerId)!.getCell(x, 1),
  };
}

it("live runtime publishes both active writers, preserves peers on disconnect and saves one approved undo group", async () => {
  const h = await setup(), baseline = serializeLevel(h.store.document);
  await h.paint("A", 1); await h.paint("B", 5, 1);
  const session = await h.ok("A", "get_session", {});
  expect(session.data).toMatchObject({ clients: expect.arrayContaining([
    expect.objectContaining({ name: "A", isWriter: true }), expect.objectContaining({ name: "B", isWriter: true }),
  ]) });
  const originalDisk = await h.fs.readText("levels/main.json");
  expect(await saveCurrentProject(false)).toBe(false);
  expect(await h.fs.readText("levels/main.json")).toBe(originalDisk);
  h.end("B"); await expect.poll(() => h.cell(5)).toBe(0);
  expect(h.cell(1)).not.toBe(0); expect(editGate.blocked).toBe(true);
  await h.paint("A", 2, 1);
  await h.ok("A", "finish_edit", { context: h.writeContext("A"), summary: "West done" });
  await h.runtime.api.userAction("approve");
  const approved = serializeLevel(h.store.document);
  expect(h.ws.history.undoDepth).toBe(1);
  expect(await saveCurrentProject(false)).toBe(true);
  expect(serializeLevel((await loadProject(h.fs, async () => h.bitmap())).document)).toBe(approved);
  h.ws.history.undo(); expect(serializeLevel(h.store.document)).toBe(baseline);
  h.ws.history.redo(); expect(serializeLevel(h.store.document)).toBe(approved);
});

it("disabling the transport ends every running member without discarding a submitted peer region", async () => {
  const h = await setup();
  await h.paint("A", 1); await h.paint("B", 5, 1);
  await h.ok("B", "finish_edit", { context: h.writeContext("B"), summary: "East submitted" });
  const submitted = h.cell(5);
  h.disable();
  await expect.poll(() => h.cell(1)).toBe(0);
  expect(h.cell(5)).toBe(submitted); expect(editGate.blocked).toBe(true);
  await h.runtime.api.userAction("approve");
  expect(h.cell(5)).toBe(submitted); expect(h.cell(1)).toBe(0);
  expect(editGate.blocked).toBe(false);
});

it("human stop cancels queued bridge requests for every member and suppresses late loader results", async () => {
  const h = await setup(); await h.paint("A", 1); await h.paint("B", 5, 1);
  let release: (() => void) | undefined;
  const original = h.runtime.host.loadMap;
  h.runtime.host.loadMap = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
  const read = h.dispatch("B", "get_map_info", { context: h.context(), mapId: h.mapId });
  await expect.poll(() => typeof release).toBe("function");
  const write = (client: string, x: number) => h.dispatch(client, "paint_cells", { context: h.writeContext(client), mapId: h.mapId,
    layerId: h.layerId, cells: [{ x, y: 1, value: { tilesetId: "art", tileId: 0 } }] });
  const a = write("A", 2), b = write("B", 6);
  try {
    await h.runtime.api.userAction("stop");
    for (const id of [read, a, b]) expect(h.replies.get(id)).toMatchObject({ type: "failure", error: { code: "CANCELLED" } });
    expect(h.cell(1)).not.toBe(0); expect(h.cell(5)).not.toBe(0);
    expect(h.cell(2)).toBe(0); expect(h.cell(6)).toBe(0);
  } finally { release?.(); }
});
