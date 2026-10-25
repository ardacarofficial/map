/** Acceptance fixes: random area values, forgiving point/kind/rect input, lifecycle error before schema noise, validate_map craft hints. */
import { describe, expect, it } from "vitest";
import { buildRoadProfile, createDocument, MapStore, nineSliceLayout, type Stamp } from "@smap/core";
import { harness, success, error, stamp } from "./helpers";

const t = (tileId: number) => ({ tilesetId: "tiles", tileId });
const grass = { random: [{ ...t(0), weight: 8 }, { ...t(1), weight: 1 }, { ...t(2), weight: 1 }] };
const cells = (h: ReturnType<typeof harness>, layerId = "ground") => {
  const store = h.host.stores.get("map-1")!, layer = store.document.getLayer(layerId)!, out: number[] = [];
  for (let y = 0; y < store.document.map.height; y++) for (let x = 0; x < store.document.map.width; x++) out.push(layer.getCell(x, y));
  return out;
};
const whole = { x: 0, y: 0, width: 20, height: 20 };

describe("random area values", () => {
  it("paint_rect {random} varies tiles deterministically, exactly like a paint_grid random legend", async () => {
    const a = harness({ width: 20, height: 20 }), b = harness({ width: 20, height: 20 }), c = harness({ width: 20, height: 20 });
    for (const h of [a, b, c]) await h.begin();
    expect(success(await a.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: whole, value: grass })).changed).toBe(400);
    success(await b.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: whole, value: grass }));
    success(await c.edit("paint_grid", { mapId: "map-1", layerId: "ground", rows: Array(20).fill("g".repeat(20)), legend: { g: grass } }));
    expect(new Set(cells(a)).size).toBe(3);
    expect(cells(a)).toEqual(cells(b));
    expect(cells(a)).toEqual(cells(c));
  });
  it("fill {random} floods the connected area with varied tiles; outline frames work too", async () => {
    const h = harness({ width: 20, height: 20 });
    await h.begin();
    expect(success(await h.edit("fill", { mapId: "map-1", layerId: "ground", start: { x: 3, y: 3 }, value: grass })).changed).toBe(400);
    expect(new Set(cells(h)).size).toBe(3);
    expect(cells(h).includes(0)).toBe(false);
    error(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: whole, value: { random: [] } }), "INVALID_ARGUMENT");
  });
});

describe("forgiving input", () => {
  it("accepts [x,y] for at, rect for region, and a write with layerName before begin_edit says begin first", async () => {
    const h = harness({ width: 20, height: 20, stamps: [stamp] });
    error(await h.run("paint_rect", { layerName: "Ground", region: whole, value: t(0) }), "TRANSACTION_REQUIRED");
    await h.begin();
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", rect: { x: 0, y: 0, width: 2, height: 2 }, value: t(3) }));
    success(await h.edit("place_stamp", { mapId: "map-1", stampId: "house", at: [5, 5] }));
    success(await h.edit("place_stamp", { mapId: "map-1", stampId: "house", at: "[8,5]" }));
    success(await h.edit("paint_rect", { mapId: "map-1", layerName: "Ground", rect: JSON.stringify({ x: 0, y: 4, width: 2, height: 1 }), value: t(3) }));
    expect(success(await h.edit("clear_region", { mapId: "map-1", layerName: "Ground", region: { x: 0, y: 0, width: 1, height: 1 } })).changed).toBe(1);
    expect(success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", points: [[1, 0]], value: "null" })).changed).toBe(1);
  });
  it("draw_path takes [x,y] points, defaults kind to path and maps road to path", async () => {
    const base: Stamp = {
      id: "river", name: "River", width: 3, height: 3,
      palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: "tiles", tileId })),
      layers: [{ layerId: "s", name: "Ground", cells: Uint32Array.from({ length: 9 }, (_, i) => i + 1) }],
      nineSlice: { border: 1, tileLayers: [{ layerId: "s", tilesetId: "baked" }] },
    };
    const road: Stamp = { ...base, nineSlice: { ...base.nineSlice!, road: { tilesetId: "baked", profile: buildRoadProfile(base, "s") } } };
    const tilesets = [
      { id: "tiles", name: "Tiles", tileWidth: 32, tileHeight: 32, columns: 8, rows: 8, margin: 0, spacing: 0, imagePath: "tiles.png" },
      { id: "baked", name: "Baked", tileWidth: 32, tileHeight: 32, columns: nineSliceLayout(road).slots, rows: 1, margin: 0, spacing: 0, imagePath: "baked.png" },
    ];
    const store = new MapStore(createDocument({ width: 16, height: 12, tilesets }));
    store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
    store.clearHistory();
    const h = harness({ maps: [{ id: "map-1", store }], stamps: [road], tilesets });
    await h.begin();
    expect(success(await h.edit("draw_path", { mapId: "map-1", layerId: "ground", source: { stampId: "river" }, points: [[2, 2], [8, 2]] })).changed).toBeGreaterThan(0);
    expect(success(await h.edit("draw_path", { mapId: "map-1", layerId: "ground", source: { stampId: "river" }, kind: "road", points: [[2, 6], [8, 6]] })).changed).toBeGreaterThan(0);
  });
});

