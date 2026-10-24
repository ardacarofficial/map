import { describe, expect, it } from "vitest";
import { createDocument, MapStore } from "@smap/core";
import { documentShape, shapeDiff } from "./draftChanges";

describe("review bar change shapes", () => {
  it("counts layer and entity changes, not only cells", () => {
    const store = new MapStore(createDocument({ width: 4, height: 4 }));
    const ground = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
    const doors = store.dispatch({ type: "addLayer", layer: { name: "Kapılar", type: "entity" } });
    const door = store.dispatch({ type: "addEntity", layerId: doors, entity: { typeId: "portal", x: 0, y: 0 } });
    const before = documentShape(store.document);
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { locked: true } });
    store.dispatch({ type: "addLayer", layer: { name: "Üst" } });
    store.dispatch({ type: "moveEntity", entityId: String(door), x: 32, y: 0 });
    store.dispatch({ type: "addEntity", layerId: doors, entity: { typeId: "spawn", x: 64, y: 0 } });
    const after = documentShape(store.document);
    expect(shapeDiff(before.layers, after.layers)).toBe(2);
    expect(shapeDiff(before.entities, after.entities)).toBe(2);
    expect(shapeDiff(after.layers, documentShape(store.document).layers)).toBe(0);
  });
});
