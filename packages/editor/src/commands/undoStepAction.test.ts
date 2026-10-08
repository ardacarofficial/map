import { createDocument, makeCell, MapStore } from "@smap/core";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../state/editorStore";
import { useToastStore } from "../ui/toast/toastStore";
import { removeLayer } from "./layerActions";
import { undoStepAction } from "./undoStepAction";

let store: MapStore;
let base: string;
let index: number;

/** A store at the history limit `limit`, already full. */
function setup(limit: number): void {
  store = new MapStore(createDocument({ width: 8, height: 8 }), { historyLimit: limit });
  store.dispatch({
    type: "addTileset",
    tileset: { id: "t", name: "T", imagePath: "t.png", tileWidth: 32, tileHeight: 32, columns: 4, rows: 4, margin: 0, spacing: 0 },
  });
  base = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  index = store.getOrAddPaletteIndex("t", 0);
  for (let x = 0; x < limit; x++) paint(x);
  useEditorStore.getState().setProject({ name: "x", store, levelPath: "levels/main.json" });
}

function paint(x: number): void {
  store.dispatch({ type: "paintCells", layerId: base, cells: [{ x, y: 7, cell: makeCell(index) }] });
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  setup(3);
});

describe("undoStepAction (toast 'Geri al' for one step)", () => {
  it("undoes its step while it is on top", () => {
    const layer = store.dispatch({ type: "addLayer", layer: { name: "Üst" } });
    const action = undoStepAction(store);
    expect(action.enabled!()).toBe(true);
    action.run();
    expect(store.document.getLayer(layer)).toBeUndefined();
  });

  it("at the history limit a later step keeps the depth, but the action knows it is not its step", () => {
    const layer = store.dispatch({ type: "addLayer", layer: { name: "Üst" } });
    const action = undoStepAction(store);
    const depth = store.undoDepth;
    paint(5); // the oldest step falls off: the depth is the same as right after the edit
    expect(store.undoDepth).toBe(depth);
    expect(action.enabled!()).toBe(false);
    action.run();
    // Nothing undone: the paint and the layer stay.
    expect(store.document.getLayer(base)!.getCell(5, 7)).toBe(makeCell(index));
    expect(store.document.getLayer(layer)).toBeDefined();
    // Undoing the paint puts the step back on top: the action applies again.
    store.undo();
    expect(action.enabled!()).toBe(true);
  });

  it("watch reports history changes", () => {
    store.dispatch({ type: "addLayer", layer: { name: "Üst" } });
    const action = undoStepAction(store);
    let calls = 0;
    const off = action.watch!(() => calls++);
    paint(6);
    expect(calls).toBeGreaterThan(0);
    off();
    const before = calls;
    paint(4);
    expect(calls).toBe(before);
  });

  it("is disabled once another document is open", () => {
    store.dispatch({ type: "addLayer", layer: { name: "Üst" } });
    const action = undoStepAction(store);
    const other = new MapStore(createDocument({ width: 4, height: 4 }));
    useEditorStore.getState().setProject({ name: "y", store: other, levelPath: "levels/main.json" });
    expect(action.enabled!()).toBe(false);
  });

  it("removeLayer's toast does not undo a later step at the history limit", () => {
    const layer = store.dispatch({ type: "addLayer", layer: { name: "Üst" } });
    expect(removeLayer(layer)).toBe(true);
    const action = useToastStore.getState().toasts.at(-1)!.action!;
    paint(5);
    action.run();
    expect(store.document.getLayer(layer)).toBeUndefined();
    expect(store.document.getLayer(base)!.getCell(5, 7)).toBe(makeCell(index));
    store.undo(); // the paint
    action.run(); // now the removal is on top again
    expect(store.document.getLayer(layer)).toBeDefined();
  });

  it("is spent once its step is undone some other way (Ctrl+Z), not when a later step covers it", () => {
    store.dispatch({ type: "addLayer", layer: { name: "Üst" } });
    const action = undoStepAction(store);
    expect(action.spent!()).toBe(false);
    paint(5);
    expect(action.spent!()).toBe(false);
    store.undo(); // the paint
    expect(action.spent!()).toBe(false);
    store.undo(); // the step itself
    expect(action.spent!()).toBe(true);
    expect(action.enabled!()).toBe(false);
  });

  it("is spent once another document is open", () => {
    store.dispatch({ type: "addLayer", layer: { name: "Üst" } });
    const action = undoStepAction(store);
    useEditorStore.getState().setProject({ name: "y", store: new MapStore(createDocument({ width: 4, height: 4 })), levelPath: "levels/main.json" });
    expect(action.spent!()).toBe(true);
  });

  it("the toast goes away when its step is undone elsewhere, and stays while a later step only covers it", () => {
    const layer = store.dispatch({ type: "addLayer", layer: { name: "Üst" } });
    expect(removeLayer(layer)).toBe(true);
    const toastId = useToastStore.getState().toasts.at(-1)!.id;
    const shown = () => useToastStore.getState().toasts.some((t) => t.id === toastId);
    paint(5);
    expect(shown()).toBe(true);
    store.undo(); // the paint
    expect(shown()).toBe(true);
    store.undo(); // the removal (Ctrl+Z)
    expect(store.document.getLayer(layer)).toBeDefined();
    expect(shown()).toBe(false);
    store.redo(); // dismissed for good: no stale button comes back
    expect(shown()).toBe(false);
  });
});