describe("validate_map craft hints", () => {
  it("names flat ground, ground gaps and an almost empty map, never as errors", async () => {
    const h = harness({ width: 20, height: 20 });
    await h.begin();
    success(await h.edit("edit_layer", { mapId: "map-1", action: "create", name: "Upper", kind: "tile" }));
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: { x: 0, y: 0, width: 20, height: 19 }, value: t(0) }));
    const flat = success(await h.read("validate_map", { mapId: "map-1" })).data as { valid: boolean; hints?: string[] };
    expect(flat.valid).toBe(true);
    expect(flat.hints?.map(s => s.split(":")[0])).toEqual(["GROUND_GAPS", "FLAT_GROUND", "SPARSE"]);
    expect(flat.hints![0]).toContain("first at 0,19");
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: whole, value: grass }));
    const varied = success(await h.read("validate_map", { mapId: "map-1" })).data as { hints?: string[] };
    expect(varied.hints?.map(s => s.split(":")[0])).toEqual(["SPARSE"]);
    const region = success(await h.read("validate_map", { mapId: "map-1", region: { x: 0, y: 0, width: 4, height: 4 } })).data as { hints?: string[] };
    expect(region.hints).toBeUndefined();
  });
});

describe("paint_grid {proposalId}", () => {
  it("paints the quantizer's grid without retyping rows, and explains an unknown id", async () => {
    const h = harness({ width: 4, height: 2 });
    const layers = [{ layerId: "ground", layerName: "Ground", origin: { x: 0, y: 0 }, rows: ["ab..", "..ba"], legend: { a: t(1), b: t(2), ".": "keep" as const }, counts: { a: 2, b: 2 } }];
    h.host.references = {
      list: () => [{ referenceId: "ref-1", name: "Köy", width: 8, height: 4, origin: "user" as const }],
      add: async () => { throw new Error("unused"); }, view: async () => { throw new Error("unused"); }, compare: async () => { throw new Error("unused"); },
      quantize: async args => ({ data: { mapId: args.mapId, referenceId: args.referenceId, region: args.region!, mode: "render", fit: "stretch", sourceRect: { x: 0, y: 0, width: 8, height: 4 }, cellPixels: { width: 2, height: 2 }, grid: { layers }, confidence: { high: 8, medium: 0, low: 0, uncovered: 0, meanError: 0, lowCells: [], lowCellsTruncated: false }, stamps: [], warnings: [], mapRevision: 0 } }),
    };
    const q = success(await h.run("reference_quantize", { referenceId: "ref-1", mapId: "map-1" })).data as { proposalId: string };
    expect(q.proposalId).toBe("grid-1");
    await h.begin();
    expect(success(await h.edit("paint_grid", { proposalId: q.proposalId })).changed).toBe(4);
    const store = h.host.stores.get("map-1")!, ground = store.document.getLayer("ground")!;
    expect(store.document.palette.get(ground.getCell(1, 0) & 0x1fffffff)).toEqual(t(2));
    // Copied verbatim (counts + layerName) still paints.
    success(await h.edit("paint_grid", { layers }));
    error(await h.edit("paint_grid", { proposalId: "grid-9" }), "UNKNOWN_ID");
  });
});

describe("colorLegend {random}", () => {
  it("matches with the heaviest tile and hands the random entry back in the proposal; sketch without legend warns", async () => {
    const h = harness({ width: 4, height: 2 });
    h.host.references = {
      list: () => [{ referenceId: "ref-1", name: "Sketch", width: 8, height: 4, origin: "user" as const }],
      add: async () => { throw new Error("unused"); }, view: async () => { throw new Error("unused"); }, compare: async () => { throw new Error("unused"); },
      quantize: async args => ({ data: { mapId: args.mapId, referenceId: args.referenceId, region: args.region!, mode: "sketch", fit: "stretch", sourceRect: { x: 0, y: 0, width: 8, height: 4 }, cellPixels: { width: 2, height: 2 },
        grid: { layers: [{ layerId: "ground", layerName: "Ground", origin: { x: 0, y: 0 }, rows: ["aaaa", "aaab"], legend: { a: args.legend[0]?.cell ?? t(9), b: t(3) }, counts: { a: 7, b: 1 } }] },
        confidence: { high: 8, medium: 0, low: 0, uncovered: 0, meanError: 0, lowCells: [], lowCellsTruncated: false }, stamps: [], warnings: [], mapRevision: 0 } }),
    };
    const q = success(await h.run("reference_quantize", { referenceId: "ref-1", mapId: "map-1", colorLegend: { "#6ebe5a": grass } })).data as { proposalId: string; grid: { layers: { legend: Record<string, unknown> }[] }; warnings: string[] };
    expect(q.grid.layers[0]!.legend.a).toEqual(grass);
    expect(q.warnings).toEqual([]);
    await h.begin();
    success(await h.edit("paint_grid", { proposalId: q.proposalId }));
    expect(new Set(cells(h).slice(0, 7)).size).toBeGreaterThan(1);
    const bare = success(await h.run("reference_quantize", { referenceId: "ref-1", mapId: "map-1", mode: "sketch" })).data as { warnings: string[] };
    expect(bare.warnings[0]).toContain("colorLegend");
  });
});

