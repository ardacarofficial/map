import fc from "fast-check";
import { expect, it } from "vitest";
import { MapStore, createDocument } from "@smap/core";
import { error, harness, success, tile } from "./helpers";

it("layer protection and in-draft unlocks keep map/layer identities distinct across arbitrary colon boundaries", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    map: fc.nat(10000), part: fc.nat(10000), layer: fc.nat(10000),
    hidden: fc.boolean(), reverse: fc.boolean(),
  }), async value => {
    const tileset = { id: "tiles", name: "Tiles", tileWidth: 32, tileHeight: 32,
      columns: 8, rows: 8, margin: 0, spacing: 0, imagePath: "tiles.png" };
    const protectedMap = `m${value.map}`, protectedLayer = `p${value.part}:l${value.layer}`;
    const ordinaryMap = `${protectedMap}:p${value.part}`, ordinaryLayer = `l${value.layer}`;
    const maps = [
      { id: protectedMap, layerId: protectedLayer, protected: true },
      { id: ordinaryMap, layerId: ordinaryLayer, protected: false },
    ].map(item => {
      const store = new MapStore(createDocument({ width: 8, height: 8, tilesets: [tileset] }));
      store.dispatch({ type: "addLayer", layer: { id: item.layerId, name: item.layerId,
        locked: item.protected && !value.hidden, visible: !item.protected || !value.hidden } });
      store.clearHistory();
      return { id: item.id, store };
    });
    if (value.reverse) maps.reverse();
    const h = harness({ maps, tilesets: [tileset] }), before = h.host.snapshot();
    await h.begin(maps.map(map => map.id));
    success(await h.edit("paint_cells", { mapId: ordinaryMap, layerId: ordinaryLayer,
      cells: [{ x: 0, y: 0, value: tile }] }));
    const pending = h.host.snapshot(), counters = h.api.getState().transaction!.counters;
    error(await h.edit("paint_cells", { mapId: protectedMap, layerId: protectedLayer,
      cells: [{ x: 0, y: 0, value: tile }] }), value.hidden ? "LAYER_HIDDEN" : "LAYER_LOCKED");
    expect(h.host.snapshot()).toEqual(pending);
    expect(h.api.getState().transaction!.counters).toEqual(counters);
    // Unlocking inside this draft counts only for that exact map/layer identity.
    success(await h.edit("edit_layer", { mapId: protectedMap, action: "update", layerId: protectedLayer,
      props: { locked: false, visible: true } }));
    success(await h.edit("paint_cells", { mapId: protectedMap, layerId: protectedLayer,
      cells: [{ x: 0, y: 0, value: tile }] }));
    await h.api.userAction("discard");
    expect(h.host.snapshot()).toEqual(before);
    await h.api.dispose();
  }), { numRuns: 40 });
});
