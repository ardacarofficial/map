/**
 * T-06 guard: whatever an agent and the user do (create maps, paint, add
 * layers, rename, finish, approve, discard, stop, lose the session, navigate,
 * undo, autosave or save), a committed project.smap only lists map files that
 * exist and every save succeeds. Deterministic seeded walks over the live
 * editor host, session and autosave scheduler.
 */
import { afterEach, expect, it, vi } from "vitest";
import { createAgentApi, type AgentApi, type AgentSignal, type ToolName } from "@smap/agent";
import { parseProject } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { closeProject, getLevelWorkspace, installSession, newProject, openLevel, saveCurrentProject, waitForWrites } from "../io/session";
import { MemoryFileSystem } from "../io/memoryFs";
import { loadProject } from "../io/projectIo";
import { createEditorHost } from "./editorHost";

const signal: AgentSignal = { aborted: false, throwIfAborted() {}, onAbort: () => () => {} };
const decode = async () => ({ width: 1, height: 1, close() {} }) as unknown as ImageBitmap;
let api: AgentApi | undefined, uninstall = () => {};
afterEach(async () => { await api?.userAction("discard"); uninstall(); uninstall = () => {}; closeProject(); vi.useRealTimers(); vi.unstubAllGlobals(); setPlatform(browserPlatform); });

type Action = "begin" | "create" | "paint" | "layer" | "rename" | "finish" | "approve" | "discard" | "stop" | "end" | "save" | "tick" | "open" | "undo" | "redo";
const ACTIONS: Record<string, readonly Action[]> = {
  ready: ["begin", "begin", "begin", "save", "tick", "tick", "open", "undo", "redo"],
  running: ["create", "create", "paint", "paint", "layer", "rename", "finish", "finish", "stop", "end", "discard", "open", "tick"],
  awaitingApproval: ["approve", "approve", "discard", "discard", "end", "save", "open", "tick"],
  stopped: ["approve", "discard", "end"],
};

async function missingFiles(fs: MemoryFileSystem): Promise<string[]> {
  return parseProject(await fs.readText("project.smap")).levels.map(level => level.path).filter(path => !fs.files.has(path));
}

for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) it(`agent/user walk ${seed} keeps project.smap and map files consistent`, async () => {
  let state = seed;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const fs = new MemoryFileSystem();
  setPlatform({ ...browserPlatform, watchProject() {} });
  await newProject({ name: "Köy", width: 8, height: 8, tileSize: 16, folder: { fs, label: "Köy", ref: "koy" } });
  expect(await saveCurrentProject(false)).toBe(true);
  vi.useFakeTimers(); vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  uninstall = installSession();
  api = createAgentApi(createEditorHost());
  let client = "agent", names = 0;
  const log: string[] = [];
  const world = () => ({ worldSessionId: api!.getState().worldSessionId! });
  const edit = () => ({ ...world(), transactionId: api!.getState().transaction?.id ?? "none", expectedRevision: api!.getState().revision, idempotencyKey: crypto.randomUUID() });
  const call = async (name: ToolName, args: object) => (await api!.executeTool({ name, arguments: args, clientSessionId: client, clientInfo: { name: "Agent", version: "1" }, bridgeEpoch: "epoch", deadline: Date.now() + 30000, signal })).structuredContent;
  for (let step = 0; step < 80; step++) {
    const ws = getLevelWorkspace()!, phase = api.getState().phase, maps = ws.levels.map(level => level.id);
    const targets = api.getState().transaction?.affectedMapIds ?? [];
    const action = pick(ACTIONS[phase] ?? ["approve", "discard"]);
    let outcome: unknown = "";
    if (action === "begin") outcome = (await call("begin_edit", { context: world(), expectedRevision: api.getState().revision, idempotencyKey: crypto.randomUUID(), requestLabel: "walk", mapIds: maps.filter(() => random() < 0.6).concat(maps[0]!) })).ok;
    else if (action === "create") outcome = (await call("create_map", { context: edit(), name: pick(["Zindan", "Kule", `Harita ${names++}`]), width: 6, height: 6, tileWidth: 16, tileHeight: 16 })).ok;
    else if ((action === "paint" || action === "layer" || action === "rename") && targets.length) {
      const mapId = pick(targets), layerId = ws.entry(mapId)?.store.document.layers[0]?.id;
      if (action === "rename") outcome = (await call("edit_map", { context: edit(), mapId, name: `Ad ${step}` })).ok;
      else if (action === "layer") outcome = (await call("edit_layer", { context: edit(), mapId, action: "create", name: "Nesneler", kind: "entity" })).ok;
      else if (layerId) outcome = (await call("paint_cells", { context: edit(), mapId, layerId, cells: [{ x: Math.floor(random() * 6), y: 0, value: null }] })).ok;
    }
    else if (action === "finish") outcome = (await call("finish_edit", { context: edit(), summary: "walk" })).ok;
    else if (action === "approve" || action === "discard" || action === "stop") await api.userAction(action);
    else if (action === "end") { await api.sessionEnded(client); client = `agent-${step}`; }
    else if (action === "save") { await waitForWrites(); outcome = await saveCurrentProject(false); }
    else if (action === "tick") await vi.advanceTimersByTimeAsync(2500);
    else if (action === "open") outcome = await openLevel(pick(maps));
    else if (action === "undo") ws.history.undo();
    else if (action === "redo") ws.history.redo();
    await waitForWrites();
    log.push(`${step} ${phase} ${action} → ${String(outcome)}`);
    const missing = await missingFiles(fs);
    if (missing.length || (action === "save" && phase === "ready" && outcome === false)) throw new Error(`step ${step}: missing ${missing.join(", ")}\n${log.join("\n")}`);
  }
  await api.userAction("discard");
  await waitForWrites();
  expect(await saveCurrentProject(false)).toBe(true);
  expect(await missingFiles(fs)).toEqual([]);
  for (const level of parseProject(await fs.readText("project.smap")).levels) await expect(loadProject(fs, decode, { levelId: level.id })).resolves.toMatchObject({ levelPath: level.path });
});
