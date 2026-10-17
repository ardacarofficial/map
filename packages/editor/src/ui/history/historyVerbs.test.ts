import { createDocument, MapStore } from "@smap/core";
import { describe, expect, it } from "vitest";

import { HistoryVerbs } from "./historyVerbs";

const makeStore = () => new MapStore(createDocument({ width: 8, height: 8 }));

describe("history verbs captured without a history panel", () => {
  it("keeps each step's verb through undo/redo and prunes discarded branches", () => {
    const store = makeStore();
    const verbs = new HistoryVerbs();
    verbs.bind(store);
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "A" } });
    const addId = store.peekUndo()!.id;
    store.dispatch({ type: "setLayerProps", layerId, props: { name: "B" } });
    const renameId = store.peekUndo()!.id;
    expect(verbs.labelOf(addId)).toBe("history.layerAdd");
    expect(verbs.labelOf(renameId)).toBe("history.layerRename");
    store.undo();
    expect(verbs.labelOf(renameId)).toBe("history.layerRename");
    store.redo();
    expect(verbs.labelOf(renameId)).toBe("history.layerRename");
    store.undo();
    store.dispatch({ type: "setLayerProps", layerId, props: { visible: false } });
    expect(verbs.labelOf(renameId)).toBeNull();
    expect(verbs.labelOf(store.peekUndo()!.id)).toBe("history.layerHide");
    store.clearHistory();
    expect(verbs.labels.size).toBe(0);
    verbs.bind(undefined);
  });

  it("resets on store changes and stops listening to the previous store", () => {
    const a = makeStore();
    const b = makeStore();
    const verbs = new HistoryVerbs();
    verbs.bind(a);
    a.dispatch({ type: "addLayer", layer: { name: "A" } });
    expect(verbs.labels.size).toBe(1);
    verbs.bind(b);
    expect(verbs.labels.size).toBe(0);
    a.dispatch({ type: "addLayer", layer: { name: "Detached" } });
    expect(verbs.labels.size).toBe(0);
    b.dispatch({ type: "addLayer", layer: { name: "B" } });
    expect(verbs.labelOf(b.peekUndo()!.id)).toBe("history.layerAdd");
    verbs.bind(undefined);
  });
});
