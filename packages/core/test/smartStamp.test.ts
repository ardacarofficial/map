import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDocument } from "../src/document";
import { MapStore } from "../src/store";
import { serializeLevel, parseLevel } from "../src/serialize";
import { bakedNineSliceTerrainSet, nineSliceLayout, orientPoint } from "../src/nineSlice";
import { terrainCellInfo, terrainMembership } from "../src/terrainBrush";
import { FLIP_H, FLIP_V, FLIP_D, cellFlags } from "../src/cell";
import { flipBlobMask } from "../src/terrainSet";
import type { Stamp } from "../src/stamp";
import type { CellPoint } from "../src/geometry";
import { applySmartStampArea, applySmartStampPlan, applySmartStampRoad, orthogonalBridge, planSmartStampArea, planSmartStampRoad } from "../src/smartStamp";
import { source } from "./smartStampHelpers";

export function fixture(width = 24, height = 24, seed = 17) {
  const s = source(4, 5), l = nineSliceLayout(s);
  const set = bakedNineSliceTerrainSet(s, "s", { id: "road", name: "Road", terrainId: 1 });
  const stamp: Stamp = { ...s, id: "road", name: "Road", nineSlice: { border: 1, tileLayers: [{ layerId: "s", tilesetId: "baked" }], road: { tilesetId: "baked", setId: "road", terrainId: 1 } } };
  const store = new MapStore(createDocument({ width, height, seed, tilesets: [{ id: "baked", name: "Baked", imagePath: "tilesets/baked.png", tileWidth: 32, tileHeight: 32, columns: l.slots, rows: 1, margin: 0, spacing: 0, terrainSets: [set] }] }));
  store.dispatch({ type: "addLayer", layer: { id: "l", name: "Road" } });
  for (let i = 0; i < l.slots; i++) store.getOrAddPaletteIndex("baked", i);
  store.clearHistory();
  return { store, stamp };
}
const opts = (store: MapStore) => ({ revision: store.revision });
const cells = (store: MapStore) => serializeLevel(store.document);

