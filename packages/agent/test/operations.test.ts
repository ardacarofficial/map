import { describe, expect, it } from "vitest";
import { serializeLevel } from "@smap/core";
import { AGENT_LIMITS, type BatchOperation } from "../src/contracts";
import { error, harness, stamp, success, tile } from "./helpers";

const paint = (x: number, y: number): BatchOperation => ({ tool: "paint_cells", args: { mapId: "map-1", layerId: "ground", cells: [{ x, y, value: tile }] } });
const house = (x: number, y: number): BatchOperation => ({ tool: "place_stamp", args: { mapId: "map-1", stampId: "house", at: { x, y }, layerMapping: [{ sourceLayerId: "base", targetLayerId: "ground" }] } });
const spawn: BatchOperation = { tool: "place_entity", args: { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 0, y: 0 } } };

describe("bounded operation batches", () => {
  it("matches sequential edits, replays once and approves as one reversible world action", async () => {
    const batch = harness({ stamps: [stamp] }), sequential = harness({ stamps: [stamp] });
    const before = serializeLevel(batch.host.stores.get("map-1")!.document);
    const operations = [paint(0, 0), house(1, 2), house(4, 2), spawn];
    await batch.begin(); await sequential.begin();
    const args = { context: batch.writeContext(), operations };
    const result = success(await batch.run("apply_operations", args));
    expect(result).toMatchObject({ changed: 5, items: operations.map(op => ({ tool: op.tool })) });
    expect(batch.api.getState().transaction!.counters.mutationCalls).toBe(4);
    success(await batch.run("apply_operations", args));
    for (const operation of operations) success(await sequential.edit(operation.tool, operation.args));
    const after = serializeLevel(batch.host.stores.get("map-1")!.document);
    expect(after).toBe(serializeLevel(sequential.host.stores.get("map-1")!.document));
    expect(batch.host.stores.get("map-1")!.document.entityLayers()[0]!.entities).toHaveLength(1);
    await batch.api.userAction("approve");
    expect(batch.host.history.undoDepth).toBe(1);
    batch.host.history.undo(); expect(serializeLevel(batch.host.stores.get("map-1")!.document)).toBe(before);
    batch.host.history.redo(); expect(serializeLevel(batch.host.stores.get("map-1")!.document)).toBe(after);
  });

  it("a late invalid child and a second spawn preserve earlier surrounding work and every counter", async () => {
    const h = harness(); await h.begin(); success(await h.edit("paint_cells", paint(5, 5).args));
    const before = serializeLevel(h.host.stores.get("map-1")!.document), state = h.api.getState();
    error(await h.edit("apply_operations", { operations: [paint(0, 0), { ...spawn, args: { ...spawn.args, typeId: "missing" } }] }), "UNKNOWN_ID");
    expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(before);
    expect(h.api.getState()).toEqual(state);
    error(await h.edit("apply_operations", { operations: [spawn, spawn] }), "ENTITY_SCHEMA");
    expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(before);
    expect(h.api.getState()).toEqual(state);
  });

  it("preflights sequential entity removal dependencies and preserves the existing entity on a late error", async () => {
    const h = harness(); await h.begin();
    const placed = { entity: { id: success(await h.edit("place_entity", spawn.args)).created!.entityIds![0]! } };
    const before = serializeLevel(h.host.stores.get("map-1")!.document), state = h.api.getState();
    error(await h.edit("apply_operations", { operations: [
      { tool: "edit_entity", args: { mapId: "map-1", entityId: placed.entity.id, action: "remove" } },
      { tool: "edit_entity", args: { mapId: "map-1", entityId: placed.entity.id, action: "move", at: { x: 1, y: 1 } } },
    ] }), "UNKNOWN_ID");
    expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(before); expect(h.api.getState()).toEqual(state);
  });

  it("checks aggregate cell/mutation budgets and existing stamp layer mapping before changing anything", async () => {
    const h = harness({ width: 256, height: 256, stamps: [stamp] }); await h.begin();
    const before = serializeLevel(h.host.stores.get("map-1")!.document), revision = h.api.getState().revision;
    // Uniform children may be large, but one batch is capped at batchCells aggregate planned cells.
    const rect = { tool: "paint_rect", args: { mapId: "map-1", layerId: "ground", region: { x: 0, y: 0, width: 256, height: 256 }, value: tile } };
    error(await h.edit("apply_operations", { operations: [rect, paint(65, 0)] }), "LIMIT_EXCEEDED");
    error(await h.edit("apply_operations", { operations: [{ tool: "place_stamp", args: { mapId: "map-1", stampId: "house", at: { x: 0, y: 0 } } }] }), "INVALID_ARGUMENT");
    for (let i = 0; i < AGENT_LIMITS.mutationCalls - 1; i++) success(await h.edit("paint_cells", paint(0, 0).args));
    const limited = h.api.getState();
    error(await h.edit("apply_operations", { operations: [paint(1, 0), paint(2, 0)] }), "LIMIT_EXCEEDED");
    expect(h.api.getState()).toEqual(limited);
    expect(h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(1, 0)).toBe(0);
    await h.api.userAction("discard");
    expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(before);
    expect(h.api.getState().revision).toBeGreaterThan(revision);
  }, 60000);

  it("loads portal targets only during preflight and replays overlapping writes against real old cells", async () => {
    const h = harness(); await h.begin();
    success(await h.edit("paint_cells", paint(0, 0).args));
    let loads = 0;
    const load = h.host.loadMap;
    h.host.loadMap = async id => { loads++; if (loads > 1) throw new Error("Live replay must not load portal maps"); return load(id); };
    const result = success(await h.edit("apply_operations", { operations: [paint(0, 0), { tool: "place_entity", args: { mapId: "map-1", layerId: "entities", typeId: "portal", at: { x: 1, y: 0 }, fields: { targetLevel: "map-1", targetPoint: { x: 0, y: 0 } } } }] }));
    expect(loads).toBe(1);
    expect(result).toMatchObject({ changed: 0, items: [{ changed: 0 }, { tool: "place_entity" }] });
  });

  it("stopping during asynchronous preflight retains surrounding work without a partial batch", async () => {
    const h = harness(); await h.begin(); success(await h.edit("paint_cells", paint(5, 5).args));
    const before = serializeLevel(h.host.stores.get("map-1")!.document), counters = h.api.getState().transaction!.counters;
    let loading = false;
    h.host.loadMap = () => { loading = true; return new Promise(() => {}); };
    const pending = h.edit("apply_operations", { operations: [paint(0, 0), { tool: "place_entity", args: { mapId: "map-1", layerId: "entities", typeId: "portal", at: { x: 1, y: 0 }, fields: { targetLevel: "map-1", targetPoint: { x: 0, y: 0 } } } }] });
    for (let i = 0; i < 20 && !loading; i++) await Promise.resolve();
    expect(loading).toBe(true);
    const stop = h.api.userAction("stop");
    error(await pending, "CANCELLED"); await stop;
    expect(h.api.getState().phase).toBe("stopped");
    expect(h.api.getState().transaction!.counters).toEqual(counters);
    expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(before);
  });

  it("validates portal destinations during preflight and removes entities idempotently", async () => {
    const h = harness(); await h.begin();
    error(await h.edit("apply_operations", { operations: [paint(0, 0), { tool: "place_entity", args: { mapId: "map-1", layerId: "entities", typeId: "portal", at: { x: 0, y: 0 }, fields: { targetLevel: "map-1", targetPoint: { x: 9999, y: 0 } } } }] }), "ENTITY_SCHEMA");
    expect(h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(0, 0)).toBe(0);
    const entity = { entity: { id: success(await h.edit("place_entity", spawn.args)).created!.entityIds![0]! } };
    const args = { context: h.writeContext(), operations: [{ tool: "edit_entity", args: { mapId: "map-1", entityId: entity.entity.id, action: "remove" } }] };
    success(await h.run("apply_operations", args)); success(await h.run("apply_operations", args));
    expect(h.host.stores.get("map-1")!.document.spawn()).toBe(null);
  });
});

