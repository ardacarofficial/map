import { createDocument, makeCell, MapStore, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { stampLayerIds, usedStampLayerIds } from "./stampActions";

const ts: Tileset = {
  id: "grass",
  name: "Grass",
  imagePath: "tilesets/grass.png",
  tileWidth: 16,
  tileHeight: 16,
  columns: 4,
  rows: 4,
  margin: 0,
  spacing: 0,
};

describe("stamp layers", () => {
  it("keeps only the layers that have something in the region", () => {
    const store = new MapStore(createDocument({ width: 10, height: 10, tileWidth: 16, tileHeight: 16 }));
    store.dispatch({ type: "addTileset", tileset: ts });
    const ground = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
    const roof = store.dispatch({ type: "addLayer", layer: { name: "Çatı" } });
    const coll = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "addLayer", layer: { name: "Entity", type: "entity" } });
    const a = store.getOrAddPaletteIndex("grass", 5);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 2, y: 2, cell: makeCell(a) }] });
    store.dispatch({ type: "paintCells", layerId: roof, cells: [{ x: 8, y: 8, cell: makeCell(a) }] });
    store.dispatch({ type: "paintTerrain", layerId: coll, cells: [{ x: 3, y: 3, value: 1 }] });
    const doc = store.document;
    expect(stampLayerIds(doc)).toEqual([ground, roof, coll]); // every layer but the entity layer
    // The roof tile is outside the region: only Zemin and Collision are saved.
    expect(usedStampLayerIds(doc, { x: 2, y: 2, width: 2, height: 2 })).toEqual([ground, coll]);
    expect(usedStampLayerIds(doc, { x: 5, y: 5, width: 2, height: 2 })).toEqual([]);
  });
});
