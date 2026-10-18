import { createDocument, MapStore } from "@smap/core";
import { afterEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../state/editorStore";
import { installLayerSync } from "./layerSync";

let off: (() => void) | undefined;
afterEach(() => {
  off?.();
  useEditorStore.getState().setProject(null);
});

function setup() {
  const store = new MapStore(createDocument({ width: 8, height: 8 }));
  const ground = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const hidden = store.dispatch({ type: "addLayer", layer: { name: "Hidden", visible: false } });
  useEditorStore.getState().setProject({ name: "Test", levelPath: "test.json", store });
  useEditorStore.getState().setActiveLayer(ground);
  off = installLayerSync();
  return { store, ground, hidden };
}

describe("active layer recovery", () => {
  it("undo of add restores the recently active layer instead of a hidden neighbour", () => {
    const { store, ground } = setup();
    const added = store.dispatch({ type: "addLayer", layer: { name: "New" } });
    useEditorStore.getState().setActiveLayer(added);
    store.undo();
    expect(useEditorStore.getState().activeLayerId).toBe(ground);
  });

  it("a history jump skips vanished MRU entries and keeps the last surviving selection", () => {
    const { store, ground } = setup();
    const checkpoint = store.peekUndo()!.id;
    const first = store.dispatch({ type: "addLayer", layer: { name: "First" } });
    useEditorStore.getState().setActiveLayer(first);
    const second = store.dispatch({ type: "addLayer", layer: { name: "Second" } });
    useEditorStore.getState().setActiveLayer(second);
    store.undoTo(checkpoint);
    expect(useEditorStore.getState().activeLayerId).toBe(ground);
  });

  it("without a surviving MRU prefers a visible unlocked tile layer near the removed position", () => {
    const { store, ground, hidden } = setup();
    off?.();
    const removed = store.dispatch({ type: "addLayer", layer: { name: "Removed" } });
    useEditorStore.getState().setActiveLayer(removed);
    off = installLayerSync();
    store.undo();
    expect(useEditorStore.getState().activeLayerId).toBe(ground);
    // An explicit selection of a hidden layer remains the user's choice.
    useEditorStore.getState().setActiveLayer(hidden);
    expect(useEditorStore.getState().activeLayerId).toBe(hidden);
  });

  it("MRU belongs to its level, so matching ids in another document do not leak", () => {
    const { ground } = setup();
    const other = new MapStore(createDocument({ width: 8, height: 8 }));
    other.dispatch({ type: "addLayer", layer: { id: ground, name: "Hidden", visible: false } });
    const visible = other.dispatch({ type: "addLayer", layer: { name: "Visible" } });
    const removed = other.dispatch({ type: "addLayer", layer: { name: "Removed" } });
    useEditorStore.getState().switchLevel({ name: "Other", levelPath: "other.json", store: other }, removed);
    other.undo();
    expect(useEditorStore.getState().activeLayerId).toBe(visible);
  });
});