describe("existing entity correction", () => {
  it("moves the same spawn ID, updates valid portal fields and discards/undoes corrections", async () => {
    const h = harness(); await h.begin();
    const spawnData = { entity: { id: success(await h.edit("place_entity", spawn.args)).created!.entityIds![0]! } };
    const portal = { entity: { id: success(await h.edit("place_entity", { ...spawn.args, typeId: "portal", at: { x: 1, y: 1 } })).created!.entityIds![0]! } };
    await h.api.userAction("approve");
    const initial = serializeLevel(h.host.stores.get("map-1")!.document); await h.begin();
    success(await h.edit("edit_entity", { mapId: "map-1", entityId: spawnData.entity.id, action: "move", at: { x: 2, y: 3 } }));
    expect(h.host.stores.get("map-1")!.document.spawn()).toMatchObject({ id: spawnData.entity.id, x: 64, y: 96 });
    error(await h.edit("place_entity", spawn.args), "ENTITY_SCHEMA");
    success(await h.edit("edit_entity", { mapId: "map-1", entityId: portal.entity.id, action: "update", fields: { targetLevel: "map-1", targetPoint: { x: 64, y: 96 } } }));
    const revision = h.api.getState().revision;
    error(await h.edit("edit_entity", { mapId: "map-1", entityId: portal.entity.id, action: "update", fields: { targetPoint: { x: 9999, y: 0 } } }), "ENTITY_SCHEMA");
    error(await h.edit("edit_entity", { mapId: "map-1", entityId: portal.entity.id, action: "update", fields: { unknown: "x" } }), "ENTITY_SCHEMA");
    expect(h.api.getState().revision).toBe(revision);
    const modified = serializeLevel(h.host.stores.get("map-1")!.document);
    await h.api.userAction("approve"); h.host.history.undo(); expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(initial);
    h.host.history.redo(); expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(modified);
    await h.begin(); success(await h.edit("edit_entity", { mapId: "map-1", entityId: spawnData.entity.id, action: "remove" }));
    await h.api.userAction("discard"); expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(modified);
  });

  it("keeps layer membership when reading entities from two requested layers", async () => {
    const h = harness(); await h.begin();
    success(await h.edit("place_entity", spawn.args));
    const created = { layer: { id: success(await h.edit("edit_layer", { mapId: "map-1", action: "create", name: "Doors", kind: "entity" })).created!.layerIds![0]! } };
    success(await h.edit("place_entity", { ...spawn.args, layerId: created.layer.id, typeId: "portal", at: { x: 1, y: 1 } }));
    const read = success(await h.read("read_region", { mapId: "map-1", region: { x: 0, y: 0, width: 4, height: 4 }, layerIds: ["entities", created.layer.id], includeEntities: true }));
    expect(read.data).toMatchObject({ entities: [{ typeId: "spawn", layerId: "entities" }, { typeId: "portal", layerId: created.layer.id }] });
  });

  it("honors initial locked/hidden protection until this draft unlocks/shows the layer itself", async () => {
    for (const props of [{ locked: true }, { visible: false }]) {
      const h = harness(); await h.begin();
      const entity = { entity: { id: success(await h.edit("place_entity", spawn.args)).created!.entityIds![0]! } };
      success(await h.edit("edit_layer", { mapId: "map-1", action: "update", layerId: "entities", props }));
      await h.api.userAction("approve"); await h.begin();
      error(await h.edit("edit_entity", { mapId: "map-1", entityId: entity.entity.id, action: "remove" }), "locked" in props ? "LAYER_LOCKED" : "LAYER_HIDDEN");
      expect(h.host.stores.get("map-1")!.document.spawn()!.id).toBe(entity.entity.id);
      success(await h.edit("edit_layer", { mapId: "map-1", action: "update", layerId: "entities", props: { locked: false, visible: true } }));
      success(await h.edit("edit_entity", { mapId: "map-1", entityId: entity.entity.id, action: "remove" }));
      expect(h.host.stores.get("map-1")!.document.spawn()).toBeFalsy();
      await h.api.userAction("discard");
      expect(h.host.stores.get("map-1")!.document.spawn()!.id).toBe(entity.entity.id);
    }
  });
});
