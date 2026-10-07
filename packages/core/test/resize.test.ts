import { describe, expect, it } from "vitest";
import { parseLevel, serializeLevel, type StoreChangeEvent } from "../src";
import { makeStore } from "./helpers";

describe("resizeMap", () => {
  it("grows to the right/bottom without touching content", () => {
    const { store, ground, cell } = makeStore(40, 40);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 39, y: 39, cell: cell(1) }] });
    const events: StoreChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.dispatch({ type: "resizeMap", width: 100, height: 50 });
    expect(store.document.map).toMatchObject({ width: 100, height: 50, tileWidth: 32 });
    expect(store.document.getLayer(ground)!.getCell(39, 39)).toBe(cell(1));
    expect(events[0]).toMatchObject({ cause: "dispatch", structure: ["map"], cells: [], historyChanged: true });
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 99, y: 49, cell: cell(2) }] });
    const text = serializeLevel(store.document);
    expect(serializeLevel(parseLevel(text))).toBe(text);
  });

  it("shifts content with an offset and rebuilds chunk addressing from the origin", () => {
    const { store, ground, top, cell } = makeStore(40, 40);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: cell(1) }, { x: 31, y: 5, cell: cell(2) }] });
    store.dispatch({ type: "paintCells", layerId: top, cells: [{ x: 10, y: 10, cell: cell(3) }] });
    const before = serializeLevel(store.document);
    store.dispatch({ type: "resizeMap", width: 43, height: 41, offsetX: 3, offsetY: 1 });
    const layer = store.document.getLayer(ground)!;
    expect(layer.getCell(3, 1)).toBe(cell(1));
    expect(layer.getCell(34, 6)).toBe(cell(2));
    expect(layer.getCell(0, 0)).toBe(0);
    expect([...layer.chunks()].map((c) => c.key).sort()).toEqual(["0,0", "1,0"]);
    expect(store.document.getLayer(top)!.getCell(13, 11)).toBe(cell(3));
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
  });

  it("clipped content comes back on undo", () => {
    const { store, ground, cell } = makeStore(100, 80);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 99, y: 79, cell: cell(1) }, { x: 2, y: 2, cell: cell(2) }, { x: 50, y: 3, cell: cell(3) }] });
    const before = serializeLevel(store.document);
    store.dispatch({ type: "resizeMap", width: 10, height: 10, offsetX: -1, offsetY: -1 });
    const layer = store.document.getLayer(ground)!;
    expect(layer.getCell(1, 1)).toBe(cell(2));
    expect(layer.chunkCount).toBe(1);
    const after = serializeLevel(store.document);
    expect(serializeLevel(parseLevel(after))).toBe(after);
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
    store.redo();
    expect(serializeLevel(store.document)).toBe(after);
  });

  it("validates and treats an identical resize as a no-op", () => {
    const { store } = makeStore(10, 10);
    store.dispatch({ type: "resizeMap", width: 10, height: 10 });
    expect(store.canUndo).toBe(false);
    expect(() => store.dispatch({ type: "resizeMap", width: 0, height: 10 })).toThrow(/width/);
    expect(() => store.dispatch({ type: "resizeMap", width: 10, height: 10, offsetX: 0.5 })).toThrow(/integers/);
    expect(store.document.map.width).toBe(10);
  });

  it("painting before and after a resize in one transaction is one step", () => {
    const { store, ground, cell } = makeStore(20, 20);
    const before = serializeLevel(store.document);
    store.beginTransaction();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 5, y: 5, cell: cell(1) }] });
    store.dispatch({ type: "resizeMap", width: 30, height: 30, offsetX: 10, offsetY: 0 });
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 15, y: 5, cell: cell(2) }, { x: 25, y: 25, cell: cell(3) }] });
    store.commit();
    const after = serializeLevel(store.document);
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
    store.redo();
    expect(serializeLevel(store.document)).toBe(after);
  });

  it("rollback restores size and content", () => {
    const { store, ground, cell } = makeStore(20, 20);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 19, y: 19, cell: cell(1) }] });
    const before = serializeLevel(store.document);
    store.beginTransaction();
    store.dispatch({ type: "resizeMap", width: 5, height: 5 });
    store.dispatch({ type: "removeLayer", layerId: ground });
    store.rollback();
    expect(serializeLevel(store.document)).toBe(before);
  });
});
