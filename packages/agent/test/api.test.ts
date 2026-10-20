import { describe, expect, it } from "vitest";
import { serializeLevel } from "@smap/core";
import { createAgentApi } from "../src/api";
import { createMemoryHost, memoryCall } from "../src/testing/memoryHost";

it("keeps edits tentative, commits one row, and round trips palettes with ordinary world undo", async () => {
  const host = createMemoryHost(),
    api = createAgentApi(host);
  const before = serializeLevel(host.stores.get("map-1")!.document);
  const begin = await api.executeTool(
    memoryCall("begin_edit", {
      context: { worldSessionId: "world-1" },
      idempotencyKey: "begin-001",
      expectedRevision: api.getState().revision,
      requestLabel: "Village",
      mapIds: ["map-1"],
    }),
  );
  expect(begin.structuredContent.ok).toBe(true);
  const transactionId = api.getState().transaction!.id;
  const args = {
    context: {
      worldSessionId: "world-1",
      transactionId,
      idempotencyKey: "paint-001",
      expectedRevision: api.getState().revision,
    },
    mapId: "map-1",
    layerId: "ground",
    cells: [{ x: 1, y: 1, value: { tilesetId: "tiles", tileId: 0 } }],
  };
  expect(
    (await api.executeTool(memoryCall("paint_cells", args))).structuredContent
      .ok,
  ).toBe(true);
  expect(host.history.undoDepth).toBe(0);
  expect(host.transactions.writeGate.blocked).toBe(true);
  expect(
    (await api.executeTool(memoryCall("paint_cells", args))).structuredContent,
  ).toMatchObject({ ok: true, replayed: true });
  const after = serializeLevel(host.stores.get("map-1")!.document);
  const finish = await api.executeTool(
    memoryCall("finish_edit", {
      context: {
        ...args.context,
        idempotencyKey: "finish-01",
        expectedRevision: api.getState().revision,
      },
    }),
  );
  expect(finish.structuredContent).toMatchObject({
    ok: true,
    data: { requiresUserApproval: true },
  });
  expect(host.history.undoDepth).toBe(0);
  await api.userAction("approve");
  expect(host.history.undoDepth).toBe(1);
  host.history.undo();
  expect(serializeLevel(host.stores.get("map-1")!.document)).toBe(before);
  host.history.redo();
  expect(serializeLevel(host.stores.get("map-1")!.document)).toBe(after);
});

describe("edge validation", () => {
  it("rejects unknown tools and invalid shapes without touching world state", async () => {
    const host = createMemoryHost(),
      api = createAgentApi(host),
      before = host.snapshot();
    expect(
      (await api.executeTool(memoryCall("unknown", {}))).structuredContent,
    ).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(
      (await api.executeTool(memoryCall("paint_cells", {}))).structuredContent,
    ).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(host.snapshot()).toEqual(before);
  });
});
