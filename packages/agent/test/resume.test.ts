import { expect, it } from "vitest";
import { serializeLevel } from "@smap/core";
import { error, harness, success, tile } from "./helpers";
import { CallSignal } from "../src/transactions";
import { memoryCall } from "../src/testing/memoryHost";
import type { ToolData } from "../src/contracts";

const cell = (x: number, y = 0) => ({ mapId: "map-1", layerId: "ground", cells: [{ x, y, value: tile }] });
async function flush() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}
function as(h: ReturnType<typeof harness>, clientSessionId: string) {
  return (name: string, args: unknown = {}) => h.api.executeTool(memoryCall(name, args, { clientSessionId, bridgeEpoch: `epoch-${clientSessionId}` }));
}

it("C2: an ordinary edit needs no context, revision or idempotency key", async () => {
  const h = harness(), before = serializeLevel(h.host.stores.get("map-1")!.document);
  const begun = success(await h.run("begin_edit", { requestLabel: "Village", mapIds: ["map-1"] })).data as ToolData["begin_edit"];
  expect(begun.resumeToken).toMatch(/^[a-f0-9]{64}$/);
  expect(begun.budget).toEqual({ cellsLeft: 1048576, msLeft: 30 * 60 * 1000 });
  success(await h.run("get_map_info", { mapId: "map-1" }));
  success(await h.run("paint_cells", cell(1)));
  // Stale explicit revisions are still strict, retryable and actionable.
  const stale = await h.run("paint_cells", { context: { expectedRevision: 0 }, ...cell(2) });
  error(stale, "REVISION_CONFLICT");
  expect(stale.structuredContent).toMatchObject({ retryable: true, details: { currentRevision: h.api.getState().revision, nextAction: expect.any(String) } });
  success(await h.run("paint_cells", cell(2)));
  const finished = success(await h.run("finish_edit", { summary: "Done" }));
  expect(finished.data).toMatchObject({ state: "awaitingApproval" });
  await h.api.userAction("approve");
  expect(h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(2, 0)).not.toBe(0);
  h.host.history.undo();
  expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(before);
  // After the human decided, a context-free write explains what happened.
  const after = await h.run("paint_cells", cell(3));
  error(after, "TRANSACTION_REQUIRED");
  expect(after.structuredContent).toMatchObject({ details: { state: "approved", cause: "humanApproved", nextAction: expect.stringContaining("begin_edit") } });
});

it("C2: idempotency keys stay optional; a supplied key replays and an omitted one is not cached", async () => {
  const h = harness();
  await h.run("begin_edit", { requestLabel: "Keys", mapIds: ["map-1"] });
  const keyed = { context: { idempotencyKey: "paint-key-1" }, ...cell(4) };
  const first = success(await h.run("paint_cells", keyed));
  const replay = success(await h.run("paint_cells", keyed));
  expect(replay).toMatchObject({ replayed: true });
  expect(h.api.getState().transaction!.counters.mutationCalls).toBe(1);
  expect(first.revision).toBe(replay.revision);
  success(await h.run("paint_cells", cell(5)));
  success(await h.run("paint_cells", cell(5)));
  expect(h.api.getState().transaction!.counters.mutationCalls).toBe(3);
  await h.api.userAction("discard");
});

it("C5: a disconnected agent resumes its orphaned draft from a new session with its token", async () => {
  const h = harness(), before = h.host.snapshot();
  const a = as(h, "agent-a"), b = as(h, "agent-b"), intruder = as(h, "intruder");
  const begun = success(await a("begin_edit", { requestLabel: "Resume", mapIds: ["map-1"] })).data as ToolData["begin_edit"];
  success(await a("paint_cells", cell(1)));
  await h.api.sessionEnded("agent-a", "disconnect");
  expect(h.api.getState()).toMatchObject({ phase: "orphaned", transaction: { cause: "clientDisconnected", owner: { clientSessionId: null } } });
  const ended = await a("paint_cells", cell(2));
  error(ended, "CANCELLED");
  expect(ended.structuredContent).toMatchObject({ details: { cause: "clientDisconnected", nextAction: expect.stringContaining("resume_edit") } });
  const notYours = await b("paint_cells", cell(2));
  error(notYours, "TRANSACTION_NOT_OWNED");
  expect(notYours.structuredContent).toMatchObject({ details: { state: "orphaned", isYours: false, awaitingHuman: true, nextAction: expect.stringContaining("resume_edit") } });
  error(await intruder("resume_edit", { transactionId: begun.transactionId, resumeToken: "f".repeat(64) }), "TRANSACTION_NOT_OWNED");
  const resumed = success(await b("resume_edit", { transactionId: begun.transactionId, resumeToken: begun.resumeToken }));
  expect(resumed.data).toMatchObject({ state: "running", resumedFrom: "orphaned", counters: { mutationCalls: 1 } });
  expect(h.api.getState()).toMatchObject({ phase: "running", transaction: { owner: { clientSessionId: "agent-b" } } });
  expect(h.api.getState().transaction!.cause).toBeUndefined();
  success(await b("paint_cells", cell(2)));
  error(await intruder("paint_cells", cell(3)), "TRANSACTION_NOT_OWNED");
  success(await b("finish_edit", {}));
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
  const gone = await b("resume_edit", { transactionId: begun.transactionId, resumeToken: begun.resumeToken });
  error(gone, "TRANSACTION_CANCELLED");
  expect(gone.structuredContent).toMatchObject({ details: { cause: "humanDiscarded" } });
});

