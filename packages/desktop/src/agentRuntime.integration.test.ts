import { afterEach, expect, it } from "vitest";
import type { BridgeControl, BridgeReply, BridgeRequest, AgentToolResult } from "../../agent/src/contracts";
import { encodeRgbaPng, serializeLevel } from "../../core/src";
import { browserPlatform, setPlatform } from "../../editor/src/platform";
import { closeProject, getLevelWorkspace, newProject } from "../../editor/src/io/session";
import { getAgentRuntime, installAgentRuntime } from "../../editor/src/agent/runtime";
import { useAgentUiState } from "../../editor/src/agent/agentUiState";
import { setTilesetImage } from "../../editor/src/state/tilesetImages";
import { agentTags } from "../../editor/src/agent/uiTags";
import { createAgentConnection, type AgentTransport } from "./agentBridge";

afterEach(async () => { await getAgentRuntime()?.dispose(); closeProject(); setPlatform(browserPlatform); });
async function setup() {
  setPlatform({ ...browserPlatform, watchProject() {}, onFileChanged: () => () => {} });
  await newProject({ name: "Native bridge", width: 8, height: 8, tileSize: 16 });
  const handlers = new Map<string, (value: unknown) => void>(), replies = new Map<string, BridgeReply>(), published: Record<string, unknown>[] = [];
  let epoch = "", sequence = 0;
  const transport: AgentTransport = {
    async listen(event, handler) { handlers.set(event, handler); return () => { handlers.delete(event); }; },
    async invoke<T>(command: string, args: Record<string, unknown> = {}) {
      if (command === "ai_get_status") return { snapshot: { revision: 0, settings: { enabled: true, port: 48765 } }, status: { state: "listening", port: 48765, clients: [] } } as T;
      if (command === "agent_ready") {
        epoch = args.epoch as string;
        // Native may send requests immediately after ready; API listeners must already exist.
        handlers.get("smap://agent-request")!({ type: "tools/call", requestId: "ready-probe", bridgeEpoch: epoch, clientSessionId: "probe", clientInfo: { name: "Probe", version: "1" }, deadline: Date.now() + 30000, name: "get_session", arguments: {} });
      }
      if (command === "agent_reply") { const reply = args.reply as BridgeReply; replies.set(reply.requestId, reply); }
      if (command === "agent_publish_status") published.push(args.status as Record<string, unknown>);
      return undefined as T;
    },
    async copy() {},
  };
  const runtime = await installAgentRuntime({ connection: createAgentConnection(transport) });
  async function call(name: BridgeRequest["name"], args: object = {}, owner = "client"): Promise<AgentToolResult> {
    const requestId = `request-${++sequence}`;
    handlers.get("smap://agent-request")!({ type: "tools/call", requestId, bridgeEpoch: epoch, clientSessionId: owner, clientInfo: { name: "Claude", version: "1" }, deadline: Date.now() + 30000, name, arguments: args });
    await expect.poll(() => replies.has(requestId)).toBe(true);
    const reply = replies.get(requestId)!;
    if (reply.type !== "result") throw new Error(JSON.stringify(reply));
    return reply.result;
  }
  function control(value: (BridgeControl extends infer C ? C extends BridgeControl ? Omit<C, "bridgeEpoch"> : never : never)) { handlers.get("smap://agent-control")!({ ...value, bridgeEpoch: epoch }); }
  const context = () => ({ worldSessionId: runtime.api.getState().worldSessionId! });
  const editContext = () => ({ ...context(), transactionId: runtime.api.getState().transaction!.id, idempotencyKey: crypto.randomUUID(), expectedRevision: runtime.api.getState().revision });
  return { runtime, call, control, replies, published, context, editContext, handlers };
}

