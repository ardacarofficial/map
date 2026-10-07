import { describe, expect, it } from "vitest";
import {
  cellPaletteIndex,
  COLLISION_SOLID,
  createStamp,
  FLIP_H,
  FLIP_V,
  FormatError,
  hasFlipH,
  hasFlipV,
  makeCell,
  makeStampId,
  parseStamp,
  placeStamp,
  serializeLevel,
  serializeStamp,
  stampLayerMapping,
  stampPath,
  type MapStore,
} from "../src";
import { makeStore } from "./helpers";

/** A 3×2 "house": ground row, wall + roof cells, one solid collision cell. */
function houseStore() {
  const { store, cell } = makeStore(20, 20);
  store.dispatch({ type: "setLayerProps", layerId: "top", props: { name: "Roof" } });
  store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
  store.dispatch({ type: "addLayer", layer: { id: "ents", name: "Entities", type: "entity" } });
  store.dispatch({ type: "paintCells", layerId: "ground", cells: [0, 1, 2].flatMap((x) => [{ x, y: 1, cell: cell(1) }]) });
  store.dispatch({ type: "paintCells", layerId: "top", cells: [{ x: 0, y: 0, cell: cell(2) }, { x: 1, y: 0, cell: cell(3, FLIP_H) }] });
  store.dispatch({ type: "paintTerrain", layerId: "col", cells: [{ x: 0, y: 1, value: COLLISION_SOLID }] });
  store.clearHistory();
  return store;
}

function house(store: MapStore) {
  return createStamp(store.document, ["ground", "top", "col", "ents"], { x: 0, y: 0, width: 3, height: 2 }, { id: "ev", name: "Ev" });
}

describe("stamps", () => {
  it("keep every tile and grid layer (entity layers skipped) with grid roles", () => {
    const stamp = house(houseStore());
    expect(stamp.layers.map((l) => [l.name, l.grid ?? false, l.role])).toEqual([
      ["Ground", false, undefined],
      ["Roof", false, undefined],
      ["Collision", true, "collision"],
    ]);
    expect(() => createStamp(houseStore().document, ["ground"], { x: 0, y: 0, width: 1, height: 1 }, { id: "Bad Id", name: "x" })).toThrow(/stamp id/);
  });

  it("serialize → parse roundtrips byte-identically", () => {
    const stamp = house(houseStore());
    const text = serializeStamp(stamp);
    expect(text).toContain('"format": "smap-stamp"');
    expect(text).toContain('"role": "collision"');
    const parsed = parseStamp(text);
    expect(parsed).toEqual(stamp);
    expect(serializeStamp(parsed)).toBe(text);
    expect(stampPath(stamp.id)).toBe("stamps/ev.json");
    expect(() => parseStamp(text.replace('"id": "ev"', '"id": "../ev"'))).toThrow(FormatError);
  });

  it("makeStampId slugs Turkish names and avoids clashes", () => {
    expect(makeStampId("Büyük Ev")).toBe("buyuk-ev");
    expect(makeStampId("Çeşme Işığı", ["cesme-isigi"])).toBe("cesme-isigi-2");
    expect(makeStampId("Café")).toBe("cafe");
    expect(makeStampId("!!!")).toBe("stamp");
  });

  it("places into layers matched by name in one undo step", () => {
    const store = houseStore();
    const stamp = house(store);
    const before = serializeLevel(store.document);
    const result = placeStamp(store, stamp, 10, 10);
    expect(result.createdLayerIds).toEqual([]);
    expect([...result.layerMapping]).toEqual([["ground", "ground"], ["top", "top"], ["col", "col"]]);
    const doc = store.document;
    expect(doc.getLayer("ground")!.getCell(12, 11)).toBe(makeCell(1));
    expect(doc.getLayer("top")!.getCell(11, 10)).toBe(makeCell(3, FLIP_H));
    expect(doc.getLayer("col")!.getCell(10, 11)).toBe(COLLISION_SOLID);
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(serializeLevel(doc)).toBe(before);
  });

  it("flips on X and Y (cells mirrored, flags toggled)", () => {
    const store = houseStore();
    placeStamp(store, house(store), 10, 10, { flip: { x: true, y: true } });
    const top = store.document.getLayer("top")!;
    // (0,0) → (2,1), (1,0) → (1,1)
    const a = top.getCell(12, 11);
    expect(cellPaletteIndex(a)).toBe(2);
    expect(hasFlipH(a) && hasFlipV(a)).toBe(true);
    const b = top.getCell(11, 11);
    expect(cellPaletteIndex(b)).toBe(3);
    expect(hasFlipH(b)).toBe(false);
    expect(hasFlipV(b)).toBe(true);
    expect(store.document.getLayer("col")!.getCell(12, 10)).toBe(COLLISION_SOLID);
    expect(store.document.getLayer("ground")!.getCell(10, 10)).toBe(makeCell(1, FLIP_H | FLIP_V));
  });

  it("falls back to the only layer of a kind, otherwise creates layers in the same undo step", () => {
    const stamp = house(houseStore());
    const { store } = makeStore(20, 20); // layers "Ground", "Top"; no collision layer
    store.dispatch({ type: "removeLayer", layerId: "top" });
    store.dispatch({ type: "setLayerProps", layerId: "ground", props: { name: "Zemin" } });
    store.clearHistory();
    const before = serializeLevel(store.document);
    expect(stampLayerMapping(store.document, stamp).map((t) => t.targetLayerId)).toEqual(["ground", null, null]);
    const result = placeStamp(store, stamp, 0, 0);
    expect(result.createdLayerIds).toHaveLength(2);
    const doc = store.document;
    expect(doc.layers.map((l) => [l.name, l.type])).toEqual([["Zemin", "tile"], ["Roof", "tile"], ["Collision", "grid"]]);
    expect(doc.getGridLayer(result.createdLayerIds[1]!)!.role).toBe("collision");
    expect(doc.getLayer(result.createdLayerIds[0]!)!.getCell(0, 0)).toBe(makeCell(2));
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(serializeLevel(doc)).toBe(before);
    store.redo();
    expect(doc.layers).toHaveLength(3);
  });

  it("a failing placement leaves nothing behind", () => {
    const stamp = house(houseStore());
    const { store } = makeStore(20, 20);
    store.dispatch({ type: "removeLayer", layerId: "top" });
    store.clearHistory();
    const broken = { ...stamp, palette: [{ tilesetId: "missing", tileId: 0 }, ...stamp.palette.slice(1)] };
    const before = serializeLevel(store.document);
    expect(() => placeStamp(store, broken, 0, 0)).toThrow(/unknown tileset/);
    expect(serializeLevel(store.document)).toBe(before);
    expect(store.inTransaction).toBe(false);
    expect(store.canUndo).toBe(false);
  });
});
