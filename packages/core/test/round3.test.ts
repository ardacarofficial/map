import { describe, expect, it } from "vitest";
import {
  COLLISION_SOLID,
  LayerMergeError,
  SPAWN_TYPE_ID,
  layerCellsAsRegion,
  layerContentBounds,
  makeCell,
  moveRegion,
  parseProject,
  rectCells,
  selectAllContent,
  serializeLevel,
  serializeProject,
  tilesetUsage,
  type MapStore,
  type StoreChangeEvent,
  type Tileset,
  uniqueLayerName,
} from "../src";
import { TILESET, makeStore } from "./helpers";

const WATER: Tileset = { ...TILESET, id: "water", name: "Water", imagePath: "tilesets/water.png" };

/** Level + project bytes (tileset metadata lives in the project file). */
function snap(store: MapStore): string {
  const doc = store.document;
  return serializeLevel(doc) + serializeProject({ name: "p", levels: [], tilesets: doc.tilesets, entityTypes: doc.entityTypes });
}

function structures(store: MapStore): StoreChangeEvent["structure"][] {
  const out: StoreChangeEvent["structure"][] = [];
  store.subscribe((e) => {
    if (e.structure.length > 0) out.push(e.structure);
  });
  return out;
}

describe("addTileset is undoable", () => {
  it("one step; undo removes it, redo brings it back", () => {
    const { store } = makeStore(8, 8);
    const before = snap(store);
    store.dispatch({ type: "addTileset", tileset: WATER });
    expect(store.undoDepth).toBe(1);
    expect(store.document.tilesets.map((t) => t.id)).toEqual(["grass", "water"]);
    const after = snap(store);
    store.undo();
    expect(store.document.getTileset("water")).toBeUndefined();
    expect(snap(store)).toBe(before);
    store.redo();
    expect(snap(store)).toBe(after);
  });

  it("undoable: false keeps the old behaviour (no step)", () => {
    const { store } = makeStore(8, 8);
    store.dispatch({ type: "addTileset", tileset: WATER, undoable: false });
    expect(store.undoDepth).toBe(0);
    expect(store.document.getTileset("water")).toBeDefined();
  });
});

describe("removeTileset", () => {
  it("clears all owned tile cells including locked layers, retains manual collision and undoes byte-exactly", () => {
    const { store, ground, top } = makeStore(12,12);
    store.dispatch({ type: "addTileset", tileset: WATER });
    const water = store.getOrAddPaletteIndex("water", 2);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{x:1,y:1,cell:1},{x:2,y:1,cell:water}] });
    store.dispatch({ type: "paintCells", layerId: top, cells: [{x:3,y:1,cell:1}] });
    store.dispatch({ type: "setLayerProps", layerId: top, props: {locked:true} });
    store.dispatch({ type: "addLayer", layer: { id:"collision",name:"Collision",type:"grid",role:"collision" } });
    store.dispatch({ type: "paintGrid", layerId: "collision", cells:[{x:1,y:1,value:1}] });
    const before=snap(store);store.clearHistory();
    expect(tilesetUsage(store.document,"grass")).toEqual({cells:2,layers:[ground,top]});
    store.dispatch({type:"removeTileset",tilesetId:"grass"});
    expect(store.document.getLayer(ground)!.getCell(1,1)).toBe(0);
    expect(store.document.getLayer(top)!.getCell(3,1)).toBe(0);
    expect(store.document.getLayer(ground)!.getCell(2,1)).toBe(water);
    expect(store.document.getLayer("collision")!.getCell(1,1)).toBe(1);
    const after=snap(store);store.undo();expect(snap(store)).toBe(before);store.redo();expect(snap(store)).toBe(after);
  });

  it("throws on an unknown tileset", () => {
    const { store } = makeStore(4, 4);
    expect(() => store.dispatch({ type: "removeTileset", tilesetId: "nope" })).toThrow(/unknown tileset/);
  });
});

