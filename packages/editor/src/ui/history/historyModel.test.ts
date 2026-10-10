import { createDocument, makeCell, MapStore } from "@smap/core";
import { describe, expect, it } from "vitest";

import { applyJump, historyRows, jumpFor } from "./historyModel";

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
    expect(rows[1]!.label).toBe("Kalem · 12 hücre");
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