describe("smart stamp plans", () => {
  it("plans without mutation, applies once, and undoes/redoes exactly including created layers", () => {
    const { store, stamp } = fixture();
    const layered: Stamp = { ...stamp, layers: [...stamp.layers, { layerId: "g", name: "Collision", grid: true, role: "collision", cells: new Uint32Array(20).fill(2) }] };
    const before = cells(store), plan = planSmartStampArea(store.document, layered, { x: -2, y: -1, width: 9, height: 8 }, opts(store));
    expect(cells(store)).toBe(before); expect(store.undoDepth).toBe(0);
    const result = applySmartStampPlan(store, plan);
    expect(result.createdLayerIds).toHaveLength(1); expect(store.undoDepth).toBe(1);
    const after = cells(store); store.undo(); expect(cells(store)).toBe(before); store.redo(); expect(cells(store)).toBe(after);
  });

  it("skips hidden/locked matches, keeps one target per source, and does not create empty layers", () => {
    const { store, stamp } = fixture();
    store.dispatch({ type: "setLayerProps", layerId: "l", props: { locked: true } }); store.clearHistory();
    applySmartStampArea(store, stamp, { x: 1, y: 1, width: 4, height: 4 });
    expect(store.document.layers).toHaveLength(1); expect(store.undoDepth).toBe(0);
    store.dispatch({ type: "setLayerProps", layerId: "l", props: { locked: false, visible: false } }); store.clearHistory();
    applySmartStampArea(store, stamp, { x: 1, y: 1, width: 4, height: 4 }); expect(store.undoDepth).toBe(0);
    const before = cells(store);
    applySmartStampArea(store, stamp, { x: -20, y: -20, width: 2, height: 2 }); expect(cells(store)).toBe(before);
  });

  it("collapses collision conservatively and rejects unequal terrain-grid caps before changing anything", () => {
    const { store, stamp } = fixture();
    const values = new Uint32Array(20); values[0] = 2; values[3] = 1;
    const grid = { layerId: "g", name: "Grid", grid: true as const, role: "collision" as const, cells: values };
    applySmartStampArea(store, { ...stamp, layers: [...stamp.layers, grid] }, { x: 1, y: 1, width: 1, height: 1 });
    expect(store.document.layers[1]!.getCell(1, 1)).toBe(1);
    const before = cells(store);
    expect(() => applySmartStampArea(store, { ...stamp, layers: [...stamp.layers, { ...grid, role: "terrain" }] }, { x: 2, y: 2, width: 1, height: 1 })).toThrow(/equal/);
    expect(cells(store)).toBe(before);
  });

  it("guards stale/window plans and rolls back created layers inside a gesture", () => {
    const { store, stamp } = fixture(), rect = { x: 2, y: 2, width: 9, height: 6 };
    const plan = planSmartStampArea(store.document, stamp, rect, opts(store));
    store.dispatch({ type: "setLayerProps", layerId: "l", props: { opacity: 0.5 } });
    expect(() => applySmartStampPlan(store, plan)).toThrow(/stale/);
    expect(() => applySmartStampPlan(store, planSmartStampArea(store.document, stamp, rect, { ...opts(store), window: rect }))).toThrow(/window/);
    const before = cells(store); store.beginTransaction();
    applySmartStampArea(store, { ...stamp, layers: [...stamp.layers, { layerId: "c", name: "C", grid: true, role: "collision", cells: new Uint32Array(20).fill(1) }] }, rect);
    store.rollback(); expect(cells(store)).toBe(before);
  });

  it("uses complete membership for window previews, including area-road repairs on both sides", () => {
    const { store, stamp } = fixture(128, 128);
    applySmartStampRoad(store, stamp, "l", terrainMembership([{ x: 8, y: 9 }, { x: 9, y: 9 }]));
    const rect = { x: 10, y: 3, width: 90, height: 90 }, window = { x: 7, y: 7, width: 8, height: 7 };
    const full = planSmartStampArea(store.document, stamp, rect, opts(store));
    const visible = planSmartStampArea(store.document, stamp, rect, { ...opts(store), window });
    const inWindow = (p: CellPoint) => p.x >= window.x - 1 && p.y >= window.y - 1 && p.x < window.x + window.width + 1 && p.y < window.y + window.height + 1;
    expect(visible.layers[0]!.writes).toEqual(full.layers[0]!.writes.filter(inWindow));
    applySmartStampPlan(store, full);
    const road = terrainCellInfo(store.document, "l", 9, 9, "baked", "road");
    expect(road?.kind === "blob" && (road.mask & 4)).toBe(4);
    const area = terrainCellInfo(store.document, "l", 10, 9, "baked", "road");
    expect(area?.kind === "blob" && (area.mask & 64)).toBe(64);
  });

  it("has partition-invariant topology, reordered deterministic writes, idempotence, undo and reopen", () => {
    fc.assert(fc.property(fc.array(fc.record({ x: fc.integer({ min: 0, max: 15 }), y: fc.integer({ min: 0, max: 15 }) }), { minLength: 1, maxLength: 50 }), fc.integer({ min: 0, max: 0xffff }), (points, seed) => {
      const a = fixture(16, 16, seed), b = fixture(16, 16, seed), membership = terrainMembership(points);
      const plan = planSmartStampRoad(a.store.document, a.stamp, "l", membership, opts(a.store));
      expect(planSmartStampRoad(a.store.document, a.stamp, "l", terrainMembership([...points].reverse()), opts(a.store))).toEqual(plan);
      const window = { x: 3, y: 4, width: 5, height: 6 };
      expect(planSmartStampRoad(a.store.document, a.stamp, "l", membership, { ...opts(a.store), window }).layers[0]!.writes).toEqual(plan.layers[0]!.writes.filter(p => p.x >= 2 && p.x < 9 && p.y >= 3 && p.y < 11));
      applySmartStampPlan(a.store, plan);
      b.store.beginTransaction(); for (const point of points) applySmartStampRoad(b.store, b.stamp, "l", terrainMembership([point])); b.store.commit();
      // Every partition resolves the same final masks and hash-selected variants.
      expect(cells(a.store)).toBe(cells(b.store));
      for (const p of points) expect(terrainCellInfo(a.store.document, "l", p.x, p.y, "baked", "road")).toEqual(terrainCellInfo(b.store.document, "l", p.x, p.y, "baked", "road"));
      const after = cells(a.store), depth = a.store.undoDepth;
      applySmartStampRoad(a.store, a.stamp, "l", membership); expect(cells(a.store)).toBe(after); expect(a.store.undoDepth).toBe(depth);
      expect(serializeLevel(parseLevel(after, a.store.document.tilesets))).toBe(after);
      a.store.undo(); a.store.redo(); expect(cells(a.store)).toBe(after);
    }), { numRuns: 45 });
  });

  it("emits oriented flags and refuses quarter-turns on nonsquare map tiles", () => {
    const { store, stamp } = fixture();
    applySmartStampRoad(store, stamp, "l", terrainMembership([{ x: 1, y: 1 }, { x: 2, y: 1 }]), { orientation: FLIP_H });
    expect(cellFlags(store.document.getLayer("l")!.getCell(1, 1))).toBe(FLIP_H);
    const nonsquare = new MapStore(createDocument({ width: 4, height: 4, tileWidth: 16, tileHeight: 32 }));
    expect(() => planSmartStampArea(nonsquare.document, stamp, { x: 0, y: 0, width: 2, height: 2 }, { revision: 0, orientation: FLIP_D })).toThrow(/square/);
  });
});

