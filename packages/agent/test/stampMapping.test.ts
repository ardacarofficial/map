import { expect, it } from "vitest";
import { cellPaletteIndex, stampLayerMapping, type Stamp } from "@smap/core";
import { error, harness, success, tile } from "./helpers";

const layered: Stamp = {
  id: "layered", name: "Layered", width: 1, height: 1,
  palette: [tile, { ...tile, tileId: 1 }],
  layers: [
    { layerId: "foundation", name: "Foundation", cells: Uint32Array.of(1) },
    { layerId: "surface", name: "Ground", cells: Uint32Array.of(2) },
  ],
};

it("creates an unmatched lower stamp layer while reserving the later named destination", async () => {
  const h = harness({ stamps: [layered] }), store = h.host.stores.get("map-1")!;
  expect(stampLayerMapping(store.document, layered)).toMatchObject([
    { clipLayerId: "foundation", targetLayerId: null },
    { clipLayerId: "surface", targetLayerId: "ground" },
  ]);
  const before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", cells: [{ x: 0, y: 0, value: tile }] }));
  const pending = h.host.snapshot(), state = h.api.getState();
  error(await h.edit("place_stamp", {
    mapId: "map-1", stampId: layered.id, at: { x: 2, y: 3 },
  }), "STAMP_MAPPING_REQUIRED");
  expect(h.host.snapshot()).toEqual(pending);
  expect(h.api.getState()).toEqual(state);
  const placed = success(await h.edit("place_stamp", {
    mapId: "map-1", stampId: layered.id, at: { x: 2, y: 3 }, allowCreateLayers: true,
  }));
  expect(placed).toMatchObject({ changed: 2 });
  const foundation = store.document.layers.find(layer => layer.name === "Foundation")!;
  expect(store.document.indexOfLayer(foundation.id)).toBeLessThan(store.document.indexOfLayer("ground"));
  for (const [layerId, tileId] of [[foundation.id, 0], ["ground", 1]] as const)
    expect(store.document.palette.get(cellPaletteIndex(store.document.getLayer(layerId)!.getCell(2, 3)))).toEqual({ ...tile, tileId });
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
});

it("inserts a new upper stamp layer directly after its matched predecessor", async () => {
  const upper = { ...layered, layers: [layered.layers[1]!, { ...layered.layers[0]!, name: "Roof" }] };
  const h = harness({ stamps: [upper] }), store = h.host.stores.get("map-1")!;
  await h.begin();
  success(await h.edit("place_stamp", {
    mapId: "map-1", stampId: upper.id, at: { x: 2, y: 3 }, allowCreateLayers: true,
  }));
  expect(store.document.layers.map(layer => layer.name).slice(0, 3)).toEqual(["Ground", "Roof", "Collision"]);
});

it("keeps consecutive missing layers in stamp order before a later matched layer", async () => {
  const multiple = { ...layered, layers: [layered.layers[0]!,
    { ...layered.layers[0]!, layerId: "middle", name: "Middle" }, layered.layers[1]!] };
  const h = harness({ stamps: [multiple] }), store = h.host.stores.get("map-1")!;
  await h.begin();
  success(await h.edit("place_stamp", {
    mapId: "map-1", stampId: multiple.id, at: { x: 2, y: 3 }, allowCreateLayers: true,
  }));
  expect(store.document.layers.map(layer => layer.name).slice(0, 4)).toEqual(["Foundation", "Middle", "Ground", "Collision"]);
});

it("keeps genuinely ambiguous mappings explicit without changing a pending draft", async () => {
  const h = harness({ stamps: [layered] }), store = h.host.stores.get("map-1")!;
  for (const name of ["Option one", "Option two"])
    store.dispatch({ type: "addLayer", layer: { name, type: "tile" } });
  await h.begin();
  success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", cells: [{ x: 0, y: 0, value: tile }] }));
  const before = h.host.snapshot(), state = h.api.getState();
  error(await h.edit("place_stamp", {
    mapId: "map-1", stampId: layered.id, at: { x: 2, y: 3 }, allowCreateLayers: true,
  }), "STAMP_MAPPING_REQUIRED");
  expect(h.host.snapshot()).toEqual(before);
  expect(h.api.getState()).toEqual(state);
});