it("C5: resume_edit reopens finished and human-stopped drafts; the review bar returns to running", async () => {
  for (const seal of ["finish", "stop"] as const) {
    const h = harness();
    const begun = success(await h.run("begin_edit", { requestLabel: "Amend", mapIds: ["map-1"] })).data as ToolData["begin_edit"];
    success(await h.run("paint_cells", cell(1)));
    if (seal === "finish") success(await h.run("finish_edit", {}));
    else await h.api.userAction("stop");
    const sealed = await h.run("paint_cells", cell(2));
    error(sealed, "TRANSACTION_SEALED");
    expect(sealed.structuredContent).toMatchObject({ details: { cause: seal === "finish" ? "agentFinished" : "humanStopped", nextAction: expect.stringContaining("resume_edit") } });
    const resumed = success(await h.run("resume_edit", { transactionId: begun.transactionId, resumeToken: begun.resumeToken }));
    expect(resumed.data).toMatchObject({ resumedFrom: seal === "finish" ? "awaitingApproval" : "stopped" });
    expect(h.api.getState().phase).toBe("running");
    success(await h.run("paint_cells", cell(2)));
    await h.api.userAction("approve");
    expect(h.host.history.undoDepth).toBe(1);
  }
});

it("C5: cancel_edit with the token discards an orphaned draft from a new session", async () => {
  const h = harness(), before = h.host.snapshot();
  const begun = success(await as(h, "a")("begin_edit", { requestLabel: "Cancel", mapIds: ["map-1"] })).data as ToolData["begin_edit"];
  success(await as(h, "a")("paint_cells", cell(1)));
  await h.api.sessionEnded("a", "expired");
  error(await as(h, "b")("cancel_edit", {}), "TRANSACTION_NOT_OWNED");
  error(await as(h, "b")("cancel_edit", { resumeToken: "0".repeat(64) }), "TRANSACTION_NOT_OWNED");
  success(await as(h, "b")("cancel_edit", { resumeToken: begun.resumeToken }));
  expect(h.host.snapshot()).toEqual(before);
  expect(h.api.getState().transaction).toMatchObject({ outcome: "cancelled", cause: "agentCancelled" });
});

it("an aborted call ends only that call: the draft keeps running and earlier work stays", async () => {
  const h = harness();
  await h.run("begin_edit", { requestLabel: "Abort", mapIds: ["map-1"] });
  success(await h.run("paint_cells", cell(1)));
  const painted = serializeLevel(h.host.stores.get("map-1")!.document);
  const load = h.host.loadMap;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.host.loadMap = async id => { await gate; return load(id); };
  const signal = new CallSignal();
  const task = h.api.executeTool(memoryCall("place_entity", { mapId: "map-1", layerId: "entities", typeId: "portal", at: { x: 1, y: 1 }, fields: { targetLevel: "map-1", targetPoint: { x: 0, y: 0 } } }, { signal }));
  await flush();
  signal.abort();
  const result = await task;
  error(result, "CANCELLED");
  expect(result.structuredContent).toMatchObject({ details: { applied: false, nextAction: expect.stringContaining("still running") } });
  release();
  await flush();
  expect(h.api.getState().phase).toBe("running");
  expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(painted);
  h.host.loadMap = load;
  success(await h.run("paint_cells", cell(2)));
  await h.api.userAction("discard");
});

it("apply_operations bumps the revision once and names the failing operation", async () => {
  const h = harness();
  await h.run("begin_edit", { requestLabel: "Batch", mapIds: ["map-1"] });
  const revision = h.api.getState().revision;
  const ops = [1, 2, 3, 4].map(x => ({ tool: "paint_cells", args: cell(x) }));
  const ok = success(await h.run("apply_operations", { operations: ops }));
  expect(ok.revision).toBe(revision + 1);
  const bad = await h.run("apply_operations", { operations: [...ops, { tool: "paint_cells", args: { ...cell(5), layerId: "missing" } }] });
  error(bad, "UNKNOWN_ID");
  expect(bad.structuredContent).toMatchObject({ message: expect.stringContaining("operations[4]"), details: { operationIndex: 4, tool: "paint_cells", validIds: expect.arrayContaining(["ground"]) } });
  await h.api.userAction("discard");
});

