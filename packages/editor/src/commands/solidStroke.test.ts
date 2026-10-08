import { createDocument, MapStore, type Tileset } from "@smap/core";
import { beforeEach, describe, expect, it } from "vitest";
import { SolidStroke } from "./solidStroke";

const tiles: Tileset = {
  id: "t",
  name: "T",
  imagePath: "tilesets/t.png",
  tileWidth: 16,
  tileHeight: 16,
  columns: 4,
  rows: 4,
  margin: 0,
  spacing: 0,
};

let store: MapStore;
const solid = () => [...(store.document.getTileset("t")!.solidTiles ?? [])];

beforeEach(() => {
  store = new MapStore(createDocument({ width: 4, height: 4 }));
  store.dispatch({ type: "addTileset", tileset: tiles });
  store.clearHistory();
});

describe("SolidStroke", () => {
  it("marks every crossed tile (line-filled) and makes one undo step", () => {
    const stroke = new SolidStroke(store, "t", 0, 0, true);
    expect(stroke.solid).toBe(true);
    stroke.moveTo(3, 0); // jumps: 1 and 2 are filled in
    stroke.moveTo(3, 1);
    stroke.moveTo(3, 1);
    stroke.end();
    expect(solid()).toEqual([0, 1, 2, 3, 7]);
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(solid()).toEqual([]);
  });

  it("the right button unmarks; tiles already in the target state are left alone", () => {
    store.dispatch({ type: "setTileSolid", tilesetId: "t", tileIds: [0, 2], solid: true });
    store.clearHistory();
    const stroke = new SolidStroke(store, "t", 0, 0, false);
    expect(stroke.solid).toBe(false);
    stroke.moveTo(3, 0);
    stroke.moveTo(0, 0); // revisiting does not toggle back
    stroke.end();
    expect(solid()).toEqual([]);
    expect(store.undoDepth).toBe(1);
  });

  it("the direction comes from the button, not from the first tile", () => {
    store.dispatch({ type: "setTileSolid", tilesetId: "t", tileIds: [0], solid: true });
    store.clearHistory();
    // Left-drag starting on a solid tile keeps marking.
    const mark = new SolidStroke(store, "t", 0, 0, true);
    mark.moveTo(2, 0);
    mark.end();
    expect(solid()).toEqual([0, 1, 2]);
    // Right-drag starting on a free tile keeps unmarking.
    const unmark = new SolidStroke(store, "t", 3, 0, false);
    unmark.moveTo(0, 0);
    unmark.end();
    expect(solid()).toEqual([]);
  });

  it("ignores tiles outside the tileset and a stroke that changes nothing adds no step", () => {
    const stroke = new SolidStroke(store, "t", 1, 1, true);
    stroke.moveTo(-3, 1);
    stroke.moveTo(1, 1);
    stroke.moveTo(1, 9);
    stroke.end();
    expect(solid()).toEqual([4, 5, 9, 13]);
    stroke.moveTo(2, 2); // after end: ignored
    expect(solid()).toEqual([4, 5, 9, 13]);
    expect(store.inTransaction).toBe(false);
  });
});
