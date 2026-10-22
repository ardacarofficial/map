import { describe, expect, it, vi } from "vitest";
import { MapStore, createDocument, parseLevel, serializeLevel, type EntityType } from "@smap/core";
import fc from "fast-check";
import type { ToolData } from "../src/contracts";
import { error, harness, success } from "./helpers";

const custom: EntityType = { id: "npc", name: "NPC", color: "#aabbcc", fields: [] };

function staleDefault(defaultValue: string | null) {
  const h = harness({ entityTypes: [custom] }), store = h.host.stores.get("map-1")!;
  store.dispatch({ type: "addEntity", layerId: "entities", entity: { id: "npc-1", typeId: "npc", x: 0, y: 0 } });
  // Editing a type preserves existing entities; exporters resolve omitted fields to their new defaults.
  store.dispatch({ type: "defineEntityType", entityType: { ...custom, fields: [{ name: "destination", type: "levelRef", default: defaultValue }] } });
  return h;
}

describe("map validation uses current entity and destination semantics", () => {
  it.each([null, "map-1"])("accepts an omitted level reference with valid default %s", async defaultValue => {
    const h = staleDefault(defaultValue);
    const result = success(await h.read("validate_map", { mapId: "map-1" })).data;
    expect(result).toMatchObject({ valid: true, issues: [], nextCursor: null });
    await h.begin();
    const before = serializeLevel(h.host.stores.get("map-1")!.document);
    success(await h.edit("edit_entity", { mapId: "map-1", entityId: "npc-1", action: "move", at: { x: 1, y: 1 } }));
    await h.api.userAction("discard");
    expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(before);
  });

  it("checks a missing level referenced by an omitted default", async () => {
    const h = staleDefault("deleted");
    expect(success(await h.read("validate_map", { mapId: "map-1" })).data).toMatchObject({
      valid: false, issues: [{ code: "PORTAL_TARGET", entityId: "npc-1" }],
    });
  });

  it("moves an imported unconfigured portal whose built-in fields are omitted", async () => {
    const source = harness().host.stores.get("map-1")!;
    source.dispatch({ type: "addEntity", layerId: "entities", entity: { id: "portal", typeId: "portal", x: 0, y: 0 } });
    const data = JSON.parse(serializeLevel(source.document));
    data.layers.find((layer: { type: string }) => layer.type === "entity").entities[0].fields = [];
    const store = new MapStore(parseLevel(JSON.stringify(data), source.document.tilesets));
    const h = harness({ maps: [{ id: "map-1", store }] });
    expect(success(await h.read("validate_map", { mapId: "map-1" })).data).toMatchObject({ valid: true, issues: [] });
    await h.begin();
    success(await h.edit("edit_entity", { mapId: "map-1", entityId: "portal", action: "move", at: { x: 1, y: 1 } }));
    success(await h.edit("edit_entity", { mapId: "map-1", entityId: "portal", action: "update", fields: { targetLevel: "map-1" } }));
    await h.api.userAction("discard");
    expect(store.document.findEntity("portal")!.entity).toMatchObject({ x: 0, y: 0, fields: {} });
  });

  it("finds portal destinations made invalid by a target resize, including half-open pixel edges", async () => {
    const target = new MapStore(createDocument({ width: 3, height: 4, tileWidth: 8, tileHeight: 16 }));
    const h = harness({ maps: [{ id: "map-1", store: harness().host.stores.get("map-1")! }, { id: "target", store: target }] });
    const store = h.host.stores.get("map-1")!;
    for (const [id, x, y] of [["inside", 15, 47], ["right", 16, 0], ["bottom", 0, 48], ["negative", -1, 0]] as const)
      store.dispatch({ type: "addEntity", layerId: "entities", entity: { id, typeId: "portal", x: 0, y: 0, fields: { targetLevel: "target", targetPoint: { x, y } } } });
    target.dispatch({ type: "resizeMap", width: 2, height: 3 });
    const before = serializeLevel(store.document);
    const result = success(await h.read("validate_map", { mapId: "map-1" })).data as ToolData["validate_map"];
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => [issue.code, issue.entityId])).toEqual([
      ["PORTAL_TARGET", "right"], ["PORTAL_TARGET", "bottom"], ["PORTAL_TARGET", "negative"],
    ]);
    expect(serializeLevel(store.document)).toBe(before);
  });

  it("loads an uncached target once for all portals on a page", async () => {
    const target = new MapStore(createDocument({ width: 2, height: 2 }));
    const h = harness({ maps: [{ id: "map-1", store: harness().host.stores.get("map-1")! }, { id: "target", store: target }] }), store = h.host.stores.get("map-1")!;
    for (let i = 0; i < 3; i++)
      store.dispatch({ type: "addEntity", layerId: "entities", entity: { id: `portal-${i}`, typeId: "portal", x: 0, y: 0, fields: { targetLevel: "target", targetPoint: { x: 512, y: 0 } } } });
    const maps = h.host.world.maps;
    h.host.world.maps = () => maps().map(({ width: _width, height: _height, tileWidth: _tileWidth, tileHeight: _tileHeight, ...rest }) => rest);
    const load = vi.spyOn(h.host, "loadMap");
    const page = success(await h.read("validate_map", { mapId: "map-1" })).data as ToolData["validate_map"];
    expect(page.issues.map(issue => issue.entityId)).toEqual(["portal-0", "portal-1", "portal-2"]);
    expect(page.valid).toBe(false);
    expect(load.mock.calls).toEqual([["map-1"], ["target"]]);
  });

  it("cannot report integrity when an existing target cannot be loaded", async () => {
    const h = harness({ maps: [{ id: "map-1", store: harness().host.stores.get("map-1")! }, { id: "target", store: new MapStore(createDocument({ width: 2, height: 2 })) }] });
    h.host.stores.get("map-1")!.dispatch({ type: "addEntity", layerId: "entities", entity: { typeId: "portal", x: 0, y: 0, fields: { targetLevel: "target", targetPoint: { x: 0, y: 0 } } } });
    const maps = h.host.world.maps;
    h.host.world.maps = () => maps().map(map => map.id === "target" ? { ...map, width: null, height: null } : map);
    const load = h.host.loadMap;
    h.host.loadMap = async id => { if (id === "target") throw new Error("Target file is unreadable"); return load(id); };
    error(await h.read("validate_map", { mapId: "map-1" }), "INTERNAL_ERROR");
  });

  it("agrees with pixel bounds for generated target sizes and boundary positions", async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({ width: fc.integer({ min: 1, max: 32 }), height: fc.integer({ min: 1, max: 32 }), tileWidth: fc.integer({ min: 1, max: 64 }), tileHeight: fc.integer({ min: 1, max: 64 }) }),
      fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 }),
      async (dimensions, xi, yi) => {
        const target = new MapStore(createDocument(dimensions));
        const h = harness({ maps: [{ id: "map-1", store: harness().host.stores.get("map-1")! }, { id: "target", store: target }] });
        const width = dimensions.width * dimensions.tileWidth, height = dimensions.height * dimensions.tileHeight;
        const x = [-1, 0, width - 1, width, width + 1][xi]!, y = [-1, 0, height - 1, height, height + 1][yi]!;
        h.host.stores.get("map-1")!.dispatch({ type: "addEntity", layerId: "entities", entity: { typeId: "portal", x: 0, y: 0, fields: { targetLevel: "target", targetPoint: { x, y } } } });
        const result = success(await h.read("validate_map", { mapId: "map-1" })).data as ToolData["validate_map"];
        expect(result.valid).toBe(x >= 0 && y >= 0 && x < width && y < height);
        await h.api.dispose();
      },
    ), { seed: 693804, numRuns: 64 });
  });

  it("preserves issue limits and earlier failures across pages with many references on one entity", async () => {
    const h = staleDefault("deleted"), store = h.host.stores.get("map-1")!;
    store.dispatch({ type: "defineEntityType", entityType: { ...custom, fields: Array.from({ length: 3 }, (_, i) => ({ name: `target-${i}`, type: "levelRef" as const, default: "deleted" })) } });
    let cursor: string | undefined;
    const issues: string[] = [];
    do {
      const page = success(await h.read("validate_map", { mapId: "map-1", limit: 1, ...(cursor ? { cursor } : {}) })).data as ToolData["validate_map"];
      expect(page.issues.length).toBeLessThanOrEqual(1);
      issues.push(...page.issues.map(issue => issue.entityId!));
      cursor = page.nextCursor ?? undefined;
      if (!cursor) expect(page.valid).toBe(false);
    } while (cursor);
    expect(issues).toEqual(["npc-1", "npc-1", "npc-1"]);
  });
});