describe("context-free writes on oneOf tools", () => {
  it("edit_layer and edit_entity work without context (C2), like every other write", async () => {
    const h = harness({ width: 8, height: 8 });
    await h.begin();
    const created = success(await h.run("edit_layer", { mapId: "map-1", action: "create", name: "Things", kind: "entity" })).created as { layerIds: string[] };
    success(await h.run("edit_layer", { mapId: "map-1", action: "update", layerId: "ground", props: { name: "Base", locked: true } }));
    success(await h.run("edit_layer", { mapId: "map-1", action: "reorder", layerId: created.layerIds[0], index: 0 }));
    const placed = success(await h.run("place_entity", { mapId: "map-1", layerId: created.layerIds[0], typeId: "spawn", at: { x: 1, y: 1 } })).created as { entityIds: string[] };
    success(await h.run("edit_entity", { mapId: "map-1", action: "move", entityId: placed.entityIds[0], at: { x: 2, y: 2 } }));
  });
});

describe("validate_map PATH_UNDER_STAMP", () => {
  it("flags a path under a house body, not under its door row and not a bridge over its crossing", async () => {
    const generated = { kind: "nineSlice" as const, stampId: "path", layerId: "s", sourceWidth: 3, sourceHeight: 3, layoutVersion: 1 as const, sources: [] };
    const tilesets = [
      { id: "tiles", name: "Tiles", tileWidth: 32, tileHeight: 32, columns: 8, rows: 8, margin: 0, spacing: 0, imagePath: "tiles.png" },
      { id: "road", name: "Road (yol)", tileWidth: 32, tileHeight: 32, columns: 4, rows: 4, margin: 0, spacing: 0, imagePath: "road.png", generated },
    ];
    const house: Stamp = { id: "house", name: "House", width: 2, height: 3,
      palette: Array.from({ length: 6 }, (_, i) => ({ tilesetId: "tiles", tileId: 10 + i })),
      layers: [{ layerId: "u", name: "Upper", cells: Uint32Array.of(1, 2, 3, 4, 5, 6) }] };
    const bridge: Stamp = { id: "bridge", name: "Bridge", width: 2, height: 2,
      palette: [{ tilesetId: "tiles", tileId: 20 }], layers: [{ layerId: "u", name: "Upper", cells: Uint32Array.of(1, 1, 1, 1) }] };
    const store = new MapStore(createDocument({ width: 16, height: 16, tilesets }));
    store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
    store.dispatch({ type: "addLayer", layer: { id: "upper", name: "Upper" } });
    store.clearHistory();
    const h = harness({ maps: [{ id: "map-1", store }], stamps: [house, bridge], tilesets });
    await h.begin();
    const placeHouse = (x: number, y: number) => h.edit("place_stamp", { mapId: "map-1", stampId: "house", at: { x, y }, layerMapping: [{ sourceLayerId: "u", targetLayerId: "upper" }] });
    const road = { tilesetId: "road", tileId: 1 };
    success(await placeHouse(1, 1));
    success(await placeHouse(8, 1));
    success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", points: [[1, 3], [1, 4], [8, 2], [8, 3]], value: road }));
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: { x: 4, y: 10, width: 2, height: 2 }, value: road }));
    success(await h.edit("place_stamp", { mapId: "map-1", stampId: "bridge", at: { x: 4, y: 10 }, layerMapping: [{ sourceLayerId: "u", targetLayerId: "upper" }] }));
    const result = success(await h.read("validate_map", { mapId: "map-1" })).data as { valid: boolean; hints?: string[] };
    const hint = result.hints?.find(s => s.startsWith("PATH_UNDER_STAMP"));
    expect(hint).toContain("1 stamp(s)");
    expect(hint).toContain("'House' at 8,1 (cell 8,2)");
    expect(hint).not.toContain("Bridge");
  });
});

describe("forgiving layers", () => {
  it("a layer id passed as layerName resolves to that layer", async () => {
    const h = harness({ width: 8, height: 8 });
    await h.begin();
    const created = success(await h.edit("edit_layer", { mapId: "map-1", action: "create", name: "Upper", kind: "tile" })).created as { layerIds: string[] };
    expect(success(await h.edit("paint_rect", { mapId: "map-1", layerName: created.layerIds[0], region: { x: 0, y: 0, width: 2, height: 2 }, value: t(0) })).changed).toBe(4);
    expect(h.host.stores.get("map-1")!.document.getLayer(created.layerIds[0]!)!.getCell(1, 1)).not.toBe(0);
  });
});
