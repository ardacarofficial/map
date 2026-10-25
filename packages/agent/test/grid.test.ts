/** C1 grid format: read_region grid output, paint_grid, points, replace_tiles and clear_region. */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cellFlags, serializeLevel } from "@smap/core";
import { harness, success, error, tile } from "./helpers";
import { gridSymbol } from "../src/tools/grid";
import type { GridLayerOutput, ReadRegionGrid } from "../src/contracts";

const t = (tileId: number, flags = 0) => (flags ? { tilesetId: "tiles", tileId, flags } : { tilesetId: "tiles", tileId });
const cellsOf = (h: ReturnType<typeof harness>, layerId = "ground", mapId = "map-1") => {
  const layer = h.host.stores.get(mapId)!.document.getLayer(layerId)!, out: number[] = [];
  const { width, height } = h.host.stores.get(mapId)!.document.map;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.push(layer.getCell(x, y));
  return out;
};
async function readGrid(h: ReturnType<typeof harness>, args: Record<string, unknown> = {}) {
  return success(await h.read("read_region", { mapId: "map-1", ...args })).data as ReadRegionGrid;
}

describe("read_region grid format", () => {
  it("defaults to the whole map, visible cell layers, legend + rows, and omits empty layers", async () => {
    const h = harness({ width: 6, height: 3 });
    await h.begin();
    success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", cells: [
      { x: 0, y: 0, value: t(3) }, { x: 1, y: 0, value: t(3, 5) }, { x: 5, y: 2, value: t(9) },
    ] }));
    const r = await readGrid(h);
    expect(r).toEqual({
      format: "grid", region: { x: 0, y: 0, width: 6, height: 3 }, origin: { x: 0, y: 0 },
      layers: [{ layerId: "ground", name: "Ground", kind: "tile", rows: ["AB....", "......", ".....C"],
        legend: { A: t(3), B: t(3, 5), ".": null, C: t(9) } }],
      emptyLayerIds: ["collision"],
    });
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "collision", region: { x: 0, y: 1, width: 2, height: 1 }, value: { collision: 1 } }));
    success(await h.edit("paint_cells", { mapId: "map-1", layerId: "collision", cells: [{ x: 2, y: 1, value: { collision: 2 } }] }));
    const both = await readGrid(h, { region: { x: 0, y: 1, width: 3, height: 1 } });
    expect(both.layers.map(l => [l.layerId, l.rows, l.legend])).toEqual([
      ["collision", ["##+"], { "#": { collision: 1 }, "+": { collision: 2 } }],
    ]);
    expect(both.emptyLayerIds).toEqual(["ground"]);
    expect(both.origin).toEqual({ x: 0, y: 1 });
  });
  it("skips hidden layers by default, keeps explicit layers and reports entities only when requested", async () => {
    const h = harness({ width: 4, height: 2 });
    await h.begin();
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: { x: 0, y: 0, width: 4, height: 2 }, value: tile }));
    success(await h.edit("place_entity", { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 1, y: 1 } }));
    expect((await readGrid(h)).entities).toBeUndefined();
    expect((await readGrid(h, { includeEntities: true })).entities).toMatchObject([{ typeId: "spawn", pixelX: 32, pixelY: 32 }]);
    success(await h.edit("edit_layer", { mapId: "map-1", layerId: "ground", action: "update", props: { visible: false } }));
    expect((await readGrid(h)).layers).toEqual([]);
    expect((await readGrid(h, { layerIds: ["ground"] })).layers[0]!.rows).toEqual(["AAAA", "AAAA"]);
    error(await h.read("read_region", { mapId: "map-1", layerIds: ["nope"] }), "UNKNOWN_ID");
  });
  it("symbols are deterministic, single code points and never whitespace or the empty marker", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i++) {
      const s = gridSymbol(i);
      expect([...s]).toHaveLength(1);
      expect(/\s/.test(s) || s === "." || s === '"' || s === "\\").toBe(false);
      seen.add(s);
    }
    expect(seen.size).toBe(20000);
  });
});

