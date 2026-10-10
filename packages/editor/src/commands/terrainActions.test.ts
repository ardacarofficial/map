import { cellPaletteIndex, createDocument, getTerrainSet, MapStore, type Tileset } from "@smap/core";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../state/editorStore";
import { useToastStore } from "../ui/toast/toastStore";
import {
  addCollisionLayer,
  blockProblem,
  chooseTerrain,
  defineTerrain,
  removeTerrain,
  removeTerrainSet,
  renameTerrain,
  setAutotile,
  setTerrainBackground,
  setTerrainColor,
  terrainBrushActive,
  tileLayerForPick,
  toggleTerrainTag,
  validGridValue,
} from "./terrainActions";

const tiles: Tileset = {
  id: "t",
  name: "T",
  imagePath: "tilesets/t.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 12,
  rows: 12,
  margin: 0,
  spacing: 0,
};

let store: MapStore;
let ground: string;

beforeEach(() => {
  store = new MapStore(createDocument({ width: 16, height: 16 }));
  store.dispatch({ type: "addTileset", tileset: tiles });
  ground = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  store.clearHistory();
  useEditorStore.getState().setProject({ name: "x", store, levelPath: "levels/main.json" });
  useEditorStore.getState().setActiveLayer(ground);
  useEditorStore.getState().setTool("brush");
  useToastStore.setState({ toasts: [] });
});

const blob = () =>
  defineTerrain({ tilesetId: "t", template: "blob47-godot", origin: { col: 0, row: 0 }, setId: null, name: " Çimen ", color: "#5fb85f", background: 0 })!;