describe("canonical diagonal bridge", () => {
  it("is reversal invariant and always 4-connected", () => {
    fc.assert(fc.property(fc.tuple(fc.integer({ min: -100, max: 100 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: -100, max: 100 })), ([x, y, xx, yy]) => {
      const a = { x, y }, b = { x: xx, y: yy }, path = orthogonalBridge(a, b);
      expect(orthogonalBridge(b, a)).toEqual([...path].reverse());
      for (let i = 1; i < path.length; i++) expect(Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y)).toBe(1);
    }));
  });
});

describe("road shape and mapping regressions", () => {
  it("joins straight/L/T/cross/loop strokes, repairs an erase split, and preserves manual neighbours", () => {
    const { store, stamp } = fixture(16, 16);
    const path = [...orthogonalBridge({ x: 2, y: 5 }, { x: 10, y: 5 }), ...orthogonalBridge({ x: 6, y: 2 }, { x: 6, y: 10 }), ...orthogonalBridge({ x: 10, y: 5 }, { x: 10, y: 10 }), ...orthogonalBridge({ x: 10, y: 10 }, { x: 6, y: 10 })];
    // An untagged ordinary tile is fixed even within the repair halo.
    store.dispatch({ type: "addTileset", tileset: { id: "manual", name: "Manual", imagePath: "tilesets/manual.png", tileWidth: 32, tileHeight: 32, columns: 1, rows: 1, margin: 0, spacing: 0 } });
    const manual = store.getOrAddPaletteIndex("manual", 0);
    store.dispatch({ type: "paintCells", layerId: "l", cells: [{ x: 7, y: 4, cell: manual }] });
    store.clearHistory(); const before = cells(store);
    store.beginTransaction();
    for (let i = 0; i < path.length; i += 3) applySmartStampRoad(store, stamp, "l", terrainMembership(path.slice(i, i + 3)));
    store.commit(); expect(store.undoDepth).toBe(1);
    expect(store.document.getLayer("l")!.getCell(7, 4)).toBe(manual);
    expect(terrainCellInfo(store.document, "l", 6, 5, "baked", "road")).toMatchObject({ kind: "blob", mask: 85 });
    const full = cells(store);
    applySmartStampRoad(store, stamp, "l", terrainMembership([{ x: 5, y: 5 }]), { erase: true });
    expect(store.document.getLayer("l")!.getCell(5, 5)).toBe(0);
    expect(terrainCellInfo(store.document, "l", 4, 5, "baked", "road")).toMatchObject({ kind: "blob", mask: 64 });
    store.undo(); expect(cells(store)).toBe(full); store.undo(); expect(cells(store)).toBe(before);
  });

  it("respects duplicate names, kind/role matching and entity exclusion", () => {
    const { store, stamp } = fixture();
    store.dispatch({ type: "addLayer", layer: { id: "e", name: "Road", type: "entity" } });
    store.dispatch({ type: "addLayer", layer: { id: "l2", name: "Road" } });
    const second = { ...stamp.layers[0]!, layerId: "s2" };
    const layered: Stamp = { ...stamp, layers: [...stamp.layers, second], nineSlice: { border: 1, tileLayers: [...stamp.nineSlice!.tileLayers, { layerId: "s2", tilesetId: "baked2" }] } };
    store.dispatch({ type: "addTileset", tileset: { ...store.document.tilesets[0]!, id: "baked2", imagePath: "tilesets/baked2.png" } });
    const plan = planSmartStampArea(store.document, layered, { x: 1, y: 1, width: 2, height: 2 }, opts(store));
    expect(plan.layers.map(l => l.layerId)).toEqual(["l", "l2"]);
    applySmartStampPlan(store, plan);
    expect(store.document.getLayer("l")!.getCell(1, 1)).not.toBe(0);
    expect(store.document.getLayer("l2")!.getCell(1, 1)).not.toBe(0);
  });

  it("rolls back a mixed gesture after an execution failure, including missing-layer creation", () => {
    const { store, stamp } = fixture();
    const before = cells(store), rect = { x: 1, y: 1, width: 2, height: 2 };
    const plan = planSmartStampArea(store.document, stamp, rect, opts(store));
    const originalDispatch = store.dispatch.bind(store);
    store.dispatch = ((op: Parameters<MapStore["dispatch"]>[0]) => {
      if (op.type === "paintCells") throw new Error("injected execution failure");
      return originalDispatch(op);
    }) as MapStore["dispatch"];
    store.beginTransaction();
    originalDispatch({ type: "addLayer", layer: { name: "Temporary" } });
    // Recompute with the current revision; a failure must revert the outer gesture too.
    const current = planSmartStampArea(store.document, stamp, rect, opts(store));
    expect(() => applySmartStampPlan(store, current)).toThrow(/execution failure/);
    expect(store.inTransaction).toBe(false); expect(cells(store)).toBe(before);
    expect(() => applySmartStampPlan(store, plan)).toThrow(/stale/);
  });
});