describe("paint_grid", () => {
  it("paints rows through the legend with flags, erase, keep and space-keep in one compact response", async () => {
    const h = harness({ width: 6, height: 4 });
    await h.begin();
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: { x: 0, y: 0, width: 6, height: 4 }, value: t(1) }));
    const before = h.api.getState().transaction!.counters.mutationCalls;
    const r = success(await h.edit("paint_grid", { mapId: "map-1", layerId: "ground", origin: { x: 1, y: 1 },
      rows: ["ab~", "x b"], legend: { a: t(2), b: t(4, 3), x: null, "~": "keep" } }));
    expect(r).toMatchObject({ ok: true, changed: 4, bounds: { x: 1, y: 1, width: 3, height: 2 } });
    expect(Object.keys(r).sort()).toEqual(["bounds", "budget", "changed", "ok", "revision"]);
    expect(h.api.getState().transaction!.counters.mutationCalls).toBe(before + 1);
    const g = await readGrid(h, { region: { x: 0, y: 0, width: 5, height: 3 } });
    expect(g.layers[0]!.rows).toEqual(["AAAAA", "ABCAA", "A.ACA"]);
    expect(g.layers[0]!.legend).toEqual({ A: t(1), B: t(2), C: t(4, 3), ".": null });
    const layer = h.host.stores.get("map-1")!.document.getLayer("ground")!;
    expect(cellFlags(layer.getCell(3, 2))).not.toBe(0);
    const same = success(await h.edit("paint_grid", { mapId: "map-1", layerId: "ground", origin: { x: 1, y: 1 }, rows: ["a"], legend: { a: t(2) } }));
    expect(same).toMatchObject({ changed: 0, warnings: ["No cells changed: every write already matched the map."] });
  });
  it("resolves unique layer names, multi-layer grids with shared legend, and collision values in one action", async () => {
    const h = harness({ width: 4, height: 4 });
    await h.begin();
    const r = success(await h.edit("paint_grid", { mapId: "map-1", legend: { g: t(0), w: t(7) }, origin: { x: 1, y: 0 }, layers: [
      { layerName: "ground", rows: ["gw", "wg"] },
      { layerId: "collision", origin: { x: 2, y: 0 }, rows: ["#"], legend: { "#": { collision: 1 } } },
    ] }));
    expect(r.changed).toBe(5);
    expect(h.api.getState().transaction!.counters.mutationCalls).toBe(1);
    const g = await readGrid(h, { region: { x: 0, y: 0, width: 4, height: 2 } });
    expect(g.layers.map(l => l.rows)).toEqual([[".AB.", ".BA."], ["..#.", "...."]]);
    error(await h.edit("paint_grid", { mapId: "map-1", layerName: "Nope", rows: ["g"], legend: { g: t(0) } }), "UNKNOWN_ID");
    error(await h.edit("paint_grid", { mapId: "map-1", layerId: "ground", rows: ["#"], legend: { "#": { collision: 1 } } }), "LAYER_KIND");
    error(await h.edit("paint_grid", { mapId: "map-1", layerId: "collision", rows: ["g"], legend: { g: t(0) } }), "LAYER_KIND");
    error(await h.edit("paint_grid", { mapId: "map-1", layerId: "entities", rows: ["g"], legend: { g: t(0) } }), "LAYER_KIND");
  });
  it("rejects unknown characters, ragged rows, unknown tiles and out-of-map grids before any write", async () => {
    const h = harness({ width: 4, height: 4 });
    await h.begin();
    const before = h.host.snapshot();
    const bad = await h.edit("paint_grid", { mapId: "map-1", layerId: "ground", rows: ["gg", "gq"], legend: { g: t(0) } });
    error(bad, "INVALID_ARGUMENT");
    expect(bad.structuredContent).toMatchObject({ message: expect.stringContaining("rows[1][1]"), details: { validSymbols: ["g"] } });
    error(await h.edit("paint_grid", { mapId: "map-1", layerId: "ground", rows: ["gg", "g"], legend: { g: t(0) } }), "INVALID_ARGUMENT");
    error(await h.edit("paint_grid", { mapId: "map-1", layerId: "ground", rows: ["g"], legend: { g: t(999) } }), "UNKNOWN_ID");
    const out = await h.edit("paint_grid", { mapId: "map-1", layerId: "ground", origin: { x: 3, y: 0 }, rows: ["gg"], legend: { g: t(0) } });
    error(out, "OUT_OF_BOUNDS");
    expect(out.structuredContent).toMatchObject({ details: { mapSize: { width: 4, height: 4 } } });
    expect(h.host.snapshot()).toEqual(before);
    // A layer may repeat (one entry per object); later entries win per cell, still one action.
    const twice = success(await h.edit("paint_grid", { mapId: "map-1", layers: [{ layerId: "ground", rows: ["gg"] }, { layerName: "Ground", origin: { x: 1, y: 0 }, rows: ["h"] }], legend: { g: t(0), h: t(1) } }));
    expect(twice.changed).toBe(2);
    expect((await readGrid(h, { region: { x: 0, y: 0, width: 2, height: 1 } })).layers[0]!.rows).toEqual(["AB"]);
  });
  it("random legend entries are deterministic per cell and seed, and survive cancel/redo", async () => {
    const h = harness({ width: 16, height: 16 });
    const paint = () => h.edit("paint_grid", { mapId: "map-1", layerId: "ground", rows: Array.from({ length: 16 }, () => "r".repeat(16)),
      legend: { r: { random: [{ ...t(1), weight: 1 }, { ...t(2), weight: 3 }, t(3, 1)], seed: 42 } } });
    await h.begin();
    success(await paint());
    const first = cellsOf(h);
    expect(new Set(first).size).toBe(3);
    success(await h.edit("cancel_edit", {}));
    await h.begin();
    success(await paint());
    expect(cellsOf(h)).toEqual(first);
    success(await h.edit("paint_grid", { mapId: "map-1", layerId: "ground", rows: ["r"], legend: { r: { random: [t(1), t(2)], seed: 43 } } }));
  });
  it("works as an apply_operations child alongside sparse writes", async () => {
    const h = harness({ width: 8, height: 8 });
    await h.begin();
    const r = success(await h.edit("apply_operations", { operations: [
      { tool: "paint_grid", args: { mapId: "map-1", layerId: "ground", rows: ["ab", "ba"], legend: { a: t(1), b: t(2) } } },
      { tool: "paint_cells", args: { mapId: "map-1", layerId: "ground", points: [[5, 5], [6, 6]], value: t(3) } },
    ] }));
    expect(r.items!.map(i => [i.tool, i.changed])).toEqual([["paint_grid", 4], ["paint_cells", 2]]);
    expect((await readGrid(h, { region: { x: 0, y: 0, width: 2, height: 2 } })).layers[0]!.rows).toEqual(["AB", "BA"]);
    error(await h.edit("apply_operations", { operations: [
      { tool: "paint_grid", args: { mapId: "map-1", layerId: "ground", rows: ["z"], legend: { a: t(1) } } },
    ] }), "INVALID_ARGUMENT");
  });
});

