/**
 * Navigation stays free while an AI draft waits (CLAUDE.md v2.0). Opening
 * another map re-cuts tileset atlases for the new store; that hint used to bump
 * the AI content revision and fire the external-change path, which sealed and
 * silently rolled back the draft (seen when the review bar's map list opened
 * a touched map).
 */
import { afterEach, expect, it, vi } from "vitest";
import { createAgentApi, type AgentApi, type AgentSignal, type ToolName } from "@smap/agent";
import { encodeRgbaPng } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { closeProject, getLevelWorkspace, newProject, openLevel, saveCurrentProject } from "../io/session";
import { MemoryFileSystem } from "../io/memoryFs";
import { setTilesetImage } from "../state/tilesetImages";
import { installSmartStamps } from "../commands/smartStampCommands";
import { createEditorHost } from "./editorHost";

const signal: AgentSignal = { aborted: false, throwIfAborted() {}, onAbort: () => () => {} };
let api: AgentApi | undefined;
afterEach(async () => { await api?.userAction("discard"); closeProject(); setPlatform(browserPlatform); });

it("opening a touched map during a pending AI edit keeps the draft and its revision", async () => {
  installSmartStamps();
  const fs = new MemoryFileSystem();
  setPlatform({ ...browserPlatform, watchProject() {} });
  await newProject({ name: "Köy", width: 8, height: 8, tileSize: 16, folder: { fs, label: "Köy", ref: "koy" } });
  const ws = getLevelWorkspace()!;
  ws.active.store.dispatch({ type: "addTileset", tileset: { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: 16, tileHeight: 16, columns: 1, rows: 1, margin: 0, spacing: 0 } });
  setTilesetImage({ tilesetId: "art", bytes: encodeRgbaPng(16, 16, new Uint8Array(1024).fill(255)), bitmap: { width: 16, height: 16, close: vi.fn() } as unknown as ImageBitmap });
  const zindan = ws.add({ name: "Zindan", width: 8, height: 8, tileSize: 16, layerName: "Zemin" });
  await saveCurrentProject(false);
  api = createAgentApi(createEditorHost());
  const call = async (name: ToolName, args: object) => (await api!.executeTool({ name, arguments: args, clientSessionId: "agent", clientInfo: { name: "Agent", version: "1" }, bridgeEpoch: "epoch", deadline: Date.now() + 30000, signal })).structuredContent;
  const context = () => ({ worldSessionId: api!.getState().worldSessionId!, transactionId: api!.getState().transaction!.id, expectedRevision: api!.getState().revision, idempotencyKey: crypto.randomUUID() });
  expect(await call("begin_edit", { context: { worldSessionId: api.getState().worldSessionId! }, expectedRevision: api.getState().revision, idempotencyKey: crypto.randomUUID(), requestLabel: "Zindan", mapIds: [ws.activeId, zindan.id] })).toMatchObject({ ok: true });
  const store = ws.entry(zindan.id)!.store, layerId = store.document.layers[0]!.id;
  const paint = (x: number) => call("paint_cells", { context: context(), mapId: zindan.id, layerId, cells: [{ x, y: 0, value: { tilesetId: "art", tileId: 0 } }] });
  expect(await paint(0)).toMatchObject({ ok: true });
  const revision = api.getState().revision;

  expect(await openLevel(zindan.id)).toBe(true);
  expect(api.getState().phase).toBe("running");
  expect(api.getState().revision).toBe(revision);
  expect(await paint(1)).toMatchObject({ ok: true });
  await api.userAction("approve");
  expect(store.document.layers[0]!.getCell(0, 0)).not.toBe(0);
  expect(store.document.layers[0]!.getCell(1, 0)).not.toBe(0);
});