describe("defineTerrain", () => {
  it("tags the block as a new set in ONE undo step and chooses it for the brush", () => {
    const ref = blob();
    expect(ref).toEqual({ tilesetId: "t", setId: "terrain-1", terrainId: 1 });
    const set = getTerrainSet(store.document.getTileset("t"), "terrain-1")!;
    expect(set.kind).toBe("blob");
    expect(set.name).toBe("Çimen");
    expect(set.terrains).toEqual([{ id: 1, name: "Çimen", color: "#5fb85f" }]);
    expect(set.tiles).toHaveLength(47);
    const s = useEditorStore.getState();
    expect(s.terrainActive).toBe(true);
    expect(s.terrain).toEqual(ref);
    // The terrain brush starts at size 3; the tile brush size comes back when it goes off.
    expect(s.brushSize).toBe(3);
    // No layer was created or switched.
    expect(store.document.layers).toHaveLength(1);
    expect(s.activeLayerId).toBe(ground);
    expect(store.undo()).toBe(true);
    expect(store.document.getTileset("t")!.terrainSets ?? []).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it("adds a second terrain to an existing corner set with a background (transition)", () => {
    const grass = defineTerrain({ tilesetId: "t", template: "corner16", origin: { col: 0, row: 0 }, setId: null, name: "Çimen", color: "#5fb85f", background: 0 })!;
    const dirt = defineTerrain({ tilesetId: "t", template: "corner16", origin: { col: 4, row: 0 }, setId: grass.setId, name: "Toprak", color: "#b5895a", background: grass.terrainId })!;
    expect(dirt).toEqual({ tilesetId: "t", setId: grass.setId, terrainId: 2 });
    const set = getTerrainSet(store.document.getTileset("t"), grass.setId)!;
    expect(set.terrains.map((x) => x.name)).toEqual(["Çimen", "Toprak"]);
    expect(set.background).toBe(1);
    // A dirt block tile with one dirt corner shows grass on the other three.
    expect(set.tiles.some((tag) => tag.corners?.join() === "1,2,1,1" || tag.corners?.filter((c) => c === 2).length === 1)).toBe(true);
  });

  it("refuses a block that does not fit or a set of the other kind", () => {
    expect(defineTerrain({ tilesetId: "t", template: "blob47-godot", origin: { col: 5, row: 0 }, setId: null, name: "x", color: "#5fb85f", background: 0 })).toBeNull();
    const ref = blob();
    expect(defineTerrain({ tilesetId: "t", template: "corner16", origin: { col: 0, row: 6 }, setId: ref.setId, name: "x", color: "#5fb85f", background: 0 })).toBeNull();
    expect(blockProblem(tiles, "blob47-godot", { col: 0, row: 0 })).toBeNull();
    expect(blockProblem(tiles, "blob47-godot", { col: 1, row: 0 })).toMatch(/sığmıyor/);
    expect(blockProblem({ columns: 4, rows: 4 }, "blob47-cr31", { col: 0, row: 0 })).toMatch(/küçük/);
  });
});

describe("edit and remove", () => {
  it("renames, recolours and sets the background, each one undo step", () => {
    const grass = defineTerrain({ tilesetId: "t", template: "corner16", origin: { col: 0, row: 0 }, setId: null, name: "Çimen", color: "#5fb85f", background: 0 })!;
    defineTerrain({ tilesetId: "t", template: "corner16", origin: { col: 4, row: 0 }, setId: grass.setId, name: "Su", color: "#4f8fd6", background: 0 });
    renameTerrain(grass, "Ot");
    setTerrainColor(grass, "#AABBCC");
    setTerrainBackground(grass, 2);
    const set = getTerrainSet(store.document.getTileset("t"), grass.setId)!;
    expect(set.terrains[0]).toEqual({ id: 1, name: "Ot", color: "#aabbcc" });
    expect(set.background).toBe(2);
    store.undo();
    expect(getTerrainSet(store.document.getTileset("t"), grass.setId)!.background).toBeUndefined();
  });

  it("Düzelt toggles corner tags and blob membership", () => {
    const grass = defineTerrain({ tilesetId: "t", template: "corner16", origin: { col: 0, row: 0 }, setId: null, name: "Çimen", color: "#5fb85f", background: 0 })!;
    // Tile 100 is outside the block: its NE corner becomes grass.
    toggleTerrainTag(grass, 100, { kind: "corner", corner: 1 });
    expect(getTerrainSet(store.document.getTileset("t"), grass.setId)!.tiles.find((x) => x.tileId === 100)?.corners).toEqual([0, 1, 0, 0]);
    toggleTerrainTag(grass, 100, { kind: "corner", corner: 1 });
    expect(getTerrainSet(store.document.getTileset("t"), grass.setId)!.tiles.find((x) => x.tileId === 100)).toBeUndefined();
  });

  it("removing the last terrain removes the set; the brush goes off; Geri al restores", () => {
    const ref = blob();
    removeTerrain(ref);
    expect(store.document.getTileset("t")!.terrainSets ?? []).toHaveLength(0);
    expect(useEditorStore.getState().terrainActive).toBe(false);
    expect(useEditorStore.getState().terrain).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.action).toBeDefined();
    store.undo();
    expect(getTerrainSet(store.document.getTileset("t"), ref.setId)).toBeDefined();
    removeTerrainSet(ref);
    expect(store.document.getTileset("t")!.terrainSets ?? []).toHaveLength(0);
  });
});

describe("choosing and painting", () => {
  it("chooses a terrain without touching layers; a tile pick turns the terrain brush off", () => {
    const ref = blob();
    const s = useEditorStore.getState();
    s.setTerrain(null);
    expect(useEditorStore.getState().brushSize).toBe(1);
    useEditorStore.getState().setTool("select");
    expect(chooseTerrain(ref)).toBe(true);
    expect(useEditorStore.getState().tool).toBe("brush");
    expect(useEditorStore.getState().brushSize).toBe(3);
    expect(terrainBrushActive(store.document)).toBe(true);
    useEditorStore.getState().setSelection({ tilesetId: "t", tileId: 5 });
    expect(useEditorStore.getState().terrainActive).toBe(false);
    expect(useEditorStore.getState().brushSize).toBe(1);
    setAutotile(true);
    expect(useEditorStore.getState().terrainActive).toBe(true);
    expect(chooseTerrain({ ...ref, terrainId: 9 })).toBe(false);
  });

  it("the paintTerrainBrush op paints blob tiles next to manual tiles and keeps them; erase and undo", () => {
    const ref = blob();
    const manual = store.getOrAddPaletteIndex("t", 140);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 9, y: 5, cell: manual }] });
    store.clearHistory();
    const cells = [];
    for (let y = 4; y <= 6; y++) for (let x = 6; x <= 8; x++) cells.push({ x, y });
    store.dispatch({ type: "paintTerrainBrush", layerId: ground, cells, ...ref });
    const layer = store.document.getLayer(ground)!;
    expect(cellPaletteIndex(layer.getCell(9, 5))).toBe(manual);
    expect(layer.getCell(7, 5)).not.toBe(0);
    store.dispatch({ type: "paintTerrainBrush", layerId: ground, cells: [{ x: 7, y: 5 }], ...ref, erase: true });
    expect(layer.getCell(7, 5)).toBe(0);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(layer.getCell(7, 5)).toBe(0);
    expect(cellPaletteIndex(layer.getCell(9, 5))).toBe(manual);
  });
});

describe("collision helpers", () => {
  it("validGridValue keeps collision kinds; tileLayerForPick finds a tile layer", () => {
    const c = addCollisionLayer()!;
    const doc = store.document;
    expect(validGridValue(doc, doc.getLayer(c), 2)).toBe(2);
    expect(validGridValue(doc, doc.getLayer(c), 5)).toBe(1);
    expect(validGridValue(doc, doc.getLayer(ground), 9)).toBe(9);
    expect(tileLayerForPick(doc, ground)).toBeNull();
    expect(tileLayerForPick(doc, c)).toBe(ground);
  });
});