describe("paint_cells points", () => {
  it("accepts compact [x,y] tuples with one value and rejects mixed forms", async () => {
    const h = harness({ width: 8, height: 8 });
    await h.begin();
    const r = success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", points: [[0, 0], [7, 7], [3, 4]], value: t(5, 2) }));
    expect(r.changed).toBe(3);
    expect(cellsOf(h).filter(Boolean)).toHaveLength(3);
    error(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", points: [[0, 0], [0, 0]], value: t(1) }), "INVALID_ARGUMENT");
    error(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", points: [[8, 0]], value: t(1) }), "OUT_OF_BOUNDS");
    error(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", points: [[0, 0]] }), "INVALID_ARGUMENT");
  });
});

describe("replace_tiles", () => {
  it("keeps flip bits, supports region/layer/map scopes and erasing, and reports the count", async () => {
    const h = harness({ width: 6, height: 2 });
    await h.begin();
    success(await h.edit("paint_grid", { mapId: "map-1", layerId: "ground", rows: ["aabbAB", "aaaaaa"], legend: { a: t(1), b: t(2), A: t(1, 1), B: t(1, 6) } }));
    const region = success(await h.edit("replace_tiles", { scope: "region", mapId: "map-1", region: { x: 0, y: 0, width: 6, height: 1 }, from: t(1), to: t(9) }));
    expect(region).toMatchObject({ changed: 4 });
    const g = await readGrid(h, { region: { x: 0, y: 0, width: 6, height: 1 } });
    expect(g.layers[0]!.legend).toEqual({ A: t(9), B: t(2), C: t(9, 1), D: t(9, 6) });
    const map = success(await h.edit("replace_tiles", { scope: "map", mapId: "map-1", from: t(1), to: null }));
    expect(map).toMatchObject({ changed: 6, bounds: { x: 0, y: 1, width: 6, height: 1 } });
    const none = success(await h.edit("replace_tiles", { scope: "layer", mapId: "map-1", layerIds: ["ground"], from: t(1), to: t(2) }));
    expect(none).toMatchObject({ changed: 0, warnings: ["No cells use the from tile in the selected scope."] });
    error(await h.edit("replace_tiles", { scope: "layer", mapId: "map-1", layerIds: ["collision"], from: t(1), to: t(2) }), "LAYER_KIND");
    error(await h.edit("replace_tiles", { scope: "region", mapId: "map-1", from: t(1), to: t(2) }), "INVALID_ARGUMENT");
    error(await h.edit("replace_tiles", { scope: "map", mapId: "map-1", from: t(2), to: t(999) }), "UNKNOWN_ID");
  });
  it("skips protected layers by default, rejects them explicitly, and covers every map of the edit in world scope", async () => {
    const h = harness({ width: 4, height: 4 });
    const store = h.host.stores.get("map-1")!;
    store.dispatch({ type: "addLayer", layer: { id: "upper", name: "Upper", type: "tile" } });
    await h.begin();
    for (const layerId of ["ground", "upper"])
      success(await h.edit("paint_rect", { mapId: "map-1", layerId, region: { x: 0, y: 0, width: 4, height: 1 }, value: t(1) }));
    success(await h.edit("edit_layer", { mapId: "map-1", layerId: "upper", action: "update", props: { locked: true } }));
    const created = success(await h.edit("create_map", { name: "Second", width: 4, height: 4, tileWidth: 32, tileHeight: 32 })).created!;
    const secondId = created.mapId!, secondLayer = created.layers![0]!.id;
    success(await h.edit("paint_rect", { mapId: secondId, layerId: secondLayer, region: { x: 0, y: 0, width: 2, height: 2 }, value: t(1) }));
    const world = success(await h.edit("replace_tiles", { scope: "world", from: t(1), to: t(4) }));
    expect(world).toMatchObject({ changed: 8, maps: [{ mapId: "map-1", changed: 4 }, { mapId: secondId, changed: 4 }] });
    expect(world.warnings![0]).toContain("upper");
    error(await h.edit("replace_tiles", { scope: "layer", mapId: "map-1", layerIds: ["upper"], from: t(1), to: t(4) }), "LAYER_LOCKED");
  });
});

describe("clear_region", () => {
  it("erases tile and collision cells by default and entities only on listed entity layers", async () => {
    const h = harness({ width: 6, height: 6 });
    await h.begin();
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: { x: 0, y: 0, width: 6, height: 6 }, value: t(1) }));
    success(await h.edit("paint_rect", { mapId: "map-1", layerId: "collision", region: { x: 0, y: 0, width: 6, height: 6 }, value: { collision: 1 } }));
    success(await h.edit("place_entity", { mapId: "map-1", layerId: "entities", typeId: "spawn", at: { x: 2, y: 2 } }));
    const r = success(await h.edit("clear_region", { mapId: "map-1", region: { x: 1, y: 1, width: 3, height: 3 } }));
    expect(r).toMatchObject({ changed: 18, bounds: { x: 1, y: 1, width: 3, height: 3 } });
    expect(h.host.stores.get("map-1")!.document.entityLayers()[0]!.entities).toHaveLength(1);
    const e = success(await h.edit("clear_region", { mapId: "map-1", layerIds: ["entities", "ground"] }));
    expect(e).toMatchObject({ changed: 27, removedEntities: 1 });
    expect(cellsOf(h).some(Boolean)).toBe(false);
    expect(cellsOf(h, "collision").filter(Boolean)).toHaveLength(27);
    await h.api.userAction("discard");
  });
});

