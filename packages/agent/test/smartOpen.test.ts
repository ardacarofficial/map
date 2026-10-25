import { expect, it } from "vitest";
import { buildRoadProfile, cellFlags, cellPaletteIndex, createDocument, MapStore, nineSliceLayout, roadTileInfo, type Stamp, type Tileset } from "@smap/core";
import { harness, success, error } from "./helpers";

/** Band-1 road/river stamp with its baked atlas, on a 16×12 map. */
function fixture() {
  const base: Stamp = {
    id: "river", name: "River", width: 3, height: 3,
    palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: "tiles", tileId })),
    layers: [{ layerId: "s", name: "Ground", cells: Uint32Array.from({ length: 9 }, (_, i) => i + 1) }],
    nineSlice: { border: 1, tileLayers: [{ layerId: "s", tilesetId: "baked" }] },
  };
  const profile = buildRoadProfile(base, "s");
  const stamp: Stamp = { ...base, nineSlice: { ...base.nineSlice!, road: { tilesetId: "baked", profile } } };
  const tilesets = [
    { id: "tiles", name: "Tiles", tileWidth: 32, tileHeight: 32, columns: 8, rows: 8, margin: 0, spacing: 0, imagePath: "tiles.png" },
    { id: "baked", name: "Baked", tileWidth: 32, tileHeight: 32, columns: nineSliceLayout(stamp).slots, rows: 1, margin: 0, spacing: 0, imagePath: "baked.png" },
  ];
  const store = new MapStore(createDocument({ width: 16, height: 12, tilesets }));
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
  store.clearHistory();
  // An area-only twin (no road profile): preparing it succeeds, drawing a path with it fails.
  const pond: Stamp = { ...base, id: "pond", name: "Pond" };
  const h = harness({ maps: [{ id: "map-1", store }], stamps: [stamp, pond], tilesets });
  const mask = (x: number, y: number) => {
    const s = h.host.stores.get("map-1")!, c = s.document.getLayer("ground")!.getCell(x, y);
    if (!c) return -1;
    const entry = s.document.palette.get(cellPaletteIndex(c))!, ts = s.document.getTileset(entry.tilesetId)!;
    const info = roadTileInfo(ts.roadProfile ?? profile, entry.tilesetId, entry, cellFlags(c));
    return info.kind === "blob" ? info.mask : -2;
  };
  return { h, mask };
}

it("reuses one preparation per source and accepts an inline source on smart tools", async () => {
  const { h } = fixture();
  await h.begin();
  const first = success(await h.edit("prepare_smart_source", { mapId: "map-1", source: { stampId: "river" } })).created as { sourceId: string };
  const tilesets = h.host.stores.get("map-1")!.document.tilesets.length;
  const second = success(await h.edit("prepare_smart_source", { mapId: "map-1", source: { stampId: "river" } })).created as { sourceId: string };
  expect(second.sourceId).toBe(first.sourceId);
  expect(h.host.stores.get("map-1")!.document.tilesets.length).toBe(tilesets);
  const path = success(await h.edit("draw_path", { mapId: "map-1", layerId: "ground", source: { stampId: "river" }, kind: "river", points: [{ x: 2, y: 2 }, { x: 8, y: 2 }] }));
  expect(path.changed).toBeGreaterThan(0);
  error(await h.edit("draw_path", { mapId: "map-1", layerId: "ground", kind: "river", points: [{ x: 2, y: 2 }, { x: 8, y: 2 }] }), "INVALID_ARGUMENT");
  error(await h.edit("draw_path", { mapId: "map-1", layerId: "ground", sourceId: first.sourceId, source: { stampId: "river" }, kind: "river", points: [{ x: 2, y: 2 }, { x: 8, y: 2 }] }), "INVALID_ARGUMENT");
});

it("keeps paths and areas that reach the map border open by default and closed on request", async () => {
  const { h, mask } = fixture();
  await h.begin();
  // A width-3 river centred on the top row is clipped at the border instead of failing.
  success(await h.edit("draw_path", { mapId: "map-1", layerId: "ground", source: { stampId: "river" }, kind: "river", width: 3, points: [{ x: 5, y: 0 }, { x: 5, y: 6 }, { x: 15, y: 6 }] }));
  expect(mask(5, 0) & 1).toBe(1);
  expect(mask(15, 6) & 4).toBe(4);
  // Concave bend: the inner corner cell has both cardinal neighbours and lacks the diagonal.
  expect(mask(6, 5)).toBe(255 & ~2);
  success(await h.edit("smart_brush", { mapId: "map-1", layerId: "ground", source: { stampId: "river" }, mode: "area", region: { x: 0, y: 9, width: 4, height: 3 } }));
  expect(mask(0, 10) & 64).toBe(64);
  expect(mask(1, 11) & 16).toBe(16);
  expect(mask(1, 9) & 1).toBe(0);
  success(await h.edit("smart_brush", { mapId: "map-1", layerId: "ground", source: { stampId: "river" }, mode: "area", region: { x: 12, y: 9, width: 4, height: 3 }, openEdges: false }));
  expect(mask(15, 10) & 4).toBe(0);
});

