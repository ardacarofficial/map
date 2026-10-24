import { afterEach, describe, expect, it } from "vitest";
import { serializeLevel, type Op, type Stamp } from "@smap/core";
import { error } from "./helpers";
import { AGENT_LIMITS } from "../src/contracts";
import { collaborationHarness, eastClaim, westClaim } from "./collaborationTestHarness";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanups.splice(0)) await dispose(); });
function setup(...args: Parameters<typeof collaborationHarness>) {
  const h = collaborationHarness(...args); cleanups.push(() => h.api.dispose()); return h;
}

describe("collaborative live region edits", () => {
  it("interleaves disjoint same-layer agents using independent member revisions, then commits one human-reviewed undo", async () => {
    const h = setup(), before = serializeLevel(h.store.document);
    await h.begin(); await h.join();
    const aRevision = h.revisions.get("A"), bRevision = h.revisions.get("B");
    await Promise.all([h.paint("A", 1, 1, 0), h.paint("B", 6, 1, 1)]);
    expect(h.revisions.get("A")).toBeGreaterThan(aRevision!);
    expect(h.revisions.get("B")).toBeGreaterThan(bRevision!);
    expect(h.cell(1, 1)).not.toBe(0); expect(h.cell(6, 1)).not.toBe(0);
    expect(h.host.history.undoDepth).toBe(0);
    await h.ok("A", "finish_edit", { summary: "West done" });
    expect(h.api.getState().phase).toBe("running");
    await h.paint("B", 7, 2, 2);
    await h.ok("B", "finish_edit", { summary: "East done" });
    expect(h.api.getState().phase).toBe("awaitingApproval");
    const after = serializeLevel(h.store.document);
    await h.api.userAction("approve");
    expect(h.host.history.undoDepth).toBe(1);
    h.host.history.undo(); expect(serializeLevel(h.store.document)).toBe(before);
    h.host.history.redo(); expect(serializeLevel(h.store.document)).toBe(after);
  });

  it("lets a member paint a claim larger than the sparse 4096-cell call cap in one grid call", async () => {
    const h = setup({ width: 128, height: 128 });
    const claim = { mapId: "map-1", layerIds: ["ground"], region: { x: 0, y: 0, width: 128, height: 64 } };
    await h.begin("A", [claim]);
    const rows = Array.from({ length: 64 }, () => "g".repeat(128));
    await h.ok("A", "paint_grid", { mapId: "map-1", layerId: "ground", rows, legend: { g: { tilesetId: "tiles", tileId: 1 } } });
    expect(h.cell(127, 63)).not.toBe(0);
    expect(h.cell(0, 64)).toBe(0);
    await h.ok("A", "cancel_edit", {});
    expect(h.cell(127, 63)).toBe(0);
  });

  it("identifies the calling client and rejects overlapping claims before changing the draft", async () => {
    const h = setup(); await h.begin();
    const before = h.host.snapshot();
    error(await h.invoke("B", "join_edit", { context: h.context(), transactionId: h.api.getState().transaction!.id,
      expectedRevision: h.api.getState().revision, idempotencyKey: "overlap-claim", claims: [westClaim()] }), "REGION_CONFLICT");
    expect(h.host.snapshot()).toEqual(before);
    const session = await h.invoke("B", "get_session", {});
    expect(session.structuredContent).toMatchObject({ ok: true, data: { currentClientSessionId: "B" } });
    await h.join(); await h.paint("A", 0, 0); await h.paint("B", 4, 0);
  });

  it("keeps replay keys scoped by authenticated member and prevents stale member writes", async () => {
    const h = setup(); await h.begin(); await h.join();
    const args = { context: h.writeContext("A", "same-key"), mapId: "map-1", layerId: "ground",
      cells: [{ x: 1, y: 1, value: { tilesetId: "tiles", tileId: 0 } }] };
    h.accept("A", await h.invoke("A", "paint_cells", args));
    await h.paint("B", 6, 6, 2);
    const beforeReplay = serializeLevel(h.store.document);
    expect((await h.invoke("A", "paint_cells", args)).structuredContent).toMatchObject({ ok: true, replayed: true });
    expect(serializeLevel(h.store.document)).toBe(beforeReplay);
    h.accept("B", await h.invoke("B", "paint_cells", { ...args, context: h.writeContext("B", "same-key"),
      cells: [{ x: 5, y: 1, value: { tilesetId: "tiles", tileId: 3 } }] }));
    error(await h.invoke("A", "paint_cells", { ...args, context: { ...args.context, idempotencyKey: "stale-write" } }), "MEMBER_REVISION_CONFLICT");
    error(await h.invoke("C", "paint_cells", { ...args, context: h.writeContext("A", "stolen-context") }), "TRANSACTION_NOT_OWNED");
  });

  it("does not let two queued calls from one member consume the same sequence token", async () => {
    const h = setup(); await h.begin(); await h.join();
    const context = h.writeContext("A", "first-concurrent");
    const args = { context, mapId: "map-1", layerId: "ground", cells: [{ x: 0, y: 0, value: { tilesetId: "tiles", tileId: 0 } }] };
    const [first, stale] = await Promise.all([
      h.invoke("A", "paint_cells", args),
      h.invoke("A", "paint_cells", { ...args, context: { ...context, idempotencyKey: "second-concurrent" },
        cells: [{ x: 1, y: 0, value: { tilesetId: "tiles", tileId: 1 } }] }),
    ]);
    h.accept("A", first); error(stale, "MEMBER_REVISION_CONFLICT");
    expect(h.cell(0, 0)).not.toBe(0); expect(h.cell(1, 0)).toBe(0);
    await h.paint("B", 4, 0);
  });

  it("does not replay a cancelled member's reverted paint as successful while its peer remains active", async () => {
    const h = setup(); await h.begin(); await h.join();
    const args = { context: h.writeContext("B", "paint-before-cancel"), mapId: "map-1", layerId: "ground",
      cells: [{ x: 5, y: 0, value: { tilesetId: "tiles", tileId: 1 } }] };
    h.accept("B", await h.invoke("B", "paint_cells", args));
    await h.paint("A", 1, 0);
    await h.ok("B", "cancel_edit", { reason: "Revert east" });
    const before = h.host.snapshot();
    error(await h.invoke("B", "paint_cells", args), "TRANSACTION_CANCELLED");
    expect(h.host.snapshot()).toEqual(before);
    expect(h.cell(5, 0)).toBe(0); expect(h.cell(1, 0)).not.toBe(0);
  });

  it("releases cancelled claims for another member and never repeats rollback on an idempotent cancel retry", async () => {
    const h = setup(); await h.begin(); await h.join(); await h.paint("B", 5, 0);
    const cancelArgs = { context: h.writeContext("B", "cancel-once"), reason: "Release east" };
    h.accept("B", await h.invoke("B", "cancel_edit", cancelArgs));
    await h.join("C", [eastClaim()]); await h.paint("C", 5, 0, 5);
    const replacement = h.cell(5, 0), before = h.host.snapshot();
    expect((await h.invoke("B", "cancel_edit", cancelArgs)).structuredContent).toMatchObject({ ok: true, replayed: true });
    expect(h.host.snapshot()).toEqual(before); expect(h.cell(5, 0)).toBe(replacement);
    await h.paint("A", 0, 0);
  });

  for (const end of ["cancel", "disconnect"] as const)
    it(`${end} rolls back only that member's region while its peer keeps working with shared palette entries`, async () => {
      const h = setup(); await h.begin(); await h.join();
      await h.paint("A", 2, 2, 7); await h.paint("B", 5, 2, 7);
      const peerCell = h.cell(2, 2);
      if (end === "cancel") await h.ok("B", "cancel_edit", { reason: "East cancelled" });
      else await h.api.sessionEnded("B");
      expect(h.cell(5, 2)).toBe(0); expect(h.cell(2, 2)).toBe(peerCell);
      expect(h.store.document.palette.get(peerCell & 0x1fffffff)).toBeDefined();
      expect(h.api.getState().phase).toBe("running");
      await h.paint("A", 3, 2, 3); await h.api.userAction("approve");
      expect(h.cell(2, 2)).toBe(peerCell); expect(h.cell(5, 2)).toBe(0);
      expect(h.host.history.undoDepth).toBe(1);
    });

  it("coordinator disconnect preserves the other member's edits and ability to finish", async () => {
    const h = setup(); await h.begin(); await h.join();
    await h.paint("A", 1, 1); await h.paint("B", 5, 1);
    const peer = h.cell(5, 1);
    await h.api.sessionEnded("A");
    expect(h.cell(1, 1)).toBe(0); expect(h.cell(5, 1)).toBe(peer);
    await h.paint("B", 6, 1, 2);
    await h.ok("B", "finish_edit", { summary: "Remaining member done" });
    await h.api.userAction("approve");
    expect(h.cell(5, 1)).toBe(peer); expect(h.cell(6, 1)).not.toBe(0);
  });

  it("preserves a finished member's submitted region when its client disconnects", async () => {
    const h = setup(); await h.begin(); await h.join();
    await h.paint("B", 5, 2, 3); await h.ok("B", "finish_edit", { summary: "East submitted" });
    const submitted = h.cell(5, 2);
    await h.api.sessionEnded("B");
    expect(h.cell(5, 2)).toBe(submitted);
    await h.paint("A", 1, 2); await h.ok("A", "finish_edit", { summary: "West submitted" });
    expect(h.api.getState().phase).toBe("awaitingApproval");
    await h.api.userAction("approve"); expect(h.cell(5, 2)).toBe(submitted);
  });

  it("rejects mixed in-scope/out-of-scope cell writes and batch children atomically", async () => {
    const h = setup(); await h.begin(); await h.join();
    const before = h.host.snapshot(), revision = h.revisions.get("A");
    error(await h.edit("A", "paint_cells", { mapId: "map-1", layerId: "ground", cells: [
      { x: 0, y: 0, value: { tilesetId: "tiles", tileId: 61 } }, { x: 4, y: 0, value: { tilesetId: "tiles", tileId: 62 } },
    ] }), "OUTSIDE_REGION");
    expect(h.host.snapshot()).toEqual(before);
    error(await h.edit("A", "apply_operations", { operations: [
      { tool: "paint_cells", args: { mapId: "map-1", layerId: "ground", cells: [{ x: 1, y: 0, value: { tilesetId: "tiles", tileId: 60 } }] } },
      { tool: "paint_cells", args: { mapId: "map-1", layerId: "ground", cells: [{ x: 5, y: 0, value: { tilesetId: "tiles", tileId: 63 } }] } },
    ] }), "OUTSIDE_REGION");
    expect(h.host.snapshot()).toEqual(before); expect(h.revisions.get("A")).toBe(revision);
    await h.paint("A", 0, 0);
  });

  it("a rejected batch never contaminates the member rollback journal with projected empty cells", async () => {
    const h = setup();
    const paletteIndex = h.store.dispatch({ type: "addPaletteEntry", tilesetId: "tiles", tileId: 3 });
    h.store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 1, y: 0, cell: paletteIndex }] });
    h.store.clearHistory();
    const original = h.cell(1, 0);
    await h.begin(); await h.join();
    error(await h.edit("A", "apply_operations", { operations: [
      { tool: "paint_cells", args: { mapId: "map-1", layerId: "ground", cells: [{ x: 1, y: 0, value: { tilesetId: "tiles", tileId: 4 } }] } },
      { tool: "paint_cells", args: { mapId: "map-1", layerId: "ground", cells: [{ x: 5, y: 0, value: { tilesetId: "tiles", tileId: 5 } }] } },
    ] }), "OUTSIDE_REGION");
    await h.ok("A", "cancel_edit", { reason: "No accepted work" });
    expect(h.cell(1, 0)).toBe(original);
    await h.paint("B", 5, 0); await h.api.userAction("approve");
    expect(h.cell(1, 0)).toBe(original);
  });

  it("successful batch cancellation restores live before-values instead of the validation projection", async () => {
    const h = setup();
    const paletteIndex = h.store.dispatch({ type: "addPaletteEntry", tilesetId: "tiles", tileId: 3 });
    h.store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 1, y: 0, cell: paletteIndex }] });
    h.store.clearHistory(); const original = h.cell(1, 0);
    await h.begin(); await h.join(); await h.paint("B", 5, 0, 5);
    const peer = h.cell(5, 0);
    await h.ok("A", "apply_operations", { operations: [
      { tool: "paint_cells", args: { mapId: "map-1", layerId: "ground", cells: [{ x: 1, y: 0, value: { tilesetId: "tiles", tileId: 4 } }] } },
      { tool: "paint_cells", args: { mapId: "map-1", layerId: "ground", cells: [{ x: 2, y: 0, value: { tilesetId: "tiles", tileId: 6 } }] } },
    ] });
    await h.ok("A", "cancel_edit", { reason: "Restore original west" });
    expect(h.cell(1, 0)).toBe(original); expect(h.cell(2, 0)).toBe(0); expect(h.cell(5, 0)).toBe(peer);
  });

  it("keeps adjacent rectangles half-open and checks widened line footprints before mutation", async () => {
    const h = setup(); await h.begin(); await h.join();
    await h.paint("A", 3, 4); await h.paint("B", 4, 4);
    const before = h.host.snapshot();
    error(await h.edit("A", "paint_line", { mapId: "map-1", layerId: "ground", from: { x: 3, y: 2 }, to: { x: 3, y: 5 }, width: 3,
      value: { tilesetId: "tiles", tileId: 2 } }), "OUTSIDE_REGION");
    expect(h.host.snapshot()).toEqual(before);
    error(await h.edit("A", "paint_cells", { mapId: "map-1", layerId: "collision", cells: [{ x: 0, y: 0, value: { collision: 1 } }] }), "OUTSIDE_REGION");
  });

  it("checks every stamp destination layer and its transformed footprint before palette writes", async () => {
    const stamp: Stamp = { id: "wide", name: "Wide", width: 2, height: 1,
      palette: [{ tilesetId: "tiles", tileId: 60 }, { tilesetId: "tiles", tileId: 61 }],
      layers: [{ layerId: "base", name: "Ground", cells: Uint32Array.of(1, 2) }] };
    const h = setup({ stamps: [stamp] }); await h.begin(); await h.join();
    const before = h.host.snapshot();
    error(await h.edit("A", "place_stamp", { mapId: "map-1", stampId: "wide", at: { x: 3, y: 1 },
      layerMapping: [{ sourceLayerId: "base", targetLayerId: "ground" }] }), "OUTSIDE_REGION");
    expect(h.host.snapshot()).toEqual(before);
    await h.ok("A", "place_stamp", { mapId: "map-1", stampId: "wide", at: { x: 1, y: 1 },
      layerMapping: [{ sourceLayerId: "base", targetLayerId: "ground" }] });
    expect(h.cell(1, 1)).not.toBe(0); expect(h.cell(2, 1)).not.toBe(0);
  });

  it("retains coordinator-prepared smart assets while cancelling a follower and rejects smart writes across its boundary", async () => {
    const h = setup(), baseline = h.host.snapshot();
    await h.begin("A", null);
    const prepared = await h.ok("A", "prepare_smart_source", { mapId: "map-1",
      source: { tilesetId: "tiles", region: { x: 0, y: 0, width: 3, height: 3 } }, force: true });
    const { sourceId } = prepared.data as { sourceId: string };
    const foundation = h.store.document.tilesets.map(tileset => tileset.id);
    await h.join("A", [westClaim()]); await h.join();
    const before = h.host.snapshot();
    error(await h.edit("A", "smart_brush", { mapId: "map-1", layerId: "ground", sourceId,
      mode: "area", region: { x: 3, y: 1, width: 2, height: 3 }, erase: false }), "OUTSIDE_REGION");
    expect(h.host.snapshot()).toEqual(before);
    await h.ok("B", "smart_brush", { mapId: "map-1", layerId: "ground", sourceId, mode: "road", cells: [{ x: 4, y: 4 }] });
    const isolatedRoad = h.host.snapshot();
    // The requested new cell is inside A, but joining the adjacent road would
    // also repair B's existing end cap. The whole operation must be rejected.
    error(await h.edit("A", "smart_brush", { mapId: "map-1", layerId: "ground", sourceId,
      mode: "road", cells: [{ x: 3, y: 4 }] }), "OUTSIDE_REGION");
    expect(h.host.snapshot()).toEqual(isolatedRoad);
    await h.paint("A", 1, 1); await h.paint("B", 6, 1);
    await h.ok("B", "cancel_edit", { reason: "Only east" });
    expect(h.store.document.tilesets.map(tileset => tileset.id)).toEqual(foundation);
    expect(h.cell(1, 1)).not.toBe(0); expect(h.cell(6, 1)).toBe(0);
    await h.api.userAction("discard"); expect(h.host.snapshot()).toEqual(baseline);
  });

  it("checks both original and destination entity positions when moving or deleting", async () => {
    const h = setup({ entityTypes: [{ id: "tree", name: "Tree", color: "#008800", fields: [] }] });
    await h.begin("A", [westClaim(["entities"])]); await h.join("B", [eastClaim(["entities"])]);
    const placed = await h.ok("A", "place_entity", { mapId: "map-1", layerId: "entities", typeId: "tree", at: { x: 1, y: 1 } });
    const { entity } = placed.data as { entity: { id: string } };
    const before = h.host.snapshot();
    error(await h.edit("A", "edit_entity", { mapId: "map-1", entityId: entity.id, action: "move", at: { x: 5, y: 1 } }), "OUTSIDE_REGION");
    error(await h.edit("B", "edit_entity", { mapId: "map-1", entityId: entity.id, action: "remove" }), "OUTSIDE_REGION");
    expect(h.host.snapshot()).toEqual(before);
    await h.ok("A", "edit_entity", { mapId: "map-1", entityId: entity.id, action: "move", at: { x: 2, y: 1 } });
  });

  it("preserves map-wide spawn uniqueness across disjoint claimed entity regions", async () => {
    const h = setup(); await h.begin("A", [westClaim(["entities"])]); await h.join("B", [eastClaim(["entities"])]);
    await h.ok("A", "place_entity", { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 1, y: 1 } });
    const before = h.host.snapshot();
    const rejected = (await h.edit("B", "place_entity", { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 5, y: 1 } })).structuredContent;
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(["ENTITY_SCHEMA", "REGION_CONFLICT"]).toContain(rejected.code);
    expect(h.host.snapshot()).toEqual(before);
  });

  it("retains the spawn constraint after removal so cancelling its owner can restore the original spawn", async () => {
    const h = setup();
    h.store.dispatch({ type: "addEntity", layerId: "entities", entity: { id: "original-spawn", typeId: "spawn", x: 32, y: 32, fields: {} } });
    h.store.clearHistory();
    await h.begin("A", [westClaim(["entities"])]); await h.join("B", [eastClaim(["entities"])]);
    await h.ok("A", "edit_entity", { mapId: "map-1", entityId: "original-spawn", action: "remove" });
    const before = h.host.snapshot();
    error(await h.edit("B", "place_entity", { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 5, y: 1 } }), "REGION_CONFLICT");
    expect(h.host.snapshot()).toEqual(before);
    await h.ok("A", "cancel_edit", { reason: "Keep original spawn" });
    expect(h.store.document.spawn()).toMatchObject({ id: "original-spawn", x: 32, y: 32 });
    await h.api.userAction("approve");
    expect(h.store.document.entityLayers().flatMap(layer => layer.entities).filter(entity => entity.typeId === "spawn")).toHaveLength(1);
  });

  it("recovers a dispatch that mutates then throws and releases its new spawn constraint for the peer", async () => {
    const h = setup(); await h.begin("A", [westClaim(["ground", "entities"])]); await h.join("B", [eastClaim(["ground", "entities"])]);
    await h.paint("A", 1, 1); await h.paint("B", 5, 1, 1);
    const a = h.cell(1, 1), b = h.cell(5, 1);
    const dispatch = h.store.dispatch.bind(h.store);
    let thrown = false;
    h.store.dispatch = ((op: Op) => {
      const result = dispatch(op);
      if (!thrown && op.type === "addEntity" && op.entity.typeId === "spawn") {
        thrown = true; throw new Error("Injected observer failure after entity mutation");
      }
      return result;
    }) as typeof h.store.dispatch;
    try {
      error(await h.edit("A", "place_entity", { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 2, y: 1 } }), "INTERNAL_ERROR");
    } finally { h.store.dispatch = dispatch; }
    expect(thrown).toBe(true); expect(h.store.document.spawn()).toBeNull();
    expect(h.cell(1, 1)).toBe(a); expect(h.cell(5, 1)).toBe(b);
    const member = h.api.getState().transaction!.collaboration!.members.find(item => item.clientSessionId === "A")!;
    h.revisions.set("A", member.revision);
    await h.ok("B", "place_entity", { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 5, y: 1 } });
    await h.ok("A", "cancel_edit", { reason: "Only west" });
    expect(h.cell(1, 1)).toBe(0); expect(h.cell(5, 1)).toBe(b);
    expect(h.store.document.spawn()).toMatchObject({ x: 5 * 32, y: 32 });
  });

  it("restores original entity ordering without removing a peer's surviving additions", async () => {
    const h = setup({ entityTypes: [{ id: "tree", name: "Tree", color: "#008800", fields: [] }] });
    const initial = [{ id: "west-1", x: 32 }, { id: "east-1", x: 160 }, { id: "west-2", x: 64 }, { id: "east-2", x: 192 }];
    for (const item of initial) h.store.dispatch({ type: "addEntity", layerId: "entities", entity: { ...item, typeId: "tree", y: 32, fields: {} } });
    h.store.clearHistory();
    await h.begin("A", [westClaim(["entities"])]); await h.join("B", [eastClaim(["entities"])]);
    await h.ok("A", "edit_entity", { mapId: "map-1", entityId: "west-1", action: "remove" });
    await h.ok("B", "edit_entity", { mapId: "map-1", entityId: "east-1", action: "remove" });
    const added = await h.ok("B", "place_entity", { mapId: "map-1", layerId: "entities", typeId: "tree", at: { x: 7, y: 2 } });
    const { entity } = added.data as { entity: { id: string } };
    await h.ok("A", "cancel_edit", { reason: "Restore west" });
    expect(h.store.document.entityLayers()[0]!.entities.map(item => item.id)).toEqual(["west-1", "west-2", "east-2", entity.id]);
    await h.ok("B", "cancel_edit", { reason: "Restore east" });
    expect(h.store.document.entityLayers()[0]!.entities.map(item => item.id)).toEqual(initial.map(item => item.id));
  });

  it("blocks structural changes while collaborating and human discard restores the complete shared baseline", async () => {
    const h = setup(), before = h.host.snapshot(); await h.begin(); await h.join();
    await h.paint("A", 0, 0); await h.paint("B", 7, 7, 1);
    const draft = h.host.snapshot();
    error(await h.edit("B", "resize_map", { mapId: "map-1", width: 4, height: 4, allowCrop: true }), "EXCLUSIVE_OPERATION_REQUIRED");
    error(await h.edit("A", "edit_layer", { mapId: "map-1", action: "create", name: "Unreserved", kind: "tile" }), "EXCLUSIVE_OPERATION_REQUIRED");
    expect(h.host.snapshot()).toEqual(draft);
    await h.api.userAction("discard"); expect(h.host.snapshot()).toEqual(before);
    expect(h.host.history.undoDepth).toBe(0); expect(h.host.pins.size).toBe(0);
  });

  it("freezes structural preparation after the first spatial contribution so a later member rollback stays possible", async () => {
    const h = setup(); await h.begin(); await h.paint("A", 1, 1);
    const draft = h.host.snapshot();
    error(await h.edit("A", "edit_layer", { mapId: "map-1", action: "update", layerId: "ground", props: { locked: true } }), "EXCLUSIVE_OPERATION_REQUIRED");
    error(await h.edit("A", "resize_map", { mapId: "map-1", width: 4, height: 4, allowCrop: true }), "EXCLUSIVE_OPERATION_REQUIRED");
    expect(h.host.snapshot()).toEqual(draft);
    await h.join(); await h.paint("B", 5, 1);
    await h.ok("A", "cancel_edit", { reason: "Restore west safely" });
    expect(h.cell(1, 1)).toBe(0); expect(h.cell(5, 1)).not.toBe(0);
  });

  it("group lifetime expiry retains all contributions for a human approval", async () => {
    const h = setup(); await h.begin(); await h.join(); await h.paint("A", 1, 1); await h.paint("B", 5, 1, 1);
    const before = serializeLevel(h.store.document);
    h.host.clock.advance(AGENT_LIMITS.editLifetimeMs + 1);
    await Promise.resolve();
    expect(h.api.getState().phase).toBe("stopped");
    expect(serializeLevel(h.store.document)).toBe(before); expect(h.host.transactions.writeGate.blocked).toBe(true);
    await h.api.userAction("approve");
    expect(serializeLevel(h.store.document)).toBe(before); expect(h.host.history.undoDepth).toBe(1);
  });

  it("external source invalidation stops the group without erasing peers and requires an explicit human discard", async () => {
    const h = setup(), baseline = h.host.snapshot();
    await h.begin(); await h.join(); await h.paint("A", 1, 1); await h.paint("B", 5, 1, 1);
    const before = serializeLevel(h.store.document);
    h.host.contentChanged();
    await Promise.resolve();
    expect(h.api.getState().phase).toBe("stopped"); expect(serializeLevel(h.store.document)).toBe(before);
    await expect(h.api.userAction("approve")).rejects.toMatchObject({ code: "CANCELLED" });
    expect(serializeLevel(h.store.document)).toBe(before); expect(h.host.transactions.writeGate.blocked).toBe(true);
    await h.api.userAction("discard"); expect(h.host.snapshot()).toEqual(baseline);
    expect(h.host.transactions.writeGate.blocked).toBe(false);
  });

  it("a delayed read timeout preserves both the caller's prior work and its peer's work", async () => {
    const h = setup(); await h.begin(); await h.join(); await h.paint("A", 1, 1); await h.paint("B", 5, 1, 1);
    const before = serializeLevel(h.store.document), bRevision = h.revisions.get("B");
    const original = h.host.loadMap; let release: (() => void) | undefined;
    h.host.loadMap = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
    const reading = h.invoke("B", "get_map_info", { context: h.context(), mapId: "map-1" });
    await expect.poll(() => typeof release).toBe("function");
    try {
      h.host.clock.advance(AGENT_LIMITS.callTimeoutMs + 1);
      error(await reading, "TIMEOUT");
      expect(serializeLevel(h.store.document)).toBe(before); expect(h.api.getState().phase).toBe("running");
      expect(h.api.getState().transaction!.collaboration!.members.find(member => member.clientSessionId === "B")!.revision).toBe(bRevision);
    } finally { h.host.loadMap = original; release?.(); }
    await h.paint("B", 6, 1, 2);
  });

  it("disconnect during a delayed write clears the departed member identity after own-only cleanup", async () => {
    const h = setup(); await h.begin("A", [westClaim(["ground", "entities"])]); await h.join();
    await h.paint("A", 1, 1); await h.paint("B", 5, 1, 1);
    const portal = await h.ok("A", "place_entity", { mapId: "map-1", layerId: "entities", typeId: "portal", at: { x: 2, y: 2 },
      fields: { targetLevel: "map-1", targetPoint: { x: 32, y: 32 } } });
    const { entity } = portal.data as { entity: { id: string } };
    const memberId = h.api.getState().transaction!.collaboration!.members.find(member => member.clientSessionId === "A")!.id;
    const peer = h.cell(5, 1), original = h.host.loadMap; let release: (() => void) | undefined;
    h.host.loadMap = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
    const writing = h.edit("A", "edit_entity", { mapId: "map-1", entityId: entity.id, action: "update", fields: { targetPoint: { x: 64, y: 64 } } });
    await expect.poll(() => typeof release).toBe("function");
    try {
      const ended = h.api.sessionEnded("A");
      error(await writing, "CANCELLED"); await ended;
      expect(h.api.getState().transaction!.collaboration!.members.find(member => member.id === memberId)).toMatchObject({
        clientSessionId: null, detached: true, state: "cancelled",
      });
      expect(h.cell(1, 1)).toBe(0); expect(h.cell(5, 1)).toBe(peer); expect(h.store.document.findEntity(entity.id)).toBeUndefined();
    } finally { h.host.loadMap = original; release?.(); }
    await h.paint("B", 6, 1, 2);
  });
});
