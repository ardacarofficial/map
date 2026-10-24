import { expect, it } from "vitest";
import { cellFlags, FLIP_D, FLIP_H, serializeLevel, serializeStamp } from "@smap/core";
import { AGENT_LIMITS } from "../src/contracts";
import { error, harness, stamp, success, tile } from "./helpers";

const source = { mapId: "map-1", layerIds: ["collision", "ground"],
  region: { x: 1, y: 1, width: 2, height: 1 } };

it("captures explicit map layers, palette and flags as a reusable tentative stamp, with idempotent replay", async () => {
  const h = harness({ stamps: [stamp] }), before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground",
    cells: [{ x: 1, y: 1, value: { ...tile, flags: 5 } }] }));
  success(await h.edit("paint_cells", { mapId: "map-1", layerId: "collision",
    cells: [{ x: 2, y: 1, value: { collision: 2 } }] }));
  const args = { context: h.writeContext(), source, name: " House ", category: " Buildings ", tags: ["home", " home ", " "] };
  const created = success(await h.run("create_stamp", args));
  expect(created).toMatchObject({ tentative: true, data: { stampId: "house-2", name: "House",
    width: 2, height: 1, sourceLayerIds: ["ground", "collision"] } });
  const captured = h.host.world.stamps().find(s => s.id === "house-2")!;
  expect(captured).toMatchObject({ category: "Buildings", tags: ["home"], palette: [tile] });
  expect(cellFlags(captured.layers[0]!.cells[0]!)).toBe((FLIP_H | FLIP_D) >>> 0);
  expect([...captured.layers[1]!.cells]).toEqual([0, 2]);
  const capturedText = serializeStamp(captured);
  const replay = success(await h.run("create_stamp", args));
  expect(replay).toMatchObject({ replayed: true, data: { stampId: "house-2" } });
  expect(h.host.world.stamps()).toHaveLength(2);
  const listed = success(await h.read("list_stamps", { query: "House", previewStampId: "house-2" }));
  expect(listed.data).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: "house-2", tags: ["home"] })]) });
  success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", cells: [{ x: 1, y: 1, value: null }] }));
  expect(serializeStamp(captured)).toBe(capturedText);
  success(await h.edit("place_stamp", { mapId: "map-1", stampId: "house-2", at: { x: 4, y: 4 } }));
  expect(h.host.stores.get("map-1")!.document.getLayer("collision")!.getCell(5, 4)).toBe(2);
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
  error(await h.read("list_stamps", { previewStampId: "house-2" }), "UNKNOWN_ID");
});

it("stamp-only approval is one world undo action and redo restores the library", async () => {
  const h = harness(), store = h.host.stores.get("map-1")!, before = serializeLevel(store.document);
  await h.begin();
  success(await h.edit("create_stamp", { name: "CON", source: {
    tilesetId: "tiles", region: { x: 2, y: 3, width: 2, height: 2 },
  } }));
  const captured = h.host.world.stamps()[0]!;
  expect(captured.id).toBe("con-2");
  expect(captured.palette.map(p => p.tileId)).toEqual([26, 27, 34, 35]);
  success(await h.edit("finish_edit"));
  expect(h.host.history.undoDepth).toBe(0);
  expect(() => h.host.transactions.writeGate.assertSaveAllowed(h.context().worldSessionId)).toThrow();
  await h.api.userAction("approve");
  expect(h.host.history.undoDepth).toBe(1);
  expect(store.undoDepth).toBe(0);
  expect(serializeLevel(store.document)).toBe(before);
  h.host.history.undo();
  expect(h.host.world.stamps()).toHaveLength(0);
  h.host.history.redo();
  expect(h.host.world.stamps()).toEqual([captured]);
  expect(serializeLevel(store.document)).toBe(before);
});

it("paint and capture approval share a single undo entry, including two captures", async () => {
  const h = harness(), before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: source.region, value: tile }));
  for (let i = 0; i < 2; i++) success(await h.edit("create_stamp", { source, name: "House" }));
  success(await h.edit("finish_edit"));
  await h.api.userAction("approve");
  expect(h.host.history.undoDepth).toBe(1);
  expect(h.host.world.stamps().map(s => s.id)).toEqual(["house", "house-2"]);
  h.host.history.undo();
  expect(h.host.world.stamps()).toEqual([]);
  expect(h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(1, 1)).toBe(0);
  h.host.history.redo();
  expect(h.host.world.stamps()).toHaveLength(2);
  expect(h.host.snapshot()).not.toEqual(before);
});

it.each(["disconnect", "timeout"])("running stamp creation is kept for human review on %s; discard restores", async outcome => {
  const h = harness(), before = h.host.snapshot();
  await h.begin();
  success(await h.edit("create_stamp", { name: "Tree", source: { tilesetId: "tiles", region: source.region } }));
  const drafted = h.host.snapshot();
  if (outcome === "disconnect") await h.api.sessionEnded("client-1");
  else h.host.clock.advance(AGENT_LIMITS.editLifetimeMs + 1);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(h.api.getState().phase).toBe("orphaned");
  expect(h.api.getState().transaction!.cause).toBe(outcome === "disconnect" ? "clientDisconnected" : "leaseExpired");
  expect(h.host.snapshot()).toEqual(drafted);
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
});