it("native invoke/listen runs the real API, replies with images, echoes status request ids and binds UI state", async () => {
  const h = await setup();
  await expect.poll(() => h.replies.has("ready-probe")).toBe(true);
  const image = await h.call("render_preview", { context: h.context(), mapId: getLevelWorkspace()!.activeId, grid: true, coordinates: true });
  expect(image.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image", mimeType: "image/png", data: expect.any(String) })]));
  h.control({ type: "statusRequest", requestId: "native-status-probe" });
  expect(h.published.at(-1)).toMatchObject({ requestId: "native-status-probe", bridgeEpoch: h.runtime.bridgeEpoch, state: { phase: "ready" } });
  expect(useAgentUiState.getState().connectionStatus.state).toBe("listening");
});

for (const phase of ["running", "stopped", "awaitingApproval"] as const) it(`native sessionEnded never rolls back: ${phase} work stays for review`, async () => {
  const h = await setup(), ws = getLevelWorkspace()!, store = ws.active.store, before = serializeLevel(store.document);
  const begun = await h.call("begin_edit", { context: h.context(), idempotencyKey: "begin-edit", expectedRevision: h.runtime.api.getState().revision, requestLabel: "Native edit", mapIds: [ws.activeId] });
  expect(begun.structuredContent.ok).toBe(true);
  await h.call("edit_layer", { context: h.editContext(), mapId: ws.activeId, action: "update", layerId: store.document.layers[0]!.id, props: { name: "Tentative" } });
  expect(serializeLevel(store.document)).not.toBe(before);
  if (phase === "stopped") await useAgentUiState.getState().stop();
  if (phase === "awaitingApproval") expect((await h.call("finish_edit", { context: h.editContext() })).structuredContent.ok).toBe(true);
  h.control({ type: "sessionEnded", clientSessionId: "observer", reason: "delete" });
  expect(h.runtime.api.getState().phase).toBe(phase);
  h.control({ type: "sessionEnded", clientSessionId: "client", reason: "delete" });
  const sealed = phase === "running" ? "orphaned" : phase;
  await expect.poll(() => h.runtime.api.getState().transaction!.owner.clientSessionId).toBeNull();
  expect(useAgentUiState.getState().phase).toBe(sealed);
  expect(serializeLevel(store.document)).not.toBe(before);
  const session = (await h.call("get_session", {}, "new-client")).structuredContent;
  expect(session).toMatchObject({ ok: true, data: { transaction: { state: sealed, owner: { clientSessionId: null, clientInfo: { name: "Claude" } } } } });
  await useAgentUiState.getState().discard();
  await expect.poll(() => h.runtime.api.getState().phase).toBe("ready");
  expect(serializeLevel(store.document)).toBe(before);
  expect(store.inTransaction).toBe(false);
});

it("native cancel aborts an in-flight request and suppresses its late reply", async () => {
  const h = await setup();
  let release!: () => void;
  const original = h.runtime.host.images.renderPreview;
  h.runtime.host.images.renderPreview = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
  h.handlers.get("smap://agent-request")!({ type: "tools/call", requestId: "cancel-preview", bridgeEpoch: h.runtime.bridgeEpoch, clientSessionId: "client", clientInfo: { name: "Claude", version: "1" }, deadline: Date.now() + 30000, name: "render_preview", arguments: { context: h.context(), mapId: getLevelWorkspace()!.activeId } });
  await expect.poll(() => typeof release).toBe("function");
  h.control({ type: "cancel", clientSessionId: "client", requestId: "cancel-preview", reason: "clientCancelled" });
  release();
  await h.call("get_session");
  expect(h.replies.has("cancel-preview")).toBe(false);
});

it("Inspector tags use live fingerprints and the API write path, survive map discard, and reject stale pixels", async () => {
  const h = await setup(), ws = getLevelWorkspace()!, store = ws.active.store;
  store.dispatch({ type: "addTileset", tileset: { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: 16, tileHeight: 16, columns: 1, rows: 1, margin: 0, spacing: 0 } });
  const source = (shade: number) => setTilesetImage({ tilesetId: "art", bytes: encodeRgbaPng(16, 16, new Uint8Array(16 * 16 * 4).fill(shade)), bitmap: { width: 16, height: 16, close() {} } as ImageBitmap });
  source(255);
  const target = { kind: "tile" as const, tilesetId: "art", tileId: 0 }, missing = await agentTags.read(target);
  expect(missing.status).toBe("missing");
  await h.call("begin_edit", { context: h.context(), idempotencyKey: "begin-tags", expectedRevision: h.runtime.api.getState().revision, requestLabel: "Pending", mapIds: [ws.activeId] });
  await agentTags.write({ target, expectedFingerprint: missing.currentFingerprint!, tags: ["grass"] });
  await useAgentUiState.getState().discard();
  expect(await agentTags.read(target)).toMatchObject({ status: "current", tags: ["grass"] });
  expect((await agentTags.list({ kind: "tiles", status: "all" })).items).toEqual(expect.arrayContaining([expect.objectContaining({ target, tags: ["grass"] })]));
  source(128);
  expect((await agentTags.read(target)).status).toBe("stale");
  await expect(agentTags.write({ target, expectedFingerprint: missing.currentFingerprint!, tags: ["changed"] })).rejects.toMatchObject({ code: "TAG_FINGERPRINT_CHANGED" });
  expect((await agentTags.read(target)).tags).toEqual(["grass"]);
});