describe("tileset metadata and order", () => {
  it("setTilesetMeta renames and groups; null / empty removes the group; undoable; no-op without change", () => {
    const { store } = makeStore(4, 4);
    const events = structures(store);
    store.dispatch({ type: "setTilesetMeta", tilesetId: "grass", name: "Çimen", group: "Dış" });
    expect(store.document.getTileset("grass")).toMatchObject({ name: "Çimen", group: "Dış" });
    expect(events).toEqual([["tilesets"]]);
    store.dispatch({ type: "setTilesetMeta", tilesetId: "grass", group: "Dış" });
    expect(store.undoDepth).toBe(1);
    store.dispatch({ type: "setTilesetMeta", tilesetId: "grass", group: null });
    expect("group" in store.document.getTileset("grass")!).toBe(false);
    store.dispatch({ type: "setTilesetMeta", tilesetId: "grass", group: "X" });
    store.dispatch({ type: "setTilesetMeta", tilesetId: "grass", group: "" });
    expect(store.document.getTileset("grass")!.group).toBeUndefined();
    while (store.undo());
    expect(store.document.getTileset("grass")).toEqual(TILESET);
    expect(() => store.dispatch({ type: "setTilesetMeta", tilesetId: "x", name: "a" })).toThrow(/unknown tileset/);
  });

  it("moveTileset reorders the list (display order); undoable; validates the index", () => {
    const { store } = makeStore(4, 4);
    store.dispatch({ type: "addTileset", tileset: WATER });
    store.dispatch({ type: "addTileset", tileset: { ...TILESET, id: "collision" } });
    store.clearHistory();
    store.dispatch({ type: "moveTileset", tilesetId: "collision", index: 0 });
    expect(store.document.tilesets.map((t) => t.id)).toEqual(["collision", "grass", "water"]);
    store.dispatch({ type: "moveTileset", tilesetId: "collision", index: 0 });
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(store.document.tilesets.map((t) => t.id)).toEqual(["grass", "water", "collision"]);
    expect(() => store.dispatch({ type: "moveTileset", tilesetId: "grass", index: 3 })).toThrow(RangeError);
  });

  it("group serializes only when set and roundtrips", () => {
    const grouped: Tileset = { ...WATER, group: "Zindan" };
    const text = serializeProject({ name: "p", levels: [], tilesets: [TILESET, grouped] });
    expect(text).toContain('"group": "Zindan"');
    expect(text.match(/"group"/g)).toHaveLength(1);
    expect(text.indexOf('"group"')).toBeLessThan(text.indexOf('"imagePath": "tilesets/water.png"'));
    const parsed = parseProject(text);
    expect(parsed.tilesets[1]!.group).toBe("Zindan");
    expect(parsed.tilesets[0]!.group).toBeUndefined();
    expect(serializeProject(parsed)).toBe(text);
    // Files without groups are unchanged.
    expect(serializeProject({ name: "p", levels: [], tilesets: [TILESET] })).not.toContain("group");
    expect(() => parseProject(text.replace('"group": "Zindan"', '"group": ""'))).toThrow(/group/);
  });
});