describe("grid round trip (property)", () => {
  const alphabet = "abcdefgh. ".split("");
  const gridArb = fc.record({
    w: fc.integer({ min: 1, max: 9 }), h: fc.integer({ min: 1, max: 7 }),
    ox: fc.integer({ min: 0, max: 3 }), oy: fc.integer({ min: 0, max: 3 }),
    legend: fc.array(fc.record({ tileId: fc.integer({ min: 0, max: 63 }), flags: fc.integer({ min: 0, max: 7 }) }), { minLength: 8, maxLength: 8 }),
    seed: fc.array(fc.integer({ min: 0, max: alphabet.length - 1 }), { minLength: 63, maxLength: 63 }),
  });
  it("read_region grid output painted onto a blank map reproduces the source cells exactly", async () => {
    await fc.assert(fc.asyncProperty(gridArb, async g => {
      const src = harness({ width: 12, height: 10 }), dst = harness({ width: 12, height: 10 });
      await src.begin(); await dst.begin();
      const legend: Record<string, unknown> = { ".": null };
      g.legend.forEach((v, i) => { legend["abcdefgh"[i]!] = t(v.tileId, v.flags); });
      const rows = Array.from({ length: g.h }, (_, y) => Array.from({ length: g.w }, (_, x) => alphabet[g.seed[(y * g.w + x) % 63]!]!).join(""));
      success(await src.edit("paint_grid", { mapId: "map-1", layerId: "ground", origin: { x: g.ox, y: g.oy }, rows, legend }));
      // Writes landed exactly as the grid said: space keeps (blank), "." erases, letters paint.
      const read = await readGrid(src, { region: { x: g.ox, y: g.oy, width: g.w, height: g.h }, layerIds: ["ground"] });
      const layer = src.host.stores.get("map-1")!.document.getLayer("ground")!;
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const cell = layer.getCell(g.ox + x, g.oy + y);
        expect(cell === 0).toBe(ch === "." || ch === " ");
      }));
      for (const out of read.layers as GridLayerOutput[])
        success(await dst.edit("paint_grid", { mapId: "map-1", layerId: out.layerId, origin: read.origin, rows: out.rows, legend: out.legend }));
      const full = (await readGrid(src)).layers, copy = (await readGrid(dst)).layers;
      expect(copy).toEqual(full);
      expect(serializeLevel(dst.host.stores.get("map-1")!.document).length).toBeGreaterThan(0);
    }), { numRuns: 60 });
  });
});
