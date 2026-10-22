import { describe, expect, it } from "vitest";
import { type GoalCheck, type ToolData } from "../src/contracts";
import { error, harness, success, tile } from "./helpers";

const region = { x: 0, y: 0, width: 5, height: 3 };
const connection: GoalCheck = { kind: "reachability", region, from: { x: 0, y: 1 }, to: { x: 4, y: 1 }, collisionLayerIds: ["collision"], blockedValues: [1], emptyIsBlocked: false };
const capture: GoalCheck = { kind: "region_unchanged", region, layerIds: ["ground", "collision", "entities"] };
const inspect = async (h: ReturnType<typeof harness>, checks: GoalCheck[]) => success(await h.read("validate_goals", { mapId: "map-1", checks })).data as ToolData["validate_goals"];

describe("explicit map goals", () => {
  it("detects a broken bridge despite structural validity, then passes after repair", async () => {
    const h = harness(); await h.begin();
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "collision", region: { x: 2, y: 0, width: 1, height: 3 }, value: { collision: 1 } }));
    expect(success(await h.read("validate_map", { mapId: "map-1" })).data).toMatchObject({ valid: true });
    expect(await inspect(h, [connection])).toMatchObject({ valid: false, checks: [{ passed: false }] });
    success(await h.edit("paint_cells", { mapId: "map-1", layerId: "collision", cells: [{ x: 2, y: 1, value: { collision: 2 } }] }));
    expect(await inspect(h, [connection])).toMatchObject({ valid: true, checks: [{ passed: true }] });
  });

  it("requires explicit empty-cell semantics and respects map stack order for nonzero decisions", async () => {
    const h = harness();
    expect(await inspect(h, [{ ...connection, emptyIsBlocked: true }])).toMatchObject({ valid: false });
    await h.begin();
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "collision", region, value: { collision: 1 } }));
    const created = success(await h.edit("edit_layer", { mapId: "map-1", action: "create", name: "Bridge", kind: "collision" })).data as ToolData["edit_layer"];
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: created.layer.id, region: { x: 0, y: 1, width: 5, height: 1 }, value: { collision: 2 } }));
    expect(await inspect(h, [{ ...connection, collisionLayerIds: [created.layer.id, "collision"] }])).toMatchObject({ valid: true });
    expect(await inspect(h, [{ ...connection, collisionLayerIds: ["collision", created.layer.id], blockedValues: [2] }])).toMatchObject({ valid: false });
    error(await h.read("validate_goals", { mapId: "map-1", checks: [{ ...connection, collisionLayerIds: ["ground"] }] }), "LAYER_KIND");
    const { emptyIsBlocked: _empty, ...missingRule } = connection;
    error(await h.read("validate_goals", { mapId: "map-1", checks: [missingRule] }), "INVALID_ARGUMENT");
  });

  it("captures a bound region digest, ignores unrelated palette appends and detects tile/entity changes", async () => {
    const h = harness();
    const baseline = await inspect(h, [capture]);
    expect(baseline.valid).toBeNull(); expect(baseline.checks[0]!.passed).toBeNull();
    const expectedDigest = baseline.checks[0]!.digest!, check = { ...capture, expectedDigest };
    await h.begin();
    success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", cells: [{ x: 10, y: 10, value: tile }] }));
    expect(await inspect(h, [check])).toMatchObject({ valid: true });
    success(await h.edit("place_entity", { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 1, y: 1 } }));
    expect(await inspect(h, [check])).toMatchObject({ valid: false });
    await h.api.userAction("discard");
    expect(await inspect(h, [check])).toMatchObject({ valid: true });
    await h.begin(); success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", cells: [{ x: 0, y: 0, value: tile }] }));
    expect(await inspect(h, [check])).toMatchObject({ valid: false });
    expect(await inspect(h, [{ ...check, region: { ...region, x: 1 } }])).toMatchObject({ valid: false });
  });

  it("counts only requested entity types/layers/region and keeps all checks read-only", async () => {
    const h = harness(); await h.begin();
    success(await h.edit("place_entity", { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 1, y: 1 } }));
    success(await h.edit("place_entity", { mapId: "map-1", layerId: "entities", typeId: "portal", at: { x: 10, y: 10 } }));
    const before = h.host.snapshot(), state = h.api.getState();
    const count: GoalCheck = { kind: "entity_count", region, layerIds: ["entities"], typeId: "spawn", min: 1, max: 1 };
    expect(await inspect(h, [count])).toMatchObject({ valid: true, checks: [{ count: 1 }] });
    expect(await inspect(h, [{ ...count, min: 2, max: 2 }])).toMatchObject({ valid: false, checks: [{ count: 1 }] });
    error(await h.read("validate_goals", { mapId: "map-1", checks: [{ ...count, min: 2, max: 1 }] }), "INVALID_ARGUMENT");
    error(await h.read("validate_goals", { mapId: "map-1", checks: [{ ...count, typeId: "missing" }] }), "UNKNOWN_ID");
    expect(h.host.snapshot()).toEqual(before); expect(h.api.getState()).toEqual(state);
  });

  it("rejects out-of-region endpoints and cumulative work above the normal read budget", async () => {
    const h = harness({ width: 128, height: 128 });
    error(await h.read("validate_goals", { mapId: "map-1", checks: [{ ...connection, to: { x: 5, y: 1 } }] }), "OUT_OF_BOUNDS");
    const large: GoalCheck = { ...capture, region: { x: 0, y: 0, width: 64, height: 64 }, layerIds: ["ground"] };
    error(await h.read("validate_goals", { mapId: "map-1", checks: Array.from({ length: 5 }, () => large) }), "LIMIT_EXCEEDED");
    error(await h.read("validate_goals", { mapId: "map-1", checks: [{ ...capture, region: { x: 0, y: 0, width: 128, height: 128 } }] }), "LIMIT_EXCEEDED");
  });
});