it("capture preflights missing, duplicate, entity, empty and outside sources without metadata mutation", async () => {
  const h = harness();
  await h.begin();
  const before = h.host.snapshot();
  for (const [badSource, code] of [
    [{ ...source, layerIds: ["missing"] }, "UNKNOWN_ID"],
    [{ ...source, mapId: "missing" }, "UNKNOWN_ID"],
    [{ ...source, layerIds: ["entities"] }, "LAYER_KIND"],
    [{ ...source, layerIds: ["ground", "ground"] }, "INVALID_ARGUMENT"],
    [{ ...source, layerIds: [] }, "INVALID_ARGUMENT"],
    [source, "INVALID_ARGUMENT"],
    [{ ...source, region: { x: 15, y: 0, width: 2, height: 1 } }, "OUT_OF_BOUNDS"],
    [{ tilesetId: "missing", region: source.region }, "UNKNOWN_ID"],
    [{ tilesetId: "tiles", region: { x: 7, y: 0, width: 2, height: 1 } }, "OUT_OF_BOUNDS"],
    [{ tilesetId: "tiles", region: { x: -1, y: 0, width: 1, height: 1 } }, "INVALID_ARGUMENT"],
  ] as const) error(await h.edit("create_stamp", { name: "House", source: badSource }), code);
  error(await h.edit("create_stamp", { name: " ", source: { tilesetId: "tiles", region: source.region } }), "INVALID_ARGUMENT");
  expect(h.host.snapshot()).toEqual(before);
});

it("capture bounds total cells across layers before allocating stamp buffers", async () => {
  const h = harness({ width: 128, height: 128 });
  await h.begin();
  const before = h.host.snapshot();
  error(await h.edit("create_stamp", { name: "Oversized", source: {
    mapId: "map-1", layerIds: ["ground", "collision"],
    region: { x: 0, y: 0, width: 64, height: 64 },
  } }), "LIMIT_EXCEEDED");
  expect(h.host.snapshot()).toEqual(before);
  expect(h.api.getState().transaction!.counters).toMatchObject({ mutationCalls: 0, retainedBytes: 0 });
});

it("rejects unallocated edited-atlas slots, including a mixed selection, while preserving pending work", async () => {
  const h = harness({ tilesets: [{
    id: "edited", name: "Edited", imagePath: "tilesets/edited.png",
    tileWidth: 32, tileHeight: 32, columns: 16, rows: 2, margin: 0, spacing: 0,
    edited: { kind: "pixel", layoutVersion: 1, nextTileId: 18,
      contentHash: "a".repeat(64), origins: [] },
  }] }), initial = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground",
    cells: [{ x: 0, y: 0, value: { tilesetId: "edited", tileId: 17 } }] }));
  const before = h.host.snapshot(), counters = { ...h.api.getState().transaction!.counters };
  for (const region of [
    { x: 2, y: 1, width: 1, height: 1 },
    { x: 1, y: 1, width: 2, height: 1 },
  ]) {
    error(await h.edit("create_stamp", { name: "Tail", source: { tilesetId: "edited", region } }), "UNKNOWN_ID");
    expect(h.host.snapshot()).toEqual(before);
    expect(h.api.getState().transaction!.counters).toEqual(counters);
  }
  success(await h.edit("create_stamp", { name: "Last tile", source: {
    tilesetId: "edited", region: { x: 1, y: 1, width: 1, height: 1 },
  } }));
  const captured = h.host.world.stamps()[0]!;
  expect(captured.palette).toEqual([{ tilesetId: "edited", tileId: 17 }]);
  success(await h.edit("place_stamp", { mapId: "map-1", stampId: captured.id,
    at: { x: 2, y: 0 }, layerMapping: [{ sourceLayerId: captured.layers[0]!.layerId, targetLayerId: "ground" }] }));
  const ground = h.host.stores.get("map-1")!.document.getLayer("ground")!;
  expect(ground.getCell(2, 0)).toBe(ground.getCell(0, 0));
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(initial);
});

it("world undo/redo preserves later independent changes to unrelated library stamps", async () => {
  const h = harness({ stamps: [stamp] });
  await h.begin();
  success(await h.edit("create_stamp", { name: "AI creation", source: { tilesetId: "tiles", region: source.region } }));
  await h.api.userAction("approve");
  const created = h.host.world.stamps().find(s => s.id === "ai-creation")!,
    renamed = { ...stamp, name: "Renamed original", favorite: true },
    manual = { ...stamp, id: "manual", name: "Manual creation" };
  h.host.metadata.stage({ kind: "stamps", before: h.host.world.stamps(), after: [renamed, manual, { ...created, name: "Renamed AI" }] });
  h.host.history.undo();
  expect(h.host.world.stamps()).toEqual([renamed, manual]);
  h.host.history.redo();
  expect(h.host.world.stamps()).toEqual([renamed, manual, created]);
});