describe("D4 road equivariance", () => {
  it("transforms membership, selected masks and emitted flags together for all eight orientations", () => {
    const points = [...orthogonalBridge({ x: 3, y: 2 }, { x: 9, y: 7 }), ...orthogonalBridge({ x: 5, y: 4 }, { x: 10, y: 4 })];
    const a = fixture(16, 16);
    applySmartStampRoad(a.store, a.stamp, "l", terrainMembership(points));
    for (const orientation of [0, FLIP_H, FLIP_V, FLIP_D, (FLIP_H | FLIP_D) >>> 0, (FLIP_V | FLIP_D) >>> 0, (FLIP_H | FLIP_V) >>> 0, (FLIP_H | FLIP_V | FLIP_D) >>> 0]) {
      const b = fixture(16, 16), transformed = points.map(p => orientPoint(p, 16, 16, orientation));
      applySmartStampRoad(b.store, b.stamp, "l", terrainMembership(transformed), { orientation });
      for (const p of points) {
        const q = orientPoint(p, 16, 16, orientation), old = terrainCellInfo(a.store.document, "l", p.x, p.y, "baked", "road")!, rotated = terrainCellInfo(b.store.document, "l", q.x, q.y, "baked", "road")!;
        expect(old.kind).toBe("blob"); expect(rotated.kind).toBe("blob");
        if (old.kind === "blob" && rotated.kind === "blob") expect(rotated.mask).toBe(flipBlobMask(old.mask, !!(orientation & FLIP_H), !!(orientation & FLIP_V), !!(orientation & FLIP_D)));
        expect(cellFlags(b.store.document.getLayer("l")!.getCell(q.x, q.y))).toBe(orientation);
      }
    }
  });
});