describe("duplicateLayer", () => {
  it("copies a tile layer right above it, with props and cells; one undo step", () => {
    const { store, ground, top, cell } = makeStore(40, 40);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: cell(2) }, { x: 35, y: 35, cell: cell(3, 1 << 31) }] });
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { opacity: 0.5, locked: true } });
    store.clearHistory();
    const before = snap(store);
    const id = store.dispatch({ type: "duplicateLayer", layerId: ground, name: "Ground copy" });
    const doc = store.document;
    expect(doc.layers.map((l) => l.id)).toEqual([ground, id, top]);
    const copy = doc.getLayer(id)!;
    expect(copy.props()).toEqual({ name: "Ground copy", visible: true, locked: true, opacity: 0.5 });
    expect(copy.getCell(1, 1)).toBe(cell(2));
    expect(copy.getCell(35, 35)).toBe(cell(3, 1 << 31));
    expect(store.undoDepth).toBe(1);
    // Independent storage.
    store.dispatch({ type: "setLayerProps", layerId: id, props: { locked: false } });
    store.dispatch({ type: "paintCells", layerId: id, cells: [{ x: 1, y: 1, cell: 0 }] });
    expect(doc.getLayer(ground)!.getCell(1, 1)).toBe(cell(2));
    while (store.undo());
    expect(snap(store)).toBe(before);
  });

  it("name defaults to a unique form of the source name; collision grids copy as collision", () => {
    const { store } = makeStore(8, 8);
    store.dispatch({ type: "addLayer", layer: { id: "col", name: "Col", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintGrid", layerId: "col", cells: [{ x: 2, y: 2, value: COLLISION_SOLID }] });
    const id = store.dispatch({ type: "duplicateLayer", layerId: "col" });
    const copy = store.document.getGridLayer(id)!;
    expect(copy.role).toBe("collision");
    expect(copy.name).toBe("Col 2");
    expect(copy.getCell(2, 2)).toBe(COLLISION_SOLID);
  });

  it("names copies uniquely within the level", () => {
    const { store } = makeStore(8, 8);
    store.dispatch({ type: "addLayer", layer: { id: "collision", name: "Collision", type: "grid", role: "collision" } });
    const doc = store.document;
    const id = store.dispatch({ type: "duplicateLayer", layerId: "collision" });
    const grid = doc.getGridLayer(id)!;
    expect(grid.name).not.toBe(doc.getLayer("collision")!.name);
    const id2 = store.dispatch({ type: "duplicateLayer", layerId: "collision", name: "Pair" });
    const grid2 = doc.getGridLayer(id2)!;
    expect(grid2.name).toBe("Pair");
    const tilesCopy = store.dispatch({ type: "duplicateLayer", layerId: "ground", name: "Pair" });
    expect(doc.getLayer(tilesCopy)!.name).toBe("Pair 2");
    const all = doc.layers.map((l) => l.name);
    expect(new Set(all).size).toBe(all.length);
    expect(uniqueLayerName(doc, "Pair")).toBe("Pair 3");
    expect(uniqueLayerName(doc, "Fresh")).toBe("Fresh");
    expect(uniqueLayerName(doc, "Fresh", ["Fresh"])).toBe("Fresh 2");
  });

  it("an entity layer copies with new entity ids and without the spawn point", () => {
    const { store } = makeStore(8, 8);
    store.dispatch({ type: "addLayer", layer: { id: "ents", name: "E", type: "entity" } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "e1", typeId: "portal", x: 32, y: 32 } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { typeId: SPAWN_TYPE_ID, x: 0, y: 0 } });
    const id = store.dispatch({ type: "duplicateLayer", layerId: "ents" });
    const copy = store.document.entityLayers().find((l) => l.id === id)!;
    expect(copy.entities).toHaveLength(1);
    expect(copy.entities[0]!.typeId).toBe("portal");
    expect(copy.entities[0]!.id).not.toBe("e1");
    expect(copy.entities[0]!.x).toBe(32);
    const ids = store.document.entityLayers().flatMap((l) => l.entities.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    const text = serializeLevel(store.document);
    store.undo();
    store.redo();
    expect(serializeLevel(store.document)).toBe(text);
  });

  it("throws on an unknown layer", () => {
    const { store } = makeStore(4, 4);
    expect(() => store.dispatch({ type: "duplicateLayer", layerId: "x" })).toThrow(/unknown layer/);
  });
});

describe("mergeLayerDown", () => {
  it("upper non-empty cells overwrite the lower layer, upper is removed; one undo step", () => {
    const { store, ground, top, cell } = makeStore(40, 40);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: cell(1) }, { x: 1, y: 0, cell: cell(1) }] });
    store.dispatch({ type: "paintCells", layerId: top, cells: [{ x: 1, y: 0, cell: cell(2) }, { x: 33, y: 33, cell: cell(3) }] });
    store.dispatch({ type: "setLayerProps", layerId: top, props: { opacity: 0.2, visible: false } });
    store.clearHistory();
    const before = snap(store);
    expect(store.dispatch({ type: "mergeLayerDown", layerId: top })).toBe(ground);
    const doc = store.document;
    expect(doc.layers.map((l) => l.id)).toEqual([ground]);
    const g = doc.getLayer(ground)!;
    expect([g.getCell(0, 0), g.getCell(1, 0), g.getCell(33, 33)]).toEqual([cell(1), cell(2), cell(3)]);
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(snap(store)).toBe(before);
  });

  it("refuses with a typed error and changes nothing", () => {
    const { store } = makeStore(8, 8);
    store.dispatch({ type: "addLayer", layer: { id: "collision", name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
    store.dispatch({ type: "addLayer", layer: { id: "b", name: "B" } });
    store.dispatch({ type: "addLayer", layer: { id: "ents", name: "E", type: "entity" } });
    store.dispatch({ type: "addLayer", layer: { id: "c", name: "C" } });
    store.clearHistory();
    const before = snap(store);
    const reason = (layerId: string) => {
      try {
        store.dispatch({ type: "mergeLayerDown", layerId });
      } catch (error) {
        expect(error).toBeInstanceOf(LayerMergeError);
        return (error as LayerMergeError).reason;
      }
      return "merged";
    };
    expect(reason("ground")).toBe("noLayerBelow");
    expect(reason("collision")).toBe("notTileLayer");
    expect(reason("a")).toBe("belowNotTileLayer");
    expect(reason("ents")).toBe("notTileLayer");
    expect(reason("c")).toBe("belowNotTileLayer");
    store.dispatch({ type: "setLayerProps", layerId: "b", props: { locked: true } });
    expect(reason("b")).toBe("locked");
    expect(() => store.dispatch({ type: "mergeLayerDown", layerId: "zz" })).toThrow(/unknown layer/);
    expect(store.undoDepth).toBe(1);
    while (store.undo());
    expect(snap(store)).toBe(before);
  });
});

describe("content bounds and regions", () => {
  it("layerContentBounds / layerCellsAsRegion / selectAllContent", () => {
    const { store, ground, top, cell } = makeStore(100, 100);
    expect(layerContentBounds(store.document.getLayer(ground)!)).toBeNull();
    expect(layerCellsAsRegion(store.document.getLayer(ground)!)).toBeNull();
    expect(selectAllContent(store.document, ground)).toBeNull();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 3, y: 40, cell: cell(1) }, { x: 70, y: 5, cell: cell(2) }, { x: 3, y: 41, cell: cell(1) }] });
    const layer = store.document.getLayer(ground)!;
    expect(layerContentBounds(layer)).toEqual({ x: 3, y: 5, width: 68, height: 37 });
    const region = layerCellsAsRegion(layer)!;
    expect(region.rect).toEqual({ x: 3, y: 5, width: 68, height: 37 });
    expect(region.count).toBe(3);
    expect(region.mask.reduce((a, b) => a + b, 0)).toBe(3);
    expect(region.mask[(40 - 5) * 68 + 0]).toBe(1);
    expect(region.mask[0 * 68 + 67]).toBe(1);
    expect(selectAllContent(store.document, ground)).toEqual({ x: 3, y: 5, width: 68, height: 37 });
    expect(selectAllContent(store.document, top)).toBeNull();
    expect(() => selectAllContent(store.document, "nope")).toThrow(/unknown layer/);

    store.dispatch({ type: "addLayer", layer: { id: "ents", name: "E", type: "entity" } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { typeId: "portal", x: 65, y: 40 } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { typeId: "portal", x: 300, y: 10 } });
    const ents = store.document.getLayer("ents")!;
    expect(layerContentBounds(ents)).toBeNull();
    expect(layerContentBounds(ents, store.document.map)).toEqual({ x: 2, y: 0, width: 8, height: 2 });
    expect(selectAllContent(store.document, "ents")).toEqual({ x: 2, y: 0, width: 8, height: 2 });
  });
});

