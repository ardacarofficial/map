import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, MapStore, serializeLevel } from "@smap/core";
import { useEditorStore } from "../state/editorStore";
import { useProjectLibrary } from "../io/projectLibrary";
import { copySelection, cutSelection, deleteSelection, getMemoryClip } from "./clipboard";
import { flipBrush } from "./rotateCommands";
import { saveSelectionAsStamp } from "./stampActions";
import { openTileReplacement, replacementPlan, closeTileReplacement, useTileReplacement } from "./replaceTiles";
import { selectionModifier } from "../shortcuts/shortcuts";
import { clampRegion } from "./enablement";
import { movedRegion, regionContains } from "../canvas/tools";
import { registerSelectionPickCommands } from "./selectionPick";
import { runCommand } from "./registry";

const region = { x: 1, y: 1, width: 2, height: 2, mask: Uint8Array.of(1, 1, 1, 0) };
let store: MapStore, ground: string, roof: string, collision: string;
beforeEach(() => {
  vi.stubGlobal("navigator", {});
  store = new MapStore(createDocument({ width: 12, height: 12 }));
  store.dispatch({ type: "addTileset", tileset: { id: "t", name: "T", imagePath: "t.png", columns: 4, rows: 4, tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 } });
  ground = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  roof = store.dispatch({ type: "addLayer", layer: { name: "Roof" } });
  collision = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
  const cell = store.getOrAddPaletteIndex("t", 1);
  for (const layerId of [ground, roof]) store.dispatch({ type: "paintCells", layerId, cells: [1, 2].flatMap(y => [1, 2].map(x => ({ x, y, cell }))) });
  store.dispatch({ type: "paintGrid", layerId: collision, cells: [1, 2].flatMap(y => [1, 2].map(x => ({ x, y, value: 1 }))) });
  store.clearHistory();
  const s = useEditorStore.getState();
  s.setProject({ name: "Test", store, levelPath: "main.json" }); s.setActiveLayer(ground); s.setTool("select"); s.setSelectionScope("visible"); s.setRegion(region);
  useProjectLibrary.getState().load({ levels: [], stamps: [] });
  closeTileReplacement();
});
describe("mask commands", () => {
  it("copy and stamp save keep holes empty in tile and grid layers", () => {
    expect(copySelection()).toBe(true);
    expect(getMemoryClip()!.layers.every(l => l.cells[3] === 0)).toBe(true);
    const saved = saveSelectionAsStamp("Mask")!;
    expect(saved.layers).toHaveLength(3);
    expect(saved.layers.every(l => l.cells[3] === 0)).toBe(true);
    expect(store.undoDepth).toBe(0);
  });
  it("masked stamp save follows the active layer scope", () => {
    useEditorStore.getState().setSelectionScope("active");
    expect(saveSelectionAsStamp("Active mask")!.layers.map(l => l.layerId)).toEqual([ground]);
  });
  it.each([cutSelection, deleteSelection])("cut/delete never clear the hole and undo once", action => {
    const before = serializeLevel(store.document);
    expect(action()).toBe(true);
    for (const l of store.document.layers) { expect(l.getCell(1, 1)).toBe(0); expect(l.getCell(2, 2)).toBe(1); }
    expect(store.undoDepth).toBe(1); store.undo(); expect(serializeLevel(store.document)).toBe(before);
  });
  it.each(["x", "y"] as const)("%s flips the selection rather than a stale brush", axis => {
    useEditorStore.getState().setSelection({ tilesetId: "t", tileId: 3 });
    const before = serializeLevel(store.document);
    expect(flipBrush(axis)).toBe(true); expect(store.undoDepth).toBe(1);
    expect(useEditorStore.getState().region?.mask).toEqual(Uint8Array.from(axis === "x" ? [1, 1, 0, 1] : [1, 0, 1, 1]));
    store.undo(); expect(serializeLevel(store.document)).toBe(before);
  });
  it("an empty mask flip changes only editor state", () => {
    useEditorStore.getState().setRegion({ x: 6, y: 6, width: 2, height: 2, mask: Uint8Array.of(1, 1, 1, 0) });
    expect(flipBrush("x")).toBe(true);
    expect(store.undoDepth).toBe(0);
    expect(useEditorStore.getState().dirty).toBe(false);
  });
  it("replacement count uses the mask and the visible layer scope", () => {
    openTileReplacement({ tilesetId: "t", tileId: 1 }, { tilesetId: "t", tileId: 2 });
    expect(replacementPlan(useTileReplacement.getState().draft!).map(p => p.cells.length)).toEqual([3, 3]);
  });
  it("hit testing, move and clipping preserve membership", () => {
    expect(regionContains(region, { x: 2, y: 2 })).toBe(false);
    expect(movedRegion(region, 3, 4, { width: 12, height: 12 })?.mask).toEqual(region.mask);
    expect(clampRegion(region, 2, 3)?.mask).toEqual(Uint8Array.of(1, 1));
  });
  it("registers palette commands and modifier precedence", () => {
    registerSelectionPickCommands();
    const before = useEditorStore.getState().selectionMode;
    expect(runCommand("selection.toggleMode")).toBe(true);
    expect(useEditorStore.getState().selectionMode).not.toBe(before);
    expect(runCommand("pick.toggleScope")).toBe(true);
    expect(selectionModifier({ ctrlKey: true, altKey: false, shiftKey: true })).toBe("subtract");
  });
});
