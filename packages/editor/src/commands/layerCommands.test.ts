import { createDocument, isGridLayer, makeCell, MapStore, type Tileset } from "@smap/core";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../state/editorStore";
import { layerUnits } from "../ui/terrain/layerGroups";
import { registerAppCommands } from "./appCommands";
import {
  canMoveUnit,
  canRemoveUnit,
  copyLayerName,
  duplicateLayer,
  isSolo,
  mergeDownProblem,
  mergeLayerDown,
  moveUnit,
  selectLayerContent,
  setUnitProps,
  soloLayer,
  useLayerUi,
} from "./layerActions";
import { cycleLevelId } from "./levelActions";
import { getCommand, isEnabled, runCommand } from "./registry";

const tiles: Tileset = { id: "t", name: "T", imagePath: "t.png", tileWidth: 32, tileHeight: 32, columns: 4, rows: 4, margin: 0, spacing: 0 };

let store: MapStore;
let ground: string;
let upper: string;

/** Bottom-first layer names. */
const names = () => store.document.layers.map((l) => l.name);

beforeEach(() => {
  store = new MapStore(createDocument({ width: 8, height: 8 }));
  store.dispatch({ type: "addTileset", tileset: tiles });
  ground = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  upper = store.dispatch({ type: "addLayer", layer: { name: "Upper" } });
  const cell = makeCell(store.getOrAddPaletteIndex("t", 1));
  store.dispatch({ type: "paintCells", layerId: upper, cells: [{ x: 2, y: 3, cell }, { x: 4, y: 5, cell }] });
  store.clearHistory();
  useEditorStore.getState().setProject({ name: "x", store, levelPath: "levels/main.json" });
  useEditorStore.getState().setActiveLayer(upper);
  registerAppCommands();
});

describe("layer commands", () => {
  it("duplicates a layer above itself as one undo step and selects the copy", () => {
    const id = duplicateLayer(upper)!;
    expect(names()).toEqual(["Ground", "Upper", "Upper kopya"]);
    expect(useEditorStore.getState().activeLayerId).toBe(id);
    expect(store.document.getLayer(id)!.getCell(2, 3)).toBe(store.document.getLayer(upper)!.getCell(2, 3));
    expect(copyLayerName(store.document, "Upper")).toBe("Upper kopya 2");
    store.undo();
    expect(names()).toEqual(["Ground", "Upper"]);
  });

  it("duplicates a terrain group as a group", () => {
    const tile = store.dispatch({ type: "addLayer", layer: { name: "Grass" } });
    store.dispatch({ type: "addLayer", layer: { type: "grid", role: "terrain", targetLayerId: tile, name: "Grass (arazi)" } });
    store.clearHistory();
    const before = layerUnits(store.document).length;
    const copy = duplicateLayer(tile)!;
    const units = layerUnits(store.document);
    expect(units.length).toBe(before + 1);
    const unit = units.find((u) => u.head.id === copy)!;
    expect(unit.child).not.toBeNull();
    const head = store.document.getLayer(copy);
    expect(isGridLayer(head) && head.targetLayerId).toBe(unit.child!.id);
    expect(store.undo()).toBe(true);
    expect(layerUnits(store.document).length).toBe(before);
  });

  it("merges down only plain, unlocked tile layers", () => {
    expect(mergeDownProblem(store.document, upper)).toBeNull();
    expect(mergeDownProblem(store.document, ground)).toBe("noBelow");
    setUnitProps(ground, { locked: true });
    expect(mergeDownProblem(store.document, upper)).toBe("locked");
    expect(isEnabled(getCommand("layer.mergeDown")!)).toBe(false);
    setUnitProps(ground, { locked: false });
    expect(isEnabled(getCommand("layer.mergeDown")!)).toBe(true);
    expect(mergeLayerDown(upper)).toBe(true);
    expect(names()).toEqual(["Ground"]);
    expect(store.document.getLayer(ground)!.getCell(4, 5)).not.toBe(0);
    expect(useEditorStore.getState().activeLayerId).toBe(ground);
  });

  it("moves a unit up and down (Ctrl+] / Ctrl+[) and knows the ends", () => {
    expect(canMoveUnit(store.document, upper, "up")).toBe(false);
    expect(canMoveUnit(store.document, upper, "down")).toBe(true);
    expect(isEnabled(getCommand("layer.moveUp")!)).toBe(false);
    expect(runCommand("layer.moveDown")).toBe(true);
    expect(names()).toEqual(["Upper", "Ground"]);
    expect(moveUnit(upper, "down")).toBe(false);
    expect(moveUnit(upper, "up")).toBe(true);
    expect(names()).toEqual(["Ground", "Upper"]);
  });

  it("solo shows only one layer, and again shows all (one undo step each)", () => {
    soloLayer(upper);
    expect(store.document.getLayer(ground)!.visible).toBe(false);
    expect(isSolo(store.document, upper)).toBe(true);
    soloLayer(upper);
    expect(store.document.layers.every((l) => l.visible)).toBe(true);
    store.undo();
    expect(isSolo(store.document, upper)).toBe(true);
  });

  it("selects the content bounds of a layer", () => {
    expect(selectLayerContent(upper)).toBe(true);
    expect(useEditorStore.getState().region).toEqual({ x: 2, y: 3, width: 3, height: 3 });
    expect(selectLayerContent(ground)).toBe(false);
  });

  it("F2 asks the layers panel to rename the active layer", () => {
    useLayerUi.setState({ renamingId: null });
    expect(runCommand("layer.rename")).toBe(true);
    expect(useLayerUi.getState().renamingId).toBe(upper);
  });

  it("keeps at least one layer", () => {
    expect(canRemoveUnit(store.document, upper)).toBe(true);
    runCommand("layer.remove");
    expect(canRemoveUnit(store.document, ground)).toBe(false);
    expect(isEnabled(getCommand("layer.remove")!)).toBe(false);
  });

  it("inverts an empty selection to the whole map, and a full one to nothing", () => {
    useEditorStore.getState().setRegion(null);
    expect(runCommand("edit.invertSelection")).toBe(true);
    expect(useEditorStore.getState().region).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    expect(runCommand("edit.invertSelection")).toBe(true);
    expect(useEditorStore.getState().region).toBeNull();
    useEditorStore.getState().setRegion({ x: 1, y: 1, width: 2, height: 2 });
    expect(isEnabled(getCommand("edit.invertSelection")!)).toBe(false);
  });
});

describe("level next / previous", () => {
  it("steps through the list and wraps around", () => {
    const ids = ["a", "b", "c"];
    expect(cycleLevelId(ids, "a", 1)).toBe("b");
    expect(cycleLevelId(ids, "c", 1)).toBe("a");
    expect(cycleLevelId(ids, "a", -1)).toBe("c");
    expect(cycleLevelId(ids, "zzz", 1)).toBe("a");
    expect(cycleLevelId(ids, null, -1)).toBe("c");
    expect(cycleLevelId(["a"], "a", 1)).toBeNull();
  });
});
