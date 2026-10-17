import { createDocument, makeCell, MapStore } from "@smap/core";
import { describe, expect, it } from "vitest";

import { applyJump, historyRows, itemLabel, jumpFor, verbForChanges } from "./historyModel";

function setup(steps: number) {
  const store = new MapStore(createDocument({ width: 8, height: 8 }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  store.clearHistory();
  store.dispatch({ type: "addTileset", tileset: { id: "ts", name: "TS", imagePath: "tilesets/ts.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 4, margin: 0, spacing: 0 } });
  const index = store.getOrAddPaletteIndex("ts", 1);
  store.clearHistory();
  for (let i = 0; i < steps; i++) store.dispatch({ type: "paintCells", layerId, cells: [{ x: i, y: 0, cell: makeCell(index) }] });
  return { store, layerId };
}

const rowsOf = (store: MapStore) => historyRows(store.historyEntries(), () => null);

describe("history list", () => {
  it("starts with Başlangıç and marks the newest step current", () => {
    const { store } = setup(3);
    const rows = rowsOf(store);
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "done", "current"]);
    expect(rows[0]!.id).toBeNull();
    expect(rows[1]!.label).toBe("1 hücre");
  });

  it("an empty history: Başlangıç is current", () => {
    const { store } = setup(0);
    expect(rowsOf(store).map((r) => r.state)).toEqual(["current"]);
  });

  it("undone steps follow the current one", () => {
    const { store } = setup(3);
    store.undo();
    expect(rowsOf(store).map((r) => r.state)).toEqual(["done", "done", "current", "undone"]);
  });

  it("uses the canvas label when known", () => {
    const { store } = setup(1);
    const id = store.peekUndo()!.id;
    const rows = historyRows(store.historyEntries(), (i) => (i === id ? { tool: "brush", cells: 12 } : null));
    expect(rows[1]!.label).toBe("Boya 12 hücre");
    expect(rows[1]!.tool).toBe("brush");
  });

  it("clicking a row makes it current (undo back, redo forward)", () => {
    const { store, layerId } = setup(4);
    const layer = () => store.document.getLayer(layerId)!;
    // Click "step 2" (index 2): steps 3 and 4 are undone.
    expect(applyJump(store, jumpFor(rowsOf(store), 2))).toBe(2);
    expect(rowsOf(store)[2]!.state).toBe("current");
    expect(layer().getCell(2, 0)).toBe(0);
    expect(layer().getCell(1, 0)).not.toBe(0);
    // Başlangıç: everything undone.
    expect(applyJump(store, jumpFor(rowsOf(store), 0))).toBe(2);
    expect(store.canUndo).toBe(false);
    // The last row: everything redone.
    expect(applyJump(store, jumpFor(rowsOf(store), 4))).toBe(4);
    expect(rowsOf(store)[4]!.state).toBe("current");
    // The current row: nothing.
    expect(jumpFor(rowsOf(store), 4)).toBeNull();
  });
});

describe("structural history verbs", () => {
  const top = (store: MapStore) => verbForChanges(store.peekUndo()!.changes);

  it("distinguishes layer add, move and removal", () => {
    const store = new MapStore(createDocument({ width: 8, height: 8 }));
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "A" } });
    expect(top(store)).toBe("history.layerAdd");
    store.dispatch({ type: "addLayer", layer: { name: "B" } });
    store.dispatch({ type: "moveLayer", layerId, index: 1 });
    expect(top(store)).toBe("history.layerMove");
    store.dispatch({ type: "removeLayer", layerId });
    expect(top(store)).toBe("history.layerRemove");
  });

  it.each([
    [{ name: "New" }, "history.layerRename"],
    [{ visible: false }, "history.layerHide"],
    [{ locked: true }, "history.layerLock"],
    [{ opacity: 0.5 }, "history.opacity"],
  ] as const)("names layer properties %j", (props, expected) => {
    const { store, layerId } = setup(0);
    store.dispatch({ type: "setLayerProps", layerId, props });
    expect(top(store)).toBe(expected);
  });

  it("distinguishes showing and unlocking", () => {
    const { store, layerId } = setup(0);
    store.dispatch({ type: "setLayerProps", layerId, props: { visible: false, locked: true } });
    store.dispatch({ type: "setLayerProps", layerId, props: { visible: true } });
    expect(top(store)).toBe("history.layerShow");
    store.dispatch({ type: "setLayerProps", layerId, props: { locked: false } });
    expect(top(store)).toBe("history.layerUnlock");
  });

  it("distinguishes entity add, move, field edit and removal", () => {
    const store = new MapStore(createDocument({ width: 8, height: 8 }));
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "Objects", type: "entity" } });
    const entityId = store.dispatch({ type: "addEntity", layerId, entity: { typeId: "portal", x: 0, y: 0 } })!;
    expect(top(store)).toBe("history.entityAdd");
    store.dispatch({ type: "moveEntity", entityId, x: 16, y: 16 });
    expect(top(store)).toBe("history.entityMove");
    store.dispatch({ type: "updateEntity", entityId, fields: { targetLevel: "other" } });
    expect(top(store)).toBe("history.entityField");
    store.dispatch({ type: "removeEntity", entityId });
    expect(top(store)).toBe("history.entityRemove");
  });

  it("uses map and project settings verbs, with a null cell-only fallback", () => {
    const { store } = setup(1);
    expect(top(store)).toBeNull();
    expect(verbForChanges([])).toBeNull();
    store.dispatch({ type: "resizeMap", width: 12, height: 12, offsetX: 0, offsetY: 0 });
    expect(top(store)).toBe("history.mapResize");
    store.dispatch({ type: "setMapProps", background: "#112233" });
    expect(top(store)).toBe("history.mapProps");
  });

  it("keeps a core transaction label ahead of stroke summaries and cached verbs", () => {
    const item = { id: 1, kind: "cells", state: "done", label: "Custom transaction", cellCount: 2 } as const;
    expect(itemLabel(item, { tool: "brush", cells: 2 }, "history.layerAdd")).toBe("Custom transaction");
    expect(itemLabel({ id: 1, kind: "cells", state: "done", cellCount: 2 }, null, "history.layerAdd")).toBe("Katman ekle");
  });
});