describe("moveRegion", () => {
  it("moves tile cells as one undo step; empty cells of the block do not erase; off-map cells drop", () => {
    const { store, ground, top, cell } = makeStore(10, 10);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: cell(1) }, { x: 2, y: 2, cell: cell(2, 1 << 31) }, { x: 3, y: 1, cell: cell(4) }] });
    store.dispatch({ type: "paintCells", layerId: top, cells: [{ x: 1, y: 2, cell: cell(3) }] });
    store.clearHistory();
    const before = snap(store);
    const { rect } = moveRegion(store, [ground, top], { x: 1, y: 1, width: 2, height: 2 }, 2, 0);
    expect(rect).toEqual({ x: 3, y: 1, width: 2, height: 2 });
    expect(store.undoDepth).toBe(1);
    const g = store.document.getLayer(ground)!;
    const t = store.document.getLayer(top)!;
    expect([g.getCell(1, 1), g.getCell(2, 2), g.getCell(3, 1), g.getCell(4, 2)]).toEqual([0, 0, cell(1), cell(2, 1 << 31)]);
    expect([t.getCell(1, 2), t.getCell(3, 2)]).toEqual([0, cell(3)]);
    store.undo();
    expect(snap(store)).toBe(before);

    // A hole in the block keeps the destination cell; cells leaving the map are gone.
    moveRegion(store, [ground], { x: 1, y: 1, width: 3, height: 2 }, 0, 0);
    expect(store.undoDepth).toBe(0);
    moveRegion(store, [ground], { x: 1, y: 1, width: 2, height: 2 }, 1, 0);
    expect(g.getCell(3, 1)).toBe(cell(4));
    expect(g.getCell(2, 1)).toBe(cell(1));
    moveRegion(store, [ground], { x: 2, y: 1, width: 2, height: 2 }, 0, -2);
    expect(g.getCell(2, 1)).toBe(0);
    expect(g.chunkCount === 0 || g.getCell(3, 1) === 0).toBe(true);
  });

  it("skips locked layers and moves manual collision and entities in the rect", () => {
    const { store } = makeStore(12, 12);
    store.dispatch({ type: "addLayer", layer: { id: "collision", name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "addLayer", layer: { id: "locked", name: "L" } });
    const c = makeCell(store.getOrAddPaletteIndex("grass", 3));
    store.dispatch({ type: "paintCells", layerId: "locked", cells: [{ x: 3, y: 3, cell: c }] });
    store.dispatch({ type: "setLayerProps", layerId: "locked", props: { locked: true } });
    store.dispatch({ type: "paintGrid", layerId: "collision", cells: rectCells(2, 2, 4, 4).map((p) => ({ ...p, value: 1 })) });
    store.dispatch({ type: "addLayer", layer: { id: "ents", name: "E", type: "entity" } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "in", typeId: "portal", x: 3 * 32 + 5, y: 3 * 32 } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "out", typeId: "portal", x: 9 * 32, y: 9 * 32 } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "edge", typeId: "portal", x: 2 * 32, y: 2 * 32 } });
    store.clearHistory();
    const before = snap(store);
    moveRegion(store, ["collision", "locked", "ents"], { x: 2, y: 2, width: 3, height: 3 }, 4, -2);
    const doc = store.document;
    expect(store.undoDepth).toBe(1);
    expect(doc.getLayer("locked")!.getCell(3, 3)).toBe(c);
    const grid = doc.getLayer("collision")!;
    expect(grid.getCell(3, 3)).toBe(0);
    expect(grid.getCell(7, 1)).toBe(1);
    expect(grid.getCell(6, 0)).toBe(1);
    expect(doc.findEntity("in")!.entity).toMatchObject({ x: 7 * 32 + 5, y: 1 * 32 });
    expect(doc.findEntity("out")!.entity).toMatchObject({ x: 9 * 32, y: 9 * 32 });
    expect(doc.findEntity("edge")!.entity).toMatchObject({ x: 6 * 32, y: 0 });
    store.undo();
    expect(snap(store)).toBe(before);

    // Entities pushed off the map are removed (undo brings them back).
    moveRegion(store, ["ents"], { x: 0, y: 0, width: 12, height: 12 }, 0, -3);
    expect(doc.findEntity("edge")).toBeUndefined();
    expect(doc.findEntity("in")!.entity.y).toBe(0);
    store.undo();
    expect(snap(store)).toBe(before);
  });

  it("nests into an open transaction and validates its input", () => {
    const { store, ground, cell } = makeStore(10, 10);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: cell(1) }] });
    store.clearHistory();
    store.beginTransaction();
    moveRegion(store, [ground], { x: 1, y: 1, width: 1, height: 1 }, 1, 0);
    moveRegion(store, [ground], { x: 2, y: 1, width: 1, height: 1 }, 1, 0);
    store.commit();
    expect(store.undoDepth).toBe(1);
    expect(store.document.getLayer(ground)!.getCell(3, 1)).toBe(cell(1));
    expect(() => moveRegion(store, ["x"], { x: 0, y: 0, width: 1, height: 1 }, 1, 0)).toThrow(/unknown layer/);
    expect(() => moveRegion(store, [ground], { x: 0, y: 0, width: 0, height: 1 }, 1, 0)).toThrow(RangeError);
    expect(() => moveRegion(store, [ground], { x: 0, y: 0, width: 1, height: 1 }, 0.5, 0)).toThrow(RangeError);
  });
});
