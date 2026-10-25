import { expect, it } from "vitest";
import { MapStore, createDocument, serializeLevel } from "@smap/core";
import { harness, success, error, tile } from "./helpers";
import { CallSignal } from "../src/transactions";
import { memoryCall } from "../src/testing/memoryHost";
import { AGENT_LIMITS as L } from "../src/contracts";

const paint = {
  mapId: "map-1",
  layerId: "ground",
  cells: [{ x: 1, y: 1, value: tile }],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

it("finish seals writes; only a user can approve and ordinary cancel works with a stale revision", async () => {
  const h = harness(),
    before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", paint));
  success(await h.edit("finish_edit", { summary: "Ready for review" }));
  expect(h.api.getState().phase).toBe("awaitingApproval");
  expect(h.host.history.undoDepth).toBe(0);
  error(await h.edit("paint_cells", paint), "TRANSACTION_SEALED");
  success(
    await h.run("cancel_edit", {
      context: { ...h.writeContext(), expectedRevision: 0 },
      reason: "Discard",
    }),
  );
  expect(h.host.snapshot()).toEqual(before);
});
it("Durdur keeps prior writes, blocks future writes, and permits user approval or discard", async () => {
  const h = harness(),
    before = serializeLevel(h.host.stores.get("map-1")!.document);
  await h.begin();
  success(await h.edit("paint_cells", paint));
  await h.api.userAction("stop");
  expect(h.api.getState().phase).toBe("stopped");
  expect(h.host.transactions.writeGate.blocked).toBe(true);
  error(await h.edit("paint_cells", paint), "TRANSACTION_SEALED");
  h.host.clock.advance(L.editLifetimeMs + L.reviewIdleMs);
  await flush();
  expect(h.api.getState().phase).toBe("stopped");
  await h.api.userAction("approve");
  expect(h.host.history.undoDepth).toBe(1);
  h.host.history.undo();
  expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(before);
});
it("owner session end orphans running work for review (no rollback); another session cannot cancel it", async () => {
  const h = harness(), before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", paint));
  const painted = h.host.snapshot();
  await h.api.sessionEnded("observer");
  expect(h.api.getState().phase).toBe("running");
  await h.api.sessionEnded("client-1", "expired");
  expect(h.host.snapshot()).toEqual(painted);
  expect(h.api.getState()).toMatchObject({ phase: "orphaned", transaction: { state: "orphaned", cause: "sessionExpired", owner: { clientSessionId: null } } });
  expect(h.host.transactions.writeGate.blocked).toBe(true);
  const other = (name: string, args: unknown) => h.api.executeTool(memoryCall(name, args, { clientSessionId: "new-client" }));
  const busy = await other("begin_edit", { requestLabel: "Other", mapIds: ["map-1"] });
  error(busy, "WRITER_BUSY");
  expect(busy.structuredContent).toMatchObject({ retryable: true, details: { state: "orphaned", isYours: false, awaitingHuman: true } });
  error(await other("cancel_edit", {}), "TRANSACTION_NOT_OWNED");
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
  expect(h.host.pins.size).toBe(0);
  expect(h.api.getState().transaction).toMatchObject({ outcome: "cancelled", cause: "humanDiscarded" });
});
for (const phase of ["stopped", "awaitingApproval"] as const)
  for (const action of ["approve", "discard"] as const)
    it(`${phase} survives session end and lifetime expiry until user ${action}`, async () => {
      const h = harness(), before = h.host.snapshot();
      const original = serializeLevel(h.host.stores.get("map-1")!.document);
      await h.begin();
      success(await h.edit("paint_cells", paint));
      if (phase === "stopped") await h.api.userAction("stop");
      else success(await h.edit("finish_edit"));
      const painted = serializeLevel(h.host.stores.get("map-1")!.document);
      await h.api.sessionEnded("client-1");
      await h.api.sessionEnded("client-1"); // duplicate transport controls are harmless
      h.host.clock.advance(L.editLifetimeMs + L.reviewIdleMs);
      await flush();
      expect(h.api.getState().phase).toBe(phase);
      expect(h.host.transactions.writeGate.blocked).toBe(true);
      expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(painted);
      const observer = (name: string, args: unknown) => h.api.executeTool(memoryCall(name, args, { clientSessionId: "new-client" }));
      const session = success(await observer("get_session", {}));
      if (!("transaction" in session.data)) throw Error("Expected session");
      expect(session.data.transaction).toMatchObject({ state: phase, owner: { clientSessionId: null, clientInfo: { name: "Test client" } } });
      error(await observer("begin_edit", { context: h.context(), expectedRevision: h.api.getState().revision, idempotencyKey: "new-begin-request", requestLabel: "Other", mapIds: ["map-1"] }), "WRITER_BUSY");
      error(await observer("cancel_edit", { context: h.writeContext() }), "TRANSACTION_NOT_OWNED");
      error(await observer("paint_cells", { context: h.writeContext(), ...paint }), "TRANSACTION_NOT_OWNED");
      error(await h.edit("cancel_edit"), "CANCELLED");
      await h.api.userAction(action);
      expect(h.host.transactions.writeGate.blocked).toBe(false);
      expect(h.host.pins.size).toBe(0);
      if (action === "discard") expect(h.host.snapshot()).toEqual(before);
      else {
        expect(h.host.history.undoDepth).toBe(1);
        h.host.history.undo();
        expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(original);
        h.host.history.redo();
        expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(painted);
      }
    });

it("session end during begin preparation releases admission and ignores late loading", async () => {
  const h = harness(), before = h.host.snapshot(), loaded = deferred<MapStore>();
  h.host.loadMap = () => loaded.promise;
  const task = h.run("begin_edit", { context: h.context(), expectedRevision: 0, idempotencyKey: "begin-preparing", requestLabel: "Preparing", mapIds: ["map-1"] });
  await flush();
  expect(h.api.getState().phase).toBe("preparing");
  await h.api.sessionEnded("client-1");
  error(await task, "CANCELLED");
  loaded.resolve(h.host.stores.get("map-1")!);
  await flush();
  expect(h.host.transactions.writeGate.blocked).toBe(false);
  expect(h.host.snapshot()).toEqual(before);
});

it("rejects stale world/revision, unknown targets and foreign client/epoch with no mutation", async () => {
  const h = harness();
  await h.begin();
  const context = h.writeContext(),
    before = h.host.snapshot();
  error(
    await h.api.executeTool(
      memoryCall(
        "paint_cells",
        { context, ...paint },
        { clientSessionId: "other" },
      ),
    ),
    "TRANSACTION_NOT_OWNED",
  );
  error(
    await h.api.executeTool(
      memoryCall(
        "paint_cells",
        { context, ...paint },
        { bridgeEpoch: "epoch-old" },
      ),
    ),
    "TRANSACTION_NOT_OWNED",
  );
  error(
    await h.run("paint_cells", {
      context: { ...context, worldSessionId: "old" },
      ...paint,
    }),
    "STALE_WORLD",
  );
  error(
    await h.run("paint_cells", {
      context: { ...context, expectedRevision: 100 },
      ...paint,
    }),
    "REVISION_CONFLICT",
  );
  error(
    await h.edit("paint_cells", { ...paint, mapId: "missing" }),
    "UNKNOWN_ID",
  );
  expect(h.host.snapshot()).toEqual(before);
});
it("replays begin/paint/finish after approval and reports cancelled retries without double applying", async () => {
  const h = harness();
  const begin = {
    context: h.context(),
    idempotencyKey: "begin-key",
    expectedRevision: h.api.getState().revision,
    requestLabel: "Retry",
    mapIds: ["map-1"],
  };
  success(await h.run("begin_edit", begin));
  const context = h.writeContext(),
    args = { context, ...paint };
  success(await h.run("paint_cells", args));
  error(
    await h.run("paint_cells", {
      ...args,
      cells: [{ x: 2, y: 2, value: tile }],
    }),
    "IDEMPOTENCY_CONFLICT",
  );
  expect(success(await h.run("begin_edit", begin))).toMatchObject({
    replayed: true,
  });
  const finish = { context: h.writeContext() };
  success(await h.run("finish_edit", finish));
  await h.api.userAction("approve");
  for (const [name, a] of [
    ["begin_edit", begin],
    ["paint_cells", args],
    ["finish_edit", finish],
  ] as const)
    expect(success(await h.run(name, a))).toMatchObject({
      replayed: true,
      transactionState: "approved",
    });
  expect(h.host.history.undoDepth).toBe(1);
  await h.begin();
  const cancelled = { context: h.writeContext(), ...paint };
  success(await h.run("paint_cells", cancelled));
  await h.api.userAction("discard");
  error(await h.run("paint_cells", cancelled), "TRANSACTION_CANCELLED");
});
it("empty edits and cancellations preserve earlier dirty content and the redo tail", async () => {
  const h = harness(),
    s = h.host.stores.get("map-1")!;
  const index = s.getOrAddPaletteIndex("tiles", 0);
  s.dispatch({
    type: "paintCells",
    layerId: "ground",
    cells: [{ x: 0, y: 0, cell: index }],
  });
  s.dispatch({
    type: "paintCells",
    layerId: "ground",
    cells: [{ x: 2, y: 2, cell: index }],
  });
  h.host.history.undo();
  const before = h.host.snapshot();
  await h.begin();
  await h.api.userAction("approve");
  expect(h.host.snapshot()).toEqual(before);
  await h.begin();
  success(await h.edit("paint_cells", paint));
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
});
it("approval survives throwing commit subscribers and a failed dispatch rolls back only that call", async () => {
  const h = harness();
  await h.begin();
  success(await h.edit("paint_cells", paint));
  h.host.stores.get("map-1")!.subscribe((e) => {
    if (e.cause === "commit") throw new Error("observer");
  });
  await h.api.userAction("approve");
  expect(h.api.getState().transaction!.outcome).toBe("approved");
  expect(h.host.history.undoDepth).toBe(1);
  const k = harness(),
    before = k.host.snapshot(),
    level = serializeLevel(k.host.stores.get("map-1")!.document);
  await k.begin();
  k.host.stores.get("map-1")!.subscribe((e) => {
    if (e.cause === "dispatch") throw new Error("observer");
  });
  const failed = await k.edit("paint_cells", paint);
  error(failed, "INTERNAL_ERROR");
  expect(failed.structuredContent).toMatchObject({ details: { applied: false } });
  expect(serializeLevel(k.host.stores.get("map-1")!.document)).toBe(level);
  expect(k.api.getState().phase).toBe("running");
  await k.api.userAction("discard");
  expect(k.host.snapshot()).toEqual(before);
  expect(k.host.transactions.writeGate.blocked).toBe(false);
});
it("write envelopes never echo large payloads, so a big entity default still answers compactly", async () => {
  const h = harness({ entityTypes: [{
    id: "large-default", name: "Large default", color: "#ffffff",
    fields: [{ name: "text", type: "string", default: "x".repeat(L.responseBytes / 2) }],
  }] });
  const before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", paint));
  const painted = h.host.snapshot(), counters = { ...h.api.getState().transaction!.counters };
  const args = { context: h.writeContext(), mapId: "map-1", layerId: "entities", typeId: "large-default", at: { x: 0, y: 0 } };
  const placed = await h.run("place_entity", args);
  expect(success(placed).created?.entityIds).toHaveLength(1);
  expect(placed.content[0].text.length).toBeLessThan(512);
  expect(h.api.getState().phase).toBe("running");
  expect(h.host.snapshot()).not.toEqual(painted);
  expect(h.api.getState().transaction!.counters.mutationCalls).toBe(counters.mutationCalls + 1);
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
  expect(h.host.transactions.writeGate.blocked).toBe(false);
});
it("Stop/discard/timeouts during asynchronous preparation never publish late results", async () => {
  for (const action of ["stop", "discard", "timeout", "disconnect"] as const) {
    const h = harness(),
      before = h.host.snapshot();
    await h.begin();
    success(await h.edit("paint_cells", paint));
    const prepare = h.host.smartSources.prepare,
      gate = deferred<void>();
    let entered = false;
    h.host.smartSources.prepare = async (a, call) => {
      entered = true;
      await gate.promise;
      return prepare(a, call);
    };
    const task = h.edit("prepare_smart_source", {
      mapId: "map-1",
      source: {
        tilesetId: "tiles",
        region: { x: 0, y: 0, width: 3, height: 3 },
      },
      force: true,
    });
    await flush();
    expect(entered).toBe(true);
    if (action === "timeout") h.host.clock.advance(L.imageSourceTimeoutMs + 1);
    else if (action === "disconnect") await h.api.sessionEnded("client-1");
    else await h.api.userAction(action);
    const failed = await task;
    error(failed, action === "timeout" ? "TIMEOUT" : "CANCELLED");
    gate.resolve();
    await flush();
    // Aborts end only that call: earlier draft work is never rolled back by them.
    expect(h.api.getState().phase).toBe({ stop: "stopped", timeout: "running", disconnect: "orphaned", discard: "ready" }[action]);
    if (action === "timeout") expect(failed.structuredContent).toMatchObject({ details: { applied: false } });
    if (action !== "discard") await h.api.userAction("discard");
    expect(h.host.snapshot()).toEqual(before);
  }
});
it("the running lease extends on activity, then seals for review without rollback; review never auto-finalizes", async () => {
  const h = harness(),
    before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", paint));
  h.host.clock.advance(L.editLifetimeMs - 1000);
  await flush();
  success(await h.edit("paint_cells", { ...paint, cells: [{ x: 2, y: 2, value: tile }] }));
  h.host.clock.advance(L.editLifetimeMs - 1000);
  await flush();
  expect(h.api.getState().phase).toBe("running");
  const painted = h.host.snapshot();
  h.host.clock.advance(1001);
  await flush();
  expect(h.api.getState()).toMatchObject({ phase: "orphaned", transaction: { cause: "leaseExpired", owner: { clientSessionId: null } } });
  expect(h.host.snapshot()).toEqual(painted);
  const sealed = await h.edit("paint_cells", paint);
  error(sealed, "TRANSACTION_NOT_OWNED");
  expect(sealed.structuredContent).toMatchObject({ details: { state: "orphaned", cause: "leaseExpired", awaitingHuman: true } });
  h.host.clock.advance(L.editLifetimeMs * 2);
  await flush();
  expect(h.api.getState().phase).toBe("orphaned");
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
  await h.begin();
  success(await h.edit("paint_cells", paint));
  success(await h.edit("finish_edit"));
  h.host.clock.advance(L.editLifetimeMs * 2);
  await flush();
  expect(h.api.getState().phase).toBe("awaitingApproval");
  await h.api.userAction("discard");
});
it("a source change cancels pending work and a replacement world rejects every old retry", async () => {
  const h = harness(),
    before = h.host.snapshot();
  await h.begin();
  const args = { context: h.writeContext(), ...paint };
  success(await h.run("paint_cells", args));
  h.host.contentChanged();
  await flush();
  expect(h.host.snapshot()).toEqual(before);
  h.host.changeWorld("world-2");
  error(await h.run("paint_cells", args), "STALE_WORLD");
});
it("begin cancellation releases admission after a timed-out write drain and retries can begin afresh", async () => {
  const h = harness(),
    gate = h.host.transactions.writeGate,
    acquire = gate.acquireEdit;
  gate.acquireEdit = (id) => {
    const admission = acquire(id);
    return { ...admission, waitForWrites: () => new Promise(() => {}) };
  };
  const task = h.run("begin_edit", {
    context: h.context(),
    idempotencyKey: "begin-timeout",
    expectedRevision: 0,
    requestLabel: "Drain",
    mapIds: ["map-1"],
  });
  await flush();
  expect(gate.blocked).toBe(true);
  h.host.clock.advance(L.beginDrainTimeoutMs + 1);
  error(await task, "TIMEOUT");
  expect(gate.blocked).toBe(false);
  gate.acquireEdit = acquire;
  await h.begin();
  await h.api.userAction("discard");
});
it("aborted, expired, overdeep and non-JSON calls reject at the edge", async () => {
  const h = harness(),
    signal = new CallSignal();
  signal.abort();
  error(
    await h.api.executeTool(memoryCall("get_session", {}, { signal })),
    "CANCELLED",
  );
  error(
    await h.api.executeTool(memoryCall("get_session", {}, { deadline: 0 })),
    "TIMEOUT",
  );
  let deep: unknown = {};
  for (let i = 0; i < 40; i++) deep = { deep };
  error(await h.run("get_session", deep), "LIMIT_EXCEEDED");
  error(await h.run("get_session", { value: NaN }), "INVALID_ARGUMENT");
});
it("a multi-map approval stays one chronological row and can include metadata-only cached followers", async () => {
  const a = new MapStore(
      createDocument({
        width: 8,
        height: 8,
        tilesets: [
          {
            id: "tiles",
            name: "Tiles",
            tileWidth: 32,
            tileHeight: 32,
            columns: 1,
            rows: 1,
            margin: 0,
            spacing: 0,
            imagePath: "tiles.png",
          },
        ],
      }),
    ),
    b = a.createSibling(
      createDocument({ width: 8, height: 8, tilesets: a.document.tilesets }),
    );
  for (const s of [a, b]) {
    s.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
    s.clearHistory();
  }
  const h = harness({
      maps: [
        { id: "map-1", store: a },
        { id: "map-2", store: b },
      ],
      tilesets: a.document.tilesets,
    }),
    before = [a, b].map((s) => serializeLevel(s.document));
  await h.begin(["map-1", "map-2"]);
  success(await h.edit("paint_cells", paint));
  success(await h.edit("paint_cells", { ...paint, mapId: "map-2" }));
  await h.api.userAction("approve");
  expect(h.host.history.undoDepth).toBe(1);
  h.host.history.undo();
  expect([a, b].map((s) => serializeLevel(s.document))).toEqual(before);
});
it("cached metadata followers join the pending collector and rollback together", async () => {
  for (const outcome of ["approve", "discard"] as const) {
    const tileset = {
      id: "tiles",
      name: "Tiles",
      tileWidth: 32,
      tileHeight: 32,
      columns: 8,
      rows: 8,
      margin: 0,
      spacing: 0,
      imagePath: "tiles.png",
    };
    const maps = ["map-1", "map-2"].map((id) => {
      const store = new MapStore(
        createDocument({ width: 8, height: 8, tilesets: [tileset] }),
      );
      store.dispatch({
        type: "addLayer",
        layer: { id: "ground", name: "Ground" },
      });
      store.clearHistory();
      return { id, store };
    });
    const h = harness({ maps, tilesets: [tileset] }),
      before = h.host.snapshot(),
      documents = maps.map((m) => serializeLevel(m.store.document));
    await h.begin(["map-1"]);
    const publish = h.host.smartSources.publish;
    h.host.smartSources.publish = (source) => {
      for (const ts of source.tilesets)
        maps[1]!.store.dispatch({
          type: "addTileset",
          tileset: ts,
          undoable: true,
        });
      publish(source);
    };
    success(
      await h.edit("prepare_smart_source", {
        mapId: "map-1",
        source: {
          tilesetId: "tiles",
          region: { x: 0, y: 0, width: 3, height: 3 },
        },
        force: true,
      }),
    );
    expect(maps[1]!.store.transactionDepth).toBe(1);
    await h.api.userAction(outcome);
    if (outcome === "discard") expect(h.host.snapshot()).toEqual(before);
    else {
      expect(h.host.history.undoDepth).toBe(1);
      expect(h.host.history.peekUndo()!.participants).toHaveLength(2);
      h.host.history.undo();
      expect(maps.map((m) => serializeLevel(m.store.document))).toEqual(
        documents,
      );
    }
  }
});

it("sessionEnded rejects delayed commands from that authenticated session even after rollback", async () => {
  const h = harness(),
    before = h.host.snapshot();
  await h.begin();
  await h.api.sessionEnded("client-1");
  error(
    await h.run("begin_edit", {
      context: h.context(),
      idempotencyKey: "late-begin",
      expectedRevision: h.api.getState().revision,
      requestLabel: "Late",
      mapIds: ["map-1"],
    }),
    "CANCELLED",
  );
  expect(h.host.snapshot()).toEqual(before);
});

it("host world-position changes share the approved row and restore on undo", async () => {
  const h = harness();
  await h.begin();
  const publish = h.host.smartSources.publish;
  h.host.smartSources.publish = (s) => {
    h.host.metadata.stage({
      kind: "mapPosition",
      mapId: "map-1",
      before: { x: 0, y: 0 },
      after: { x: 100, y: 200 },
    });
    publish(s);
  };
  success(
    await h.edit("prepare_smart_source", {
      mapId: "map-1",
      source: {
        tilesetId: "tiles",
        region: { x: 0, y: 0, width: 3, height: 3 },
      },
      force: true,
    }),
  );
  await h.api.userAction("approve");
  expect(h.host.history.undoDepth).toBe(1);
  h.host.history.undo();
  expect(h.host.world.maps()[0]!.world).toEqual({ x: 0, y: 0 });
  h.host.history.redo();
  expect(h.host.world.maps()[0]!.world).toEqual({ x: 100, y: 200 });
});

it("the inactivity lease starts when the draft runs and seals it for review on expiry", async () => {
  const h = harness(),
    gate = h.host.transactions.writeGate,
    acquire = gate.acquireEdit;
  gate.acquireEdit = (id) => {
    const admission = acquire(id);
    return {
      ...admission,
      waitForWrites: async () => {
        h.host.clock.advance(10000);
      },
    };
  };
  const begun = await h.begin();
  if (!("leaseDeadline" in begun.data)) throw Error("Expected begin data");
  expect(begun.data.leaseDeadline).toBe(h.host.clock.now() + L.editLifetimeMs);
  h.host.clock.advance(L.editLifetimeMs - 1);
  await flush();
  expect(h.api.getState().phase).toBe("running");
  h.host.clock.advance(1);
  await flush();
  expect(h.api.getState().phase).toBe("orphaned");
  expect(gate.blocked).toBe(true);
  await h.api.userAction("discard");
  expect(gate.blocked).toBe(false);
});

it("reference-host IDs avoid existing maps and entities supplied by an integration fixture", async () => {
  const seed = harness(),
    store = seed.host.stores.get("map-1")!;
  store.dispatch({
    type: "addEntity",
    layerId: "entities",
    entity: { id: "entity-1", typeId: "portal", x: 0, y: 0 },
  });
  store.clearHistory();
  const h = harness({
    maps: [{ id: "map-1", store }],
    tilesets: store.document.tilesets,
  });
  await h.begin();
  success(
    await h.edit("create_map", {
      name: "Fresh",
      width: 4,
      height: 4,
      tileWidth: 32,
      tileHeight: 32,
    }),
  );
  expect(h.host.stores.size).toBe(2);
  success(
    await h.edit("place_entity", {
      mapId: "map-1",
      layerId: "entities",
      typeId: "portal",
      at: { x: 1, y: 1 },
    }),
  );
  expect(store.document.entityLayers()[0]!.entities.map((e) => e.id)).toEqual([
    "entity-1",
    "entity-2",
  ]);
});

it("releases save admission before notifying persistence and reports post-commit observer diagnostics", async () => {
  const h = harness();
  await h.begin();
  success(await h.edit("paint_cells", paint));
  let admitted = false;
  h.host.transactions.finalized = () => {
    h.host.transactions.writeGate.assertSaveAllowed("world-1");
    admitted = true;
  };
  h.host.stores.get("map-1")!.subscribe((e) => {
    if (e.cause === "commit") throw new Error("observer");
  });
  await h.api.userAction("approve");
  expect(admitted).toBe(true);
  expect(h.host.history.undoDepth).toBe(1);
  expect(
    h.host.activity
      .entries()
      .some((e) => e.status === "failed" && e.code === "INTERNAL_ERROR"),
  ).toBe(true);
});
