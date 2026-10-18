import { FLIP_D, FLIP_H, MapStore, createDocument, makeCell, serializeLevel } from "@smap/core";
import { afterEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../state/editorStore";
import { beginReplacementPick, cancelReplacementPick, closeTileReplacement, commitTileReplacement, consumeReplacementPick, openTileReplacement, rememberReplacementTile, replacementPlan, updateTileReplacement, useTileReplacement } from "./replaceTiles";

const tile = (tileId: number) => ({ tilesetId: "t", tileId });
function setup() {
  const store = new MapStore(createDocument({ width: 8, height: 8, tilesets: [{ id: "t", name: "T", imagePath: "t.png", tileWidth: 32, tileHeight: 32, columns: 4, rows: 4, margin: 0, spacing: 0 }] }));
  const a = store.dispatch({ type: "addLayer", layer: { name: "A" } });
  const b = store.dispatch({ type: "addLayer", layer: { name: "B" } });
  store.getOrAddPaletteIndex("t", 0);
  store.getOrAddPaletteIndex("t", 1);
  for (const layerId of [a, b]) store.dispatch({ type: "paintCells", layerId, cells: [{ x: 0, y: 0, cell: makeCell(1, FLIP_H | FLIP_D) }, { x: 1, y: 1, cell: 1 }] });
  useEditorStore.getState().setProject({ store, name: "P", levelPath: "p.json" });
  useEditorStore.getState().setActiveLayer(a);
  useEditorStore.getState().setTool("rect");
  useEditorStore.getState().setSelection(tile(1));
  rememberReplacementTile(store, tile(0));
  store.clearHistory();
  return { store, a, b };
}
const draft = () => useTileReplacement.getState().draft!;
const count = () => replacementPlan(draft()).reduce((n, p) => n + p.cells.length, 0);
afterEach(() => { closeTileReplacement(); useEditorStore.getState().setProject(null); });

describe("replacement session", () => {
  it("defaults from the last right-click and current brush; scopes are live and selection is the default when present", () => {
    const { store, b } = setup();
    useEditorStore.getState().setRegion({ x: 0, y: 0, width: 1, height: 1 });
    openTileReplacement();
    expect(draft()).toMatchObject({ from: tile(0), to: tile(1), scope: "selection" });
    expect(count()).toBe(1);
    updateTileReplacement({ scope: "active" });
    expect(count()).toBe(2);
    updateTileReplacement({ scope: "visible" });
    expect(count()).toBe(4);
    store.dispatch({ type: "setLayerProps", layerId: b, props: { locked: true } });
    expect(count()).toBe(2);
    useEditorStore.getState().setRegion(null);
    updateTileReplacement({ scope: "selection" });
    expect(count()).toBe(0);
  });

  it("picks either swatch without changing the brush; cancellation restores the tool and draft", () => {
    setup();
    openTileReplacement();
    beginReplacementPick("from");
    expect(useEditorStore.getState().tool).toBe("eyedropper");
    expect(consumeReplacementPick(tile(2))).toBe(true);
    expect(draft().from).toEqual(tile(2));
    expect(useEditorStore.getState().selection).toEqual(tile(1));
    expect(useEditorStore.getState().tool).toBe("rect");
    beginReplacementPick("to");
    cancelReplacementPick();
    expect(draft().to).toEqual(tile(1));
    expect(draft().picking).toBeNull();
    expect(consumeReplacementPick(tile(3))).toBe(false);
  });

  it("commits all layers in one undo and preserves flags", () => {
    const { store, a } = setup();
    const before = serializeLevel(store.document);
    openTileReplacement();
    updateTileReplacement({ scope: "visible" });
    expect(commitTileReplacement()).toBe(true);
    expect(store.undoDepth).toBe(1);
    expect(store.document.getLayer(a)!.getCell(0, 0)).toBe(makeCell(2, FLIP_H | FLIP_D));
    const after = serializeLevel(store.document);
    store.undo(); expect(serializeLevel(store.document)).toBe(before);
    store.redo(); expect(serializeLevel(store.document)).toBe(after);
    expect(useTileReplacement.getState().draft).toBeNull();
  });

  it("rejects zero matches and stale projects without changing history", () => {
    const { store } = setup();
    openTileReplacement(tile(1), tile(1));
    expect(commitTileReplacement()).toBe(false);
    expect(store.undoDepth).toBe(0);
    updateTileReplacement({ from: tile(0) });
    useEditorStore.getState().setProject(null);
    expect(count()).toBe(0);
    expect(commitTileReplacement()).toBe(false);
    expect(store.undoDepth).toBe(0);
  });

  it("resolves a new target palette entry at commit and cancellation never changes the map", () => {
    const { store, a } = setup();
    const before = serializeLevel(store.document);
    openTileReplacement(tile(0), tile(8));
    expect(count()).toBe(2);
    expect(serializeLevel(store.document)).toBe(before);
    closeTileReplacement();
    expect(serializeLevel(store.document)).toBe(before);
    openTileReplacement(tile(0), tile(8));
    expect(commitTileReplacement()).toBe(true);
    const cell = store.document.getLayer(a)!.getCell(0, 0);
    expect(store.document.palette.get(cell & 0x1fffffff)).toEqual(tile(8));
  });
});
