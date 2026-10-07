import { describe, expect, it } from "vitest";
import { createDocument, MapStore, serializeLevel, type StoreChangeEvent } from "../src";
import { makeStore } from "./helpers";

function record(store: MapStore): StoreChangeEvent[] {
  const events: StoreChangeEvent[] = [];
  store.subscribe((e) => events.push(e));
  return events;
}

const ids = (store: MapStore) => store.document.layers.map((l) => l.id);

describe("addLayer (undoable since v0.2)", () => {
  it("keeps its return value and becomes an undo step", () => {
    const store = new MapStore(createDocument({ width: 4, height: 4 }));
    const id = store.dispatch({ type: "addLayer", layer: { name: "A" } });
    expect(id).toBe("layer-1");
    expect(store.undoDepth).toBe(1);
    const events = record(store);
    store.undo();
    expect(ids(store)).toEqual([]);
    expect(events[0]).toMatchObject({ cause: "undo", structure: ["layers"], cells: [] });
    store.redo();
    expect(ids(store)).toEqual(["layer-1"]);
  });
});

describe("removeLayer", () => {
  it("removes and restores the layer with its chunks, position and props", () => {
    const { store, ground, top, cell } = makeStore(100, 80);
    store.dispatch({ type: "addLayer", layer: { id: "mid", name: "Mid", opacity: 0.5, visible: false }, index: 1 });
    store.dispatch({ type: "paintCells", layerId: "mid", cells: [{ x: 1, y: 1, cell: cell(2) }, { x: 70, y: 70, cell: cell(3) }] });
    store.dispatch({ type: "setLayerProps", layerId: "mid", props: { locked: true } });
    const before = serializeLevel(store.document);
    const events = record(store);
    store.dispatch({ type: "removeLayer", layerId: "mid" });
    expect(ids(store)).toEqual([ground, top]);
    expect(events.at(-1)).toMatchObject({ cause: "dispatch", structure: ["layers"], historyChanged: true });
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
    expect(store.document.getLayer("mid")).toMatchObject({ name: "Mid", opacity: 0.5, visible: false, locked: true });
    store.redo();
    expect(ids(store)).toEqual([ground, top]);
  });

  it("throws on an unknown layer", () => {
    const { store } = makeStore();
    expect(() => store.dispatch({ type: "removeLayer", layerId: "nope" })).toThrow(/unknown layer/);
  });

  it("removing and re-adding the same id in one transaction undoes correctly", () => {
    const { store, ground, cell } = makeStore(40, 40);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 3, y: 3, cell: cell(1) }] });
    const before = serializeLevel(store.document);
    store.beginTransaction();
    store.dispatch({ type: "removeLayer", layerId: ground });
    store.dispatch({ type: "addLayer", layer: { id: ground, name: "New ground" }, index: 0 });
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 3, y: 3, cell: cell(2) }, { x: 5, y: 5, cell: cell(2) }] });
    store.commit();
    const after = serializeLevel(store.document);
    expect(store.undoDepth).toBe(2);
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
    store.redo();
    expect(serializeLevel(store.document)).toBe(after);
  });

  it("undo drops dirty chunks of layers that no longer exist", () => {
    const store = new MapStore(createDocument({ width: 8, height: 8 }));
    store.dispatch({ type: "addTileset", tileset: { id: "t", name: "t", imagePath: "t.png", tileWidth: 8, tileHeight: 8, columns: 2, rows: 2, margin: 0, spacing: 0 } });
    const idx = store.getOrAddPaletteIndex("t", 0);
    store.beginTransaction();
    const id = store.dispatch({ type: "addLayer", layer: { name: "L" } });
    store.dispatch({ type: "paintCells", layerId: id, cells: [{ x: 0, y: 0, cell: idx }] });
    store.commit();
    const events = record(store);
    store.undo();
    expect(events[0]).toMatchObject({ structure: ["layers"], cells: [] });
    store.redo();
    expect(events[1]).toMatchObject({ structure: ["layers"], cells: [{ layerId: id, chunks: ["0,0"] }] });
  });
});

describe("moveLayer", () => {
  it("moves to the final index and undoes", () => {
    const { store } = makeStore();
    store.dispatch({ type: "addLayer", layer: { id: "c", name: "C" } });
    store.clearHistory();
    store.dispatch({ type: "moveLayer", layerId: "c", index: 0 });
    expect(ids(store)).toEqual(["c", "ground", "top"]);
    store.dispatch({ type: "moveLayer", layerId: "c", index: 2 });
    expect(ids(store)).toEqual(["ground", "top", "c"]);
    store.dispatch({ type: "moveLayer", layerId: "ground", index: 1 });
    expect(ids(store)).toEqual(["top", "ground", "c"]);
    store.undo();
    expect(ids(store)).toEqual(["ground", "top", "c"]);
    store.undo();
    expect(ids(store)).toEqual(["c", "ground", "top"]);
    store.undo();
    expect(ids(store)).toEqual(["ground", "top", "c"]);
    expect(store.canUndo).toBe(false);
  });

  it("same index is a no-op; bad index throws", () => {
    const { store } = makeStore();
    const events = record(store);
    store.dispatch({ type: "moveLayer", layerId: "top", index: 1 });
    expect(events).toEqual([]);
    expect(store.canUndo).toBe(false);
    expect(() => store.dispatch({ type: "moveLayer", layerId: "top", index: 2 })).toThrow(/index/);
    expect(() => store.dispatch({ type: "moveLayer", layerId: "top", index: -1 })).toThrow(/index/);
    expect(() => store.dispatch({ type: "moveLayer", layerId: "x", index: 0 })).toThrow(/unknown layer/);
  });
});

describe("setLayerProps", () => {
  it("changes props, emits a layers change, undoes and redoes", () => {
    const { store, ground } = makeStore();
    const events = record(store);
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { name: "Zemin", opacity: 0.25, visible: false } });
    expect(store.document.getLayer(ground)).toMatchObject({ name: "Zemin", opacity: 0.25, visible: false, locked: false });
    expect(events[0]).toMatchObject({ structure: ["layers"], historyChanged: true });
    store.undo();
    expect(store.document.getLayer(ground)!.props()).toEqual({ name: "Ground", opacity: 1, visible: true, locked: false });
    store.redo();
    expect(store.document.getLayer(ground)!.name).toBe("Zemin");
  });

  it("same values are a no-op; invalid values throw without changes", () => {
    const { store, ground } = makeStore();
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { name: "Ground", visible: true } });
    expect(store.canUndo).toBe(false);
    expect(() => store.dispatch({ type: "setLayerProps", layerId: ground, props: { opacity: 2 } })).toThrow(/opacity/);
    expect(() => store.dispatch({ type: "setLayerProps", layerId: "x", props: {} })).toThrow(/unknown layer/);
    expect(store.document.getLayer(ground)!.opacity).toBe(1);
  });

  it("unlocking a locked layer works and lock blocks painting", () => {
    const { store, ground, cell } = makeStore();
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { locked: true } });
    expect(store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: cell(1) }] }).cells).toEqual([]);
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { locked: false } });
    expect(store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: cell(1) }] }).cells).toHaveLength(1);
  });
});