it("WRITER_BUSY explains whose draft blocks and what to do", async () => {
  const h = harness();
  await as(h, "a")("begin_edit", { requestLabel: "First", mapIds: ["map-1"] });
  const busy = await as(h, "b")("begin_edit", { requestLabel: "Second", mapIds: ["map-1"] });
  error(busy, "WRITER_BUSY");
  expect(busy.structuredContent).toMatchObject({ retryable: true, details: { state: "running", isYours: false, ownerClient: "Test client", awaitingHuman: false } });
  await h.api.userAction("discard");
});

it("schema errors report only the best-matching oneOf branch as path: problem", async () => {
  const h = harness();
  await h.run("begin_edit", { requestLabel: "Schema", mapIds: ["map-1"] });
  const batch = await h.run("apply_operations", { operations: [{ tool: "paint_rect", args: { mapId: "map-1", layerId: "ground", region: { x: 0, y: 0, width: 2 }, value: tile } }] });
  error(batch, "INVALID_ARGUMENT");
  expect(batch.structuredContent.ok ? "" : batch.structuredContent.message).toBe("operations[0].args.region.height: required (paint_rect)");
  const layer = await h.run("edit_layer", { mapId: "map-1", action: "update", layerId: "ground", props: { locked: "no" } });
  error(layer, "INVALID_ARGUMENT");
  expect(layer.structuredContent.ok ? "" : layer.structuredContent.message).toBe("props.locked: must be boolean (update)");
  const value = await h.run("paint_cells", { mapId: "map-1", layerId: "ground", cells: [{ x: 0, y: 0, value: { tilesetId: "tiles" } }] });
  expect(value.structuredContent.ok ? "" : value.structuredContent.message).toBe("cells[0].value.tileId: required");
  await h.api.userAction("discard");
});

it("reconnect: get_session shows the pending draft and a resumeToken on the first write resumes it", async () => {
  const h = harness();
  const a = as(h, "agent-a"), b = as(h, "agent-b"), intruder = as(h, "intruder");
  const begun = success(await a("begin_edit", { requestLabel: "Village", mapIds: ["map-1"] })).data as ToolData["begin_edit"];
  expect((success(await a("get_session")).data as ToolData["get_session"]).pendingEdit).toMatchObject({ transactionId: begun.transactionId, state: "running", isYours: true });
  success(await a("paint_cells", cell(1)));
  await h.api.sessionEnded("agent-a", "disconnect");
  const session = success(await b("get_session")).data as ToolData["get_session"];
  expect(session.pendingEdit).toMatchObject({ transactionId: begun.transactionId, state: "orphaned", isYours: false, canResume: true,
    nextAction: expect.stringContaining(`resume_edit {transactionId:"${begun.transactionId}"`) });
  // Without the token the error names the exact recovery call.
  const refused = await b("paint_cells", cell(2));
  error(refused, "TRANSACTION_NOT_OWNED");
  expect(refused.structuredContent).toMatchObject({ details: { nextAction: expect.stringContaining(`transactionId:"${begun.transactionId}"`) } });
  error(await b("begin_edit", { requestLabel: "Again", mapIds: ["map-1"] }), "WRITER_BUSY");
  // Wrong token: refused, nothing changes hands.
  error(await intruder("paint_cells", { ...cell(2), resumeToken: "f".repeat(64) }), "TRANSACTION_NOT_OWNED");
  expect(h.api.getState().phase).toBe("orphaned");
  // Top-level token: auto-resume then paint, in one call.
  success(await b("paint_cells", { ...cell(2), resumeToken: begun.resumeToken }));
  expect(h.api.getState()).toMatchObject({ phase: "running", transaction: { owner: { clientSessionId: "agent-b" }, counters: { mutationCalls: 2 } } });
  // Token in context also works and is ignored while the caller already owns the draft.
  success(await b("paint_cells", { ...cell(3), context: { resumeToken: begun.resumeToken } }));
  success(await b("finish_edit", {}));
  // Amending a submitted draft: the token reopens it.
  success(await b("paint_cells", { ...cell(4), resumeToken: begun.resumeToken }));
  expect(h.api.getState().phase).toBe("running");
  await h.api.userAction("discard");
  expect((success(await b("get_session")).data as ToolData["get_session"]).pendingEdit).toBeUndefined();
});
