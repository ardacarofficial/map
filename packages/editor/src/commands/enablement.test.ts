import { createDocument, makeCell, MapStore, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";
import {
  canCopy,
  canDeselect,
  canErase,
  canFlip,
  canPaste,
  canRedo,
  canRemoveLayer,
  canUndo,
  clampRegion,
  type EditContext,
} from "./enablement";

const tiles: Tileset = {
  id: "t",
  name: "T",
  imagePath: "tilesets/t.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 4,
  rows: 4,
  margin: 0,
  spacing: 0,
};

function setup() {
  const store = new MapStore(createDocument({ width: 8, height: 6 }));
  store.dispatch({ type: "addTileset", tileset: tiles });
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "A" } });
  store.clearHistory();
  const ctx = (over: Partial<EditContext> = {}): EditContext => ({
    store,
    activeLayerId: layerId,
    region: null,
    stamp: null,
    selection: null,
    ...over,
  });
  return { store, layerId, ctx };
}

describe("command enablement", () => {
  it("undo / redo follow the store history", () => {
    const { store, layerId, ctx } = setup();
    expect(canUndo(ctx())).toBe(false);
    const p = store.getOrAddPaletteIndex("t", 1);
    store.dispatch({ type: "paintCells", layerId, cells: [{ x: 0, y: 0, cell: makeCell(p) }] });
    expect(canUndo(ctx())).toBe(true);
    expect(canRedo(ctx())).toBe(false);
    store.undo();
    expect(canRedo(ctx())).toBe(true);
    store.beginTransaction();
    expect(canRedo(ctx())).toBe(false); // nothing during a stroke
    store.commit();
  });

  it("copy / cut / delete need a region on the map and an active layer", () => {
    const { store, layerId, ctx } = setup();
    const region = { x: 1, y: 1, width: 2, height: 2 };
    expect(canCopy(ctx())).toBe(false);
    expect(canCopy(ctx({ region }))).toBe(true);
    expect(canCopy(ctx({ region: { x: 20, y: 20, width: 2, height: 2 } }))).toBe(false);
    expect(canCopy(ctx({ region, activeLayerId: null }))).toBe(false);
    expect(canErase(ctx({ region }))).toBe(true);
    store.dispatch({ type: "setLayerProps", layerId, props: { locked: true } });
    expect(canCopy(ctx({ region }))).toBe(true);
    expect(canErase(ctx({ region }))).toBe(false); // locked layer is read-only
    expect(canCopy({ ...ctx({ region }), store: null })).toBe(false);
  });

  it("paste, deselect, flip and layer removal", () => {
    const { store, ctx } = setup();
    expect(canPaste(ctx())).toBe(true);
    expect(canDeselect(ctx())).toBe(false);
    expect(canDeselect(ctx({ region: { x: 0, y: 0, width: 1, height: 1 } }))).toBe(true);
    expect(canFlip(ctx())).toBe(false);
    expect(canFlip(ctx({ selection: { tilesetId: "t", tileId: 2 } }))).toBe(true);
    expect(canRemoveLayer(ctx())).toBe(false); // the last layer stays
    store.dispatch({ type: "addLayer", layer: { name: "B" } });
    expect(canRemoveLayer(ctx())).toBe(true);
  });

  it("clamps regions to the map", () => {
    expect(clampRegion({ x: -2, y: 3, width: 5, height: 10 }, 8, 6)).toEqual({ x: 0, y: 3, width: 3, height: 3 });
    expect(clampRegion({ x: 8, y: 0, width: 2, height: 2 }, 8, 6)).toBeNull();
  });
});