describe("raw-grid and empty-source placement", () => {
  it("supports grid-only recipes and legacy grids whose role comes from the matched target", () => {
    const { store } = fixture();
    store.dispatch({ type: "addLayer", layer: { id: "collision", name: "Grid", type: "grid", role: "collision" } });
    const values = new Uint32Array(9); values[0] = 2; values[2] = 1;
    const stamp: Stamp = { id: "grid", name: "Grid", width: 3, height: 3, palette: [], layers: [{ layerId: "g", name: "Grid", grid: true, cells: values }], nineSlice: { border: 1, tileLayers: [] } };
    applySmartStampArea(store, stamp, { x: 0, y: 0, width: 1, height: 1 });
    expect(store.document.getLayer("collision")!.getCell(0, 0)).toBe(1);
  });

  it("never emits reserved transparent source slots or creates a layer for an empty placement", () => {
    const { store, stamp } = fixture();
    const empty: Stamp = { ...stamp, layers: [{ ...stamp.layers[0]!, cells: new Uint32Array(20) }], nineSlice: { border: 1, tileLayers: stamp.nineSlice!.tileLayers } };
    const before = cells(store);
    applySmartStampArea(store, empty, { x: 0, y: 0, width: 1, height: 1 });
    expect(cells(store)).toBe(before); expect(store.undoDepth).toBe(0);
  });
});


it("area plans are pure, window-equivalent and reversible across random caps, crops and D4 orientations", () => {
  fc.assert(fc.property(fc.record({ x: fc.integer({ min: -20, max: 20 }), y: fc.integer({ min: -20, max: 20 }), width: fc.integer({ min: 1, max: 128 }), height: fc.integer({ min: 1, max: 128 }) }), fc.constantFrom(0, FLIP_H, FLIP_V, FLIP_D, (FLIP_H | FLIP_D) >>> 0), fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 20, maxLength: 20 }), (rect, orientation, values) => {
    const { store, stamp } = fixture(16, 16);
    const layered: Stamp = { ...stamp, layers: [...stamp.layers, { layerId: "g", name: "Collision", grid: true, role: "collision", cells: Uint32Array.from(values) }] };
    const before = cells(store), options = { revision: store.revision, orientation }, window = { x: 4, y: 5, width: 4, height: 3 };
    const plan = planSmartStampArea(store.document, layered, rect, options), visible = planSmartStampArea(store.document, layered, rect, { ...options, window });
    expect(cells(store)).toBe(before); expect(store.undoDepth).toBe(0);
    for (let i = 0; i < plan.layers.length; i++) expect(visible.layers[i]!.writes).toEqual(plan.layers[i]!.writes.filter(p => p.x >= 3 && p.x < 9 && p.y >= 4 && p.y < 9));
    applySmartStampPlan(store, plan);
    const after = cells(store);
    expect(store.undoDepth).toBeLessThanOrEqual(1);
    if (store.undoDepth) { store.undo(); expect(cells(store)).toBe(before); store.redo(); expect(cells(store)).toBe(after); }
    else expect(after).toBe(before);
  }), { numRuns: 35 });
});

it("keeps intended area phase and borders when clipped; road mode alone caps at map edges", () => {
  const { store, stamp } = fixture(16, 16), rect = { x: -4, y: -3, width: 12, height: 11 };
  const plan = planSmartStampArea(store.document, stamp, rect, opts(store));
  for (const write of plan.layers[0]!.writes) {
    const sx = write.x === rect.x + rect.width - 1 ? stamp.width - 1 : 1 + (write.x - rect.x - 1) % (stamp.width - 2);
    const sy = write.y === rect.y + rect.height - 1 ? stamp.height - 1 : 1 + (write.y - rect.y - 1) % (stamp.height - 2);
    expect("tile" in write && write.tile?.tileId).toBe(sy * stamp.width + sx);
  }
});

it("preserves intentional source holes and the surrounding authored variants in an isolated area", () => {
  const { store, stamp } = fixture(16, 16), sourceLayer = stamp.layers[0]!;
  const cellsWithHole = sourceLayer.cells.slice(); cellsWithHole[10] = 0;
  const holeStamp = { ...stamp, layers: [{ ...sourceLayer, cells: cellsWithHole }] };
  const rect = { x: 1, y: 1, width: 8, height: 9 }, plan = planSmartStampArea(store.document, holeStamp, rect, opts(store));
  for (const w of plan.layers[0]!.writes) {
    const x = w.x - 1, y = w.y - 1;
    const sx = x === 0 ? 0 : x === 7 ? 3 : 1 + (x - 1) % 2, sy = y === 0 ? 0 : y === 8 ? 4 : 1 + (y - 1) % 3;
    expect("tile" in w && w.tile?.tileId).toBe(sy * 4 + sx);
  }
  expect(plan.layers[0]!.writes.some(w => w.x === 3 && w.y === 3)).toBe(false);
});