it("advertises smart art in get_session, list_tilesets and list_stamps", async () => {
  const { h } = fixture();
  h.host.smartSources.candidates = async (tilesetId) => tilesetId === "tiles" ? [{ tilesetId, rect: { x: 0, y: 0, width: 3, height: 3 }, kind: "road", band: 1 }] : [];
  const session = success(await h.run("get_session", {})).data as { smart?: unknown };
  expect(session.smart).toEqual([{ tilesetId: "tiles", rect: { x: 0, y: 0, width: 3, height: 3 }, kind: "road", band: 1 }]);
  const tilesets = success(await h.read("list_tilesets", { includeDetails: false })).data as { items: { id: string; smart?: unknown }[] };
  expect(tilesets.items.find(t => t.id === "tiles")!.smart).toEqual(session.smart);
  expect(tilesets.items.find(t => t.id === "baked")!.smart).toBeUndefined();
  const stamps = success(await h.read("list_stamps", {})).data as { items: { id: string; smart?: unknown }[] };
  expect(stamps.items.find(s => s.id === "river")!.smart).toEqual({ kind: "road", band: 1 });
});

it("a smart call that fails after preparing its inline source undoes only its paint and keeps the reusable source", async () => {
  const { h } = fixture();
  // Like the editor host, preparation stages a generated atlas into the map (a store operation).
  const ports = h.host.smartSources, prepare = ports.prepare.bind(ports);
  ports.prepare = async (...args) => {
    const source = await prepare(...args);
    (source.tilesets as Tileset[]).push({ id: `generated-${source.sourceId}`, name: "Generated", tileWidth: 32, tileHeight: 32, columns: 1, rows: 1, margin: 0, spacing: 0, imagePath: "generated.png" });
    return source;
  };
  await h.begin();
  success(await h.run("paint_cells", { mapId: "map-1", layerId: "ground", cells: [{ x: 0, y: 0, value: { tilesetId: "tiles", tileId: 4 } }] }));
  const failed = await h.run("draw_path", { mapId: "map-1", layerId: "ground", source: { stampId: "pond" }, kind: "path", points: [{ x: 2, y: 2 }, { x: 8, y: 2 }] });
  expect(failed.isError).toBe(true);
  expect(failed.structuredContent).toMatchObject({ ok: false, code: "SOURCE_NOT_SMART", details: { applied: false } });
  expect(h.api.getState().phase).toBe("running");
  expect(h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(0, 0)).not.toBe(0);
  const tilesets = h.host.stores.get("map-1")!.document.tilesets.length;
  // The prepared source stays in the draft: area painting with the same inline source reuses it.
  success(await h.run("smart_brush", { mapId: "map-1", layerId: "ground", source: { stampId: "pond" }, mode: "area", region: { x: 4, y: 4, width: 4, height: 4 } }));
  expect(h.host.stores.get("map-1")!.document.tilesets.length).toBe(tilesets);
});

it("parallel context-free smart calls with one inline source serialise without revision conflicts or duplicate preparation", async () => {
  const { h } = fixture();
  await h.begin();
  const before = h.host.stores.get("map-1")!.document.tilesets.length;
  const results = await Promise.all([
    h.run("draw_path", { mapId: "map-1", layerId: "ground", source: { stampId: "river" }, kind: "river", points: [{ x: 1, y: 1 }, { x: 10, y: 1 }] }),
    h.run("draw_path", { mapId: "map-1", layerId: "ground", source: { stampId: "river" }, kind: "river", points: [{ x: 1, y: 5 }, { x: 10, y: 5 }] }),
    h.run("smart_brush", { mapId: "map-1", layerId: "ground", source: { stampId: "river" }, mode: "area", region: { x: 2, y: 8, width: 5, height: 3 } }),
  ]);
  const ids = results.map(result => success(result).created!.sourceId!);
  expect(new Set(ids).size).toBe(1);
  const added = h.host.stores.get("map-1")!.document.tilesets.length - before;
  success(await h.run("prepare_smart_source", { mapId: "map-1", source: { stampId: "river" } }));
  expect(h.host.stores.get("map-1")!.document.tilesets.length - before).toBe(added);
});
