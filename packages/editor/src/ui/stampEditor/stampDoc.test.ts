import { createDocument, createStamp, FLIP_D, FLIP_H, makeCell, MapStore, placeStamp, type Stamp, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { contentBounds, isStampLevelId, missingStampTilesets, stampEditLayout, stampEditStore, stampFromDocument, stampLevelId } from "./stampDoc";

const grass: Tileset = {
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

/** A level with a house-like 3×2 stamp: ground, roof (flipped / rotated cell) and collision. */
function setup(): { level: MapStore; stamp: Stamp } {
  const level = new MapStore(createDocument({ width: 20, height: 20, tileWidth: 16, tileHeight: 16 }));
  level.dispatch({ type: "addTileset", tileset: grass });
  const ground = level.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  const roof = level.dispatch({ type: "addLayer", layer: { name: "Çatı" } });
  const coll = level.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
  const a = level.getOrAddPaletteIndex("grass", 1);
  const b = level.getOrAddPaletteIndex("grass", 6);
  level.dispatch({
    type: "paintCells",
    layerId: ground,
    cells: [0, 1, 2].flatMap((x) => [0, 1].map((y) => ({ x: 5 + x, y: 5 + y, cell: makeCell(a) }))),
  });
  level.dispatch({ type: "paintCells", layerId: roof, cells: [{ x: 6, y: 5, cell: makeCell(b, FLIP_H | FLIP_D) }] });
  level.dispatch({ type: "paintGrid", layerId: coll, cells: [{ x: 7, y: 6, value: 1 }] });
  const stamp = createStamp(level.document, [ground, roof, coll], { x: 5, y: 5, width: 3, height: 2 }, { id: "ev", name: "Ev" });
  return { level, stamp: Object.freeze({ ...stamp, category: "Binalar", tags: ["köy"], favorite: true }) };
}

describe("stamp editor documents", () => {
  it("uses a stamp: level id that no real level has", () => {
    expect(stampLevelId("ev")).toBe("stamp:ev");
    expect(isStampLevelId("stamp:ev")).toBe(true);
    expect(isStampLevelId("main")).toBe(false);
    expect(isStampLevelId(null)).toBe(false);
  });

  it("centres the stamp with a margin on a map of at least the minimum size", () => {
    expect(stampEditLayout({ width: 3, height: 2 })).toEqual({ width: 16, height: 12, x: 6, y: 5 });
    expect(stampEditLayout({ width: 30, height: 10 })).toEqual({ width: 38, height: 18, x: 4, y: 4 });
  });

  it("opens with one layer per stamp layer (names, roles), no undo history, and saves back unchanged", () => {
    const { level, stamp } = setup();
    const store = stampEditStore(stamp, level.document);
    const doc = store.document;
    expect(doc.layers.map((l) => l.name)).toEqual(["Zemin", "Çatı", "Collision"]);
    expect(doc.layers[2]).toMatchObject({ type: "grid", role: "collision" });
    expect(doc.getTileset("grass")).toBeDefined();
    expect(store.canUndo).toBe(false);
    expect(contentBounds(doc)).toEqual({ x: 6, y: 5, width: 3, height: 2 });

    const saved = stampFromDocument(doc, { id: stamp.id, name: stamp.name })!;
    expect(saved.width).toBe(3);
    expect(saved.height).toBe(2);
    expect(saved.layers.map((l) => [l.name, l.grid ?? false, l.role])).toEqual([
      ["Zemin", false, undefined],
      ["Çatı", false, undefined],
      ["Collision", true, "collision"],
    ]);
    // Same picture: placing either stamp on an empty level gives the same cells (flip flags kept).
    const place = (s: Stamp) => {
      const target = new MapStore(createDocument({ width: 8, height: 8, tileWidth: 16, tileHeight: 16 }));
      target.dispatch({ type: "addTileset", tileset: grass });
      placeStamp(target, s, 1, 1);
      return createStamp(target.document, target.document.layers.map((l) => l.id), { x: 0, y: 0, width: 8, height: 8 }, { id: "x", name: "x" }).layers.map((l) => [...l.cells]);
    };
    expect(place(saved)).toEqual(place(stamp));
  });

  it("crops to the new content bounds when the stamp grows or shrinks", () => {
    const { level, stamp } = setup();
    const store = stampEditStore(stamp, level.document);
    const ground = store.document.layers[0]!.id;
    const idx = store.getOrAddPaletteIndex("grass", 3);
    // Grow: a tile two cells left of the stamp and one below.
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 4, y: 7, cell: makeCell(idx) }] });
    const grown = stampFromDocument(store.document, stamp)!;
    expect([grown.width, grown.height]).toEqual([5, 3]);
    // Shrink: erase everything but one roof cell.
    const doc = store.document;
    for (const layer of doc.layers) {
      const cells = [];
      for (let y = 0; y < doc.map.height; y++) for (let x = 0; x < doc.map.width; x++) if (!(layer.name === "Çatı" && x === 7 && y === 5)) cells.push({ x, y, cell: 0 });
      if (layer.type === "grid") store.dispatch({ type: "paintGrid", layerId: layer.id, cells: cells.map((c) => ({ x: c.x, y: c.y, value: 0 })) });
      else store.dispatch({ type: "paintCells", layerId: layer.id, cells });
    }
    const shrunk = stampFromDocument(store.document, stamp)!;
    expect([shrunk.width, shrunk.height]).toEqual([1, 1]);
    // Only the layer that still has content is kept.
    expect(shrunk.layers.map((l) => l.name)).toEqual(["Çatı"]);
    expect((shrunk.layers[0]!.cells[0]! & (FLIP_H | FLIP_D)) >>> 0).toBe((FLIP_H | FLIP_D) >>> 0);
  });

  it("an emptied stamp gives nothing to save", () => {
    const { level, stamp } = setup();
    const store = stampEditStore(stamp, level.document);
    const doc = store.document;
    for (const layer of doc.layers) {
      const all = [];
      for (let y = 0; y < doc.map.height; y++) for (let x = 0; x < doc.map.width; x++) all.push({ x, y });
      if (layer.type === "grid") store.dispatch({ type: "paintGrid", layerId: layer.id, cells: all.map((c) => ({ ...c, value: 0 })) });
      else store.dispatch({ type: "paintCells", layerId: layer.id, cells: all.map((c) => ({ ...c, cell: 0 })) });
    }
    expect(contentBounds(store.document)).toBeNull();
    expect(stampFromDocument(store.document, stamp)).toBeNull();
  });

  it("refuses a stamp whose tileset the level no longer has", () => {
    const { stamp } = setup();
    const bare = new MapStore(createDocument({ width: 4, height: 4, tileWidth: 16, tileHeight: 16 }));
    expect(missingStampTilesets(stamp, bare.document)).toEqual(["grass"]);
    expect(() => stampEditStore(stamp, bare.document)).toThrow(/missing tilesets/);
  });
});
