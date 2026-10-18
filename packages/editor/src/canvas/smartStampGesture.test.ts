import { smartRectangleUsage } from "./rectangleSource";
import { describe, expect, it } from "vitest";
import { applySmartStampPlan, bakedNineSliceTerrainSet, createDocument, FLIP_H, FLIP_V, makeCell, MapStore, nineSliceLayout, type Stamp } from "@smap/core";
import { addRoadSamples, smartGesturePlan, smartHoverGesture, smartMembership, smartRect } from "./smartStampGesture";
import { useSmartStampSession } from "../ui/stamps/smartStampSession";

function fixture() {
  const store = new MapStore(createDocument({ width: 80, height: 60, tileWidth: 5, tileHeight: 5 }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const stamp: Stamp = { id: "road", name: "Road", width: 3, height: 3, palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: "source", tileId })), layers: [{ layerId, name: "Ground", cells: Uint32Array.from({ length: 9 }, (_, i) => makeCell(i + 1)) }], nineSlice: { border: 1, tileLayers: [{ layerId, tilesetId: "generated" }], road: { tilesetId: "generated", setId: "road", terrainId: 1 } } };
  const ts = { id: "generated", name: "Road (yol)", imagePath: "tilesets/road.png", tileWidth: 5, tileHeight: 5, columns: 8, rows: Math.ceil(nineSliceLayout(stamp).slots / 8), margin: 0, spacing: 0 };
  store.dispatch({ type: "addTileset", tileset: { ...ts, terrainSets: [bakedNineSliceTerrainSet(stamp, layerId, { id: "road", name: "Road", terrainId: 1 })] } });
  return { store, stamp, layerId };
}
describe("smart gestures", () => {
  it("filled R keeps area phase in both usages; only road outlines use the road solver", () => {
    expect(smartRectangleUsage("area", 0)).toBe("area");
    expect(smartRectangleUsage("area", 2)).toBe("area");
    expect(smartRectangleUsage("road", 0)).toBe("area");
    expect(smartRectangleUsage("road", 2)).toBe("road");
  });
  it("keeps intended unclipped geometry, shrinks, reverses, squares and centres", () => {
    const { store, stamp, layerId } = fixture();
    const g = smartHoverGesture(store, stamp, layerId, { x: 5, y: 5 }, "area", 0, 1, "square");
    g.end = { x: -2, y: 2 }; expect(smartRect(g)).toEqual({ x: -2, y: 2, width: 8, height: 4 });
    g.end = { x: 4, y: 5 }; expect(smartRect(g)).toEqual({ x: 4, y: 5, width: 2, height: 1 });
    g.square = true; g.fromCenter = true; expect(smartRect(g)).toEqual({ x: 4, y: 4, width: 3, height: 3 });
  });
  for (const usage of ["area", "road"] as const) for (const orientation of [0, FLIP_H, (FLIP_H | FLIP_V) >>> 0]) {
    it(`${usage}: exact viewport plans equal commit, including repairs and one undo (${orientation})`, () => {
      const { store, stamp, layerId } = fixture();
      const seed = smartHoverGesture(store, stamp, layerId, { x: 12, y: 8 }, "road", 0, 1, "square");
      addRoadSamples(seed, [{ x: 12, y: 20 }]); applySmartStampPlan(store, smartGesturePlan(seed));
      const before = [...store.document.getLayer(layerId)!.chunks()].map(c => new Uint32Array(c.data));
      const g = smartHoverGesture(store, stamp, layerId, { x: 3, y: 8 }, usage, orientation, 1, "square");
      g.end = { x: 13, y: 18 }; if (usage === "road") addRoadSamples(g, [g.end]);
      const complete = smartGesturePlan(g);
      for (const window of [{ x: 0, y: 0, width: 7, height: 9 }, { x: 10, y: 7, width: 4, height: 4 }, { x: 13, y: 15, width: 20, height: 20 }]) {
        const preview = smartGesturePlan(g, window);
        for (const layer of preview.layers) for (const w of layer.writes) expect(complete.layers.find(l => l.layerId === layer.layerId)!.writes).toContainEqual(w);
      }
      store.beginTransaction(); applySmartStampPlan(store, complete); store.commit();
      for (const l of complete.layers) for (const w of l.writes) if ("tile" in w && w.tile) {
        const cell = store.document.getLayer(layerId)!.getCell(w.x, w.y); expect(cell).not.toBe(0);
      }
      expect(store.undo()).toBe(true); expect([...store.document.getLayer(layerId)!.chunks()].map(c => c.data)).toEqual(before); expect(store.redo()).toBe(true);
    });
  }
  it("road diagonals remain 4-connected and reversal invariant", () => {
    const { store, stamp, layerId } = fixture();
    const a = { x: 1, y: 1 }, b = { x: 6, y: 5 };
    const g = smartHoverGesture(store, stamp, layerId, a, "road", 0, 1, "square"); addRoadSamples(g, [b]);
    const reverse = smartHoverGesture(store, stamp, layerId, b, "road", 0, 1, "square"); addRoadSamples(reverse, [a]);
    expect([...g.members].sort()).toEqual([...reverse.members].sort()); expect(smartMembership(g).contains(2, 1)).toBe(true);
  });
  it("road rectangle bands use full membership and erase plans suppress old tiles and repair neighbours", () => {
    const { store, stamp, layerId } = fixture();
    const g = { ...smartHoverGesture(store, stamp, layerId, { x: 2, y: 2 }, "road", 0, 1, "square"), rectangle: true, thickness: 1, end: { x: 8, y: 7 } };
    const membership = smartMembership(g);
    expect(membership.contains(2, 5)).toBe(true); expect(membership.contains(4, 4)).toBe(false);
    applySmartStampPlan(store, smartGesturePlan(g));
    expect(store.document.getLayer(layerId)!.getCell(4, 4)).toBe(0);
    const erase = smartHoverGesture(store, stamp, layerId, { x: 4, y: 2 }, "road", 0, 1, "square", true);
    const full = smartGesturePlan(erase), window = { x: 3, y: 1, width: 3, height: 3 };
    const local = smartGesturePlan(erase, window);
    expect(local.layers[0]!.writes).toEqual(full.layers[0]!.writes);
    expect(full.layers[0]!.writes).toContainEqual({ x: 4, y: 2, tile: null });
    expect(full.layers[0]!.writes.length).toBeGreaterThan(1);
    applySmartStampPlan(store, full); expect(store.document.getLayer(layerId)!.getCell(4, 2)).toBe(0);
  });

  it("session composition preserves the saved recipe across two mirrors and four turns", () => {
    useSmartStampSession.setState({ orientation: 0 });
    const session = useSmartStampSession.getState(); session.transform(FLIP_H); session.transform(FLIP_H);
    expect(useSmartStampSession.getState().orientation).toBe(0);
    // A quarter turn is transpose + horizontal mirror.
    for (let i = 0; i < 4; i++) session.transform(0xa0000000);
    expect(useSmartStampSession.getState().orientation).toBe(0);
  });
});
