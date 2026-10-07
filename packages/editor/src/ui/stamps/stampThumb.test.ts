import { createDocument, createStamp, FLIP_H, makeCell, MapStore, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { compositeOps } from "../../export/pngComposite";
import { stampDrawList, stampLayerCounts, thumbScale } from "./stampThumb";

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

function house() {
  const store = new MapStore(createDocument({ width: 10, height: 10, tileWidth: 16, tileHeight: 16 }));
  store.dispatch({ type: "addTileset", tileset: ts });
  const ground = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  const roof = store.dispatch({ type: "addLayer", layer: { name: "Çatı" } });
  const coll = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
  const a = store.getOrAddPaletteIndex("grass", 5);
  const b = store.getOrAddPaletteIndex("grass", 6);
  store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 2, y: 2, cell: makeCell(a) }, { x: 3, y: 3, cell: makeCell(a) }] });
  store.dispatch({ type: "paintCells", layerId: roof, cells: [{ x: 3, y: 2, cell: makeCell(b, FLIP_H) }] });
  store.dispatch({ type: "paintTerrain", layerId: coll, cells: [{ x: 2, y: 2, value: 1 }] });
  const doc = store.document;
  return createStamp(doc, doc.layers.map((l) => l.id), { x: 2, y: 2, width: 2, height: 2 }, { id: "ev", name: "Ev" });
}

describe("stamp thumbnails", () => {
  it("lists tile layers bottom to top in stamp pixel space; grid layers are skipped", () => {
    const stamp = house();
    expect(stampLayerCounts(stamp)).toEqual({ tile: 2, grid: 1 });
    const list = stampDrawList(stamp, 16, 16, (id) => (id === "grass" ? ts : undefined));
    expect(list.width).toBe(32);
    expect(list.height).toBe(32);
    expect(list.layers.map((l) => l.items.length)).toEqual([2, 1]);
    const roof = list.layers[1]!.items[0]!;
    expect(roof.dest).toEqual({ x: 16, y: 0, width: 16, height: 16 });
    expect(roof.src).toEqual({ x: 32, y: 16, width: 16, height: 16 });
    expect(roof.flipH).toBe(true);
    // Same compositing as PNG export: a flipped tile maps its left edge to the cell's right edge.
    const ops = compositeOps(list, 2);
    const last = ops.at(-1);
    expect(last?.kind === "draw" && last.transform).toEqual([-2, 0, 0, 2, 64, 0]);
  });

  it("skips tiles of unknown tilesets", () => {
    const list = stampDrawList(house(), 16, 16, () => undefined);
    expect(list.layers.every((l) => l.items.length === 0)).toBe(true);
  });

  it("fits thumbnails crisply", () => {
    expect(thumbScale(32, 32, 120, 80)).toBe(2);
    expect(thumbScale(16, 16, 120, 80)).toBe(4);
    expect(thumbScale(320, 160, 120, 80)).toBeCloseTo(0.375);
  });
});
