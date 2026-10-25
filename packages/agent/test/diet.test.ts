import { describe, expect, it } from "vitest";
import { ESSENTIAL_LIMITS } from "../src/contracts";
import { error, harness, stamp, success, tile } from "./helpers";

const cell = (h: ReturnType<typeof harness>, x: number, y: number, layer = "ground") =>
  h.host.stores.get("map-1")!.document.getLayer(layer)!.getCell(x, y);

describe("forgiving arguments (mistakes real agents made)", () => {
  it("defaults mapId to the edit's only map and resolves layerName on per-layer tools", async () => {
    const h = harness();
    await h.begin();
    const r = success(await h.run("paint_cells", { layerName: "ground", points: [[1, 1], [2, 2]], value: tile }));
    expect(r).toMatchObject({ ok: true, changed: 2 });
    expect(cell(h, 1, 1)).not.toBe(0);
    success(await h.run("paint_rect", { layerName: "Ground", region: { x: 4, y: 4, width: 2, height: 2 }, value: tile }));
    expect(cell(h, 5, 5)).not.toBe(0);
    const unknown = await h.run("paint_rect", { layerName: "Water", region: { x: 0, y: 0, width: 1, height: 1 }, value: tile });
    error(unknown, "UNKNOWN_ID");
    expect(unknown.structuredContent).toMatchObject({ details: { validIds: expect.arrayContaining([expect.objectContaining({ name: "Ground" })]) } });
  });
  it("accepts tile for value, stringified JSON objects and cells without values", async () => {
    const h = harness();
    await h.begin();
    success(await h.run("paint_cells", { layerName: "ground", tile: JSON.stringify(tile), cells: [{ x: 3, y: 3 }, { x: 4, y: 3 }] }));
    expect(cell(h, 3, 3)).not.toBe(0);
    expect(cell(h, 4, 3)).not.toBe(0);
    success(await h.run("paint_rect", { layerId: "ground", region: JSON.stringify({ x: 0, y: 8, width: 2, height: 1 }), value: tile }));
    expect(cell(h, 1, 8)).not.toBe(0);
  });
  it("names the maps when mapId cannot be inferred", async () => {
    const h = harness();
    await h.begin();
    const created = success(await h.run("create_map", { name: "Second", width: 4, height: 4, tileWidth: 32, tileHeight: 32 }));
    const missing = await h.run("paint_rect", { layerName: "Ground", region: { x: 0, y: 0, width: 1, height: 1 }, value: tile });
    error(missing, "INVALID_ARGUMENT");
    expect(missing.structuredContent).toMatchObject({ message: expect.stringContaining("mapId"),
      details: { validIds: expect.arrayContaining([{ id: created.created!.mapId, name: "Second" }]), nextAction: expect.any(String) } });
  });
  it("lists every ragged paint_grid row at once", async () => {
    const h = harness();
    await h.begin();
    const bad = await h.run("paint_grid", { layerName: "ground", rows: ["gggg", "ggg", "gggg", "gg"], legend: { g: tile } });
    error(bad, "INVALID_ARGUMENT");
    expect(bad.structuredContent).toMatchObject({ message: expect.stringContaining("rows[1] has 3, rows[3] has 2"), details: { nextAction: expect.stringContaining("4 characters") } });
  });
});

describe("place_stamp positions", () => {
  it("places one stamp at many positions as a single action and one revision", async () => {
    const h = harness({ stamps: [stamp] });
    await h.begin();
    const before = h.api.getState().revision;
    const r = success(await h.run("place_stamp", { stampId: stamp.id, positions: [[0, 0], [4, 0], [8, 2]] }));
    expect(r).toMatchObject({ changed: 6 });
    expect(h.api.getState().revision).toBe(before + 1);
    expect(h.api.getState().transaction!.counters.mutationCalls).toBe(3);
    for (const [x, y] of [[0, 0], [4, 0], [8, 2]] as const) expect(cell(h, x, y)).not.toBe(0);
    const outside = await h.run("place_stamp", { stampId: stamp.id, positions: [[0, 4], [15, 0]] });
    error(outside, "OUT_OF_BOUNDS");
    expect(outside.structuredContent).toMatchObject({ message: expect.stringContaining("positions[1]"), details: { applied: false } });
    expect(cell(h, 0, 4)).toBe(0);
    error(await h.run("place_stamp", { stampId: stamp.id }), "INVALID_ARGUMENT");
    error(await h.run("place_stamp", { stampId: stamp.id, at: { x: 0, y: 6 }, positions: [[0, 7]] }), "INVALID_ARGUMENT");
  });
});

describe("compact envelopes and essentials", () => {
  it("write answers carry revision, changed, bounds and budget only", async () => {
    const h = harness();
    await h.begin();
    const r = await h.run("paint_rect", { layerName: "ground", region: { x: 0, y: 0, width: 3, height: 2 }, value: tile });
    const body = success(r);
    expect(Object.keys(body).sort()).toEqual(["bounds", "budget", "changed", "ok", "revision"]);
    expect(body.budget!.cellsLeft).toBeLessThan(ESSENTIAL_LIMITS.editCells);
    expect(JSON.parse(r.content[0].text)).toEqual(body);
    expect(r.content[0].text.length).toBeLessThan(160);
  });
  it("get_session and begin_edit show only the essential limits", async () => {
    const h = harness();
    const session = success(await h.run("get_session", {}));
    expect((session.data as { limits: unknown }).limits).toEqual(ESSENTIAL_LIMITS);
    const begun = await h.begin();
    expect((begun.data as { limits: unknown }).limits).toEqual(ESSENTIAL_LIMITS);
    expect(JSON.stringify(ESSENTIAL_LIMITS).length).toBeLessThan(300);
  });
  it("editor_ui reaches every UI control through one listed tool", async () => {
    const h = harness();
    const unavailable = await h.run("editor_ui", { action: "state" });
    // The memory host has no renderer controls; the call is routed to get_editor_state and says so.
    error(unavailable, "EDITOR_UNAVAILABLE");
    error(await h.run("editor_ui", { action: "explode" }), "INVALID_ARGUMENT");
  });
});
