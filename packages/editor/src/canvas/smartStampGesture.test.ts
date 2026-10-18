import { buildLayout1RoadProfile } from "@smap/core";
import { describe, expect, it } from "vitest";
import { applySmartStampPlan, buildRoadProfile, createDocument, FLIP_H, FLIP_V, makeCell, MapStore, nineSliceLayout, planSmartStampRoad, type Stamp, type RoadMembership } from "@smap/core";
import { addRoadSamples, smartGesturePlan, smartHoverGesture, smartMembership, smartRect } from "./smartStampGesture";
import { useSmartStampSession } from "../ui/stamps/smartStampSession";

function fixture(width = 80, height = 60) {
  const store = new MapStore(createDocument({ width, height, tileWidth: 5, tileHeight: 5 }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const stamp: Stamp = { id: "road", name: "Road", width: 3, height: 3, palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: "source", tileId })), layers: [{ layerId, name: "Ground", cells: Uint32Array.from({ length: 9 }, (_, i) => makeCell(i + 1)) }], nineSlice: { border: 1, tileLayers: [{ layerId, tilesetId: "generated" }], road: { tilesetId: "generated", profile: buildLayout1RoadProfile(3, 3) } } };
  const ts = { id: "generated", name: "Road (yol)", imagePath: "tilesets/road.png", tileWidth: 5, tileHeight: 5, columns: 8, rows: Math.ceil(nineSliceLayout(stamp).slots / 8), margin: 0, spacing: 0 };
  store.dispatch({ type: "addTileset", tileset: { ...ts, roadProfile: buildRoadProfile(stamp, layerId) } });
  return { store, stamp, layerId };
}
describe("smart gestures", () => {
  it("restored single-layer recipes use the active layer for both area and road", () => {
    const { store, stamp, layerId } = fixture();
    const activeId = store.dispatch({ type: "addLayer", layer: { name: "Overlay" } });
    for (const usage of ["area", "road"] as const) {
      const g = smartHoverGesture(store, stamp, activeId, { x: 4, y: 4 }, usage, 0, 1, "square");
      const plan = smartGesturePlan(g);
      expect(plan.layers[0]!.layerId).toBe(activeId);
      applySmartStampPlan(store, plan);
      expect(store.document.getLayer(layerId)!.getCell(4, 4)).toBe(0);
      expect(store.document.getLayer(activeId)!.getCell(4, 4)).not.toBe(0);
    }
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
  it("1024² diagonal: sparse deduplicated membership preserves plans while avoiding the bounding-box scan", () => {
    const { store, stamp, layerId } = fixture(1024, 1024);
    const g = smartHoverGesture(store, stamp, layerId, { x: 1, y: 1 }, "road", 0, 1, "square");
    addRoadSamples(g, [{ x: 512, y: 512 }, { x: 1, y: 1 }, { x: 512, y: 512 }]);
    const membership = smartMembership(g);
    expect(g.members.size).toBe(1023);
    expect(membership.cells).toHaveLength(1023);
    expect(new Set(membership.cells!.map(p => `${p.x},${p.y}`))).toEqual(g.members);
    expect(membership.bounds).toEqual({ x: 1, y: 1, width: 512, height: 512 });
    // Reproduce the former bounding-box membership with the same Set lookup.
    let denseQueries = 0;
    const dense: RoadMembership = { bounds: membership.bounds, contains: (x, y) => { denseQueries++; return g.members.has(`${x},${y}`); } };
    let sparseQueries = 0;
    const sparse: RoadMembership = { ...membership, contains: (x, y) => { sparseQueries++; return membership.contains(x, y); } };
    const options = { revision: store.revision, orientation: g.orientation, mapping: g.mapping };
    const before = planSmartStampRoad(store.document, stamp, layerId, dense, options);
    const after = planSmartStampRoad(store.document, stamp, layerId, sparse, options);
    expect(after).toEqual(before);
    expect(smartGesturePlan(g)).toEqual(before);
    // Deterministic complexity guard; no fragile wall-clock threshold on shared CI CPUs.
    expect(denseQueries).toBeGreaterThan(2_000_000);
    expect(sparseQueries).toBeLessThan(30_000);
    const legacyPlan = () => {
      const start = performance.now();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const key of g.members) { const [x, y] = key.split(",").map(Number) as [number, number]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      planSmartStampRoad(store.document, stamp, layerId, { bounds: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, contains: (x, y) => g.members.has(`${x},${y}`) }, options);
      return performance.now() - start;
    };
    const currentPlan = () => { const start = performance.now(); smartGesturePlan(g); return performance.now() - start; };
    // Warm both paths, then report medians of five complete plans, including membership construction.
    legacyPlan(); currentPlan();
    const beforeMs: number[] = [], afterMs: number[] = [];
    for (let i = 0; i < 5; i++) { beforeMs.push(legacyPlan()); afterMs.push(currentPlan()); }
    const median = (values: number[]) => values.sort((a, b) => a - b)[2]!.toFixed(2);
    console.info(`1024² diagonal (1,1)→(512,512), 1023 members; CPU median/5: before=${median(beforeMs)}ms after=${median(afterMs)}ms; membership queries=${denseQueries}→${sparseQueries}`);
  }, 30_000);
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
