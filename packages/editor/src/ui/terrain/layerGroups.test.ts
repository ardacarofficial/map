import { createDocument, MapStore } from "@smap/core";
import { describe, expect, it } from "vitest";

import { layerRows, layerUnits, moveUnitOrder, unitIndexOf } from "./layerGroups";

function setup() {
  const store = new MapStore(createDocument({ width: 8, height: 8 }));
  const ground = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const grass = store.dispatch({ type: "addLayer", layer: { name: "Çimen" } });
  const terrain = store.dispatch({ type: "addLayer", layer: { type: "grid", role: "terrain", targetLayerId: grass, name: "Çimen (arazi)" } });
  const coll = store.dispatch({ type: "addLayer", layer: { type: "grid", role: "collision", name: "Collision" } });
  return { store, ground, grass, terrain, coll };
}

describe("layer groups", () => {
  it("groups a terrain layer with the derived tile layer right below it (top first)", () => {
    const { store, ground, grass, terrain, coll } = setup();
    const units = layerUnits(store.document);
    expect(units.map((u) => [u.head.id, u.child?.id ?? null])).toEqual([
      [coll, null],
      [terrain, grass],
      [ground, null],
    ]);
    expect(unitIndexOf(units, grass)).toBe(1);
    expect(unitIndexOf(units, null)).toBe(-1);
  });

  it("collapsed by default; expanded shows the derived row nested", () => {
    const { store, grass, terrain } = setup();
    const units = layerUnits(store.document);
    expect(layerRows(units, new Set()).map((r) => r.kind)).toEqual(["layer", "group", "layer"]);
    const rows = layerRows(units, new Set([terrain]));
    expect(rows.map((r) => r.kind)).toEqual(["layer", "group", "derived", "layer"]);
    const derived = rows[2]!;
    expect(derived.kind === "derived" && derived.layer.id === grass && derived.parent.id === terrain && derived.unit === 1).toBe(true);
  });

  it("does not group a pair that was pulled apart", () => {
    const { store, grass, terrain } = setup();
    store.dispatch({ type: "moveLayer", layerId: grass, index: 0 });
    const units = layerUnits(store.document);
    expect(units.every((u) => u.child === null)).toBe(true);
    expect(units.some((u) => u.head.id === terrain)).toBe(true);
  });

  it("moving a group moves both layers and keeps them adjacent", () => {
    const { store, ground, grass, terrain, coll } = setup();
    const units = layerUnits(store.document);
    // Group (unit 1) to the top.
    expect(moveUnitOrder(units, 1, 0)).toEqual([ground, coll, grass, terrain]);
    // Collision (unit 0) to the bottom.
    expect(moveUnitOrder(units, 0, 2)).toEqual([coll, ground, grass, terrain]);
    // No move / out of range keeps the order.
    expect(moveUnitOrder(units, 1, 1)).toEqual([ground, grass, terrain, coll]);
    expect(moveUnitOrder(units, 1, 9)).toEqual([grass, terrain, ground, coll]);
  });
});
