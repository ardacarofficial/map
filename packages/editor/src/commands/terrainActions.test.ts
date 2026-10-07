import { createDocument, isGridLayer, MapStore, type Tileset } from "@smap/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../state/editorStore";
import {
  activateTerrain,
  addCollisionLayer,
  nextTerrainId,
  planTerrainLayer,
  terrainBlockProblem,
  tileLayerForPick,
  uniqueTerrainName,
  validGridValue,
} from "./terrainActions";

const tiles: Tileset = {
  id: "t",
  name: "T",
  imagePath: "tilesets/t.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 12,
  rows: 8,
  margin: 0,
  spacing: 0,
};

let store: MapStore;
let ground: string;

beforeEach(() => {
  store = new MapStore(createDocument({ width: 16, height: 16 }));
  store.dispatch({ type: "addTileset", tileset: tiles });
  ground = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  store.dispatch({
    type: "defineTerrain",
    terrain: { id: 1, name: "Grass", tilesetId: "t", template: "blob47-godot", origin: { col: 0, row: 0 } },
  });
  store.clearHistory();
  useEditorStore.getState().setProject({ name: "x", store, levelPath: "levels/main.json" });
  useEditorStore.getState().setActiveLayer(ground);
});

describe("planTerrainLayer", () => {
  it("creates a pair above the active layer when no terrain layer exists", () => {
    expect(planTerrainLayer(store.document, ground)).toEqual({ kind: "create", index: 1 });
    expect(planTerrainLayer(store.document, null)).toEqual({ kind: "create", index: 1 });
  });

  it("uses the active terrain layer when its tile layer exists", () => {
    const tile = store.dispatch({ type: "addLayer", layer: { name: "G" } });
    const grid = store.dispatch({ type: "addLayer", layer: { type: "grid", role: "terrain", targetLayerId: tile, name: "G (t)" } });
    expect(planTerrainLayer(store.document, grid)).toEqual({ kind: "use", layerId: grid });
    // Not active: still reused (topmost linked one).
    expect(planTerrainLayer(store.document, ground)).toEqual({ kind: "use", layerId: grid });
  });

  it("skips terrain layers whose tile layer is gone or missing, and collision layers", () => {
    const tile = store.dispatch({ type: "addLayer", layer: { name: "G" } });
    const grid = store.dispatch({ type: "addLayer", layer: { type: "grid", role: "terrain", targetLayerId: tile, name: "G (t)" } });
    store.dispatch({ type: "addLayer", layer: { type: "grid", role: "terrain", name: "unlinked" } });
    store.dispatch({ type: "addLayer", layer: { type: "grid", role: "collision", name: "C" } });
    expect(planTerrainLayer(store.document, ground)).toEqual({ kind: "use", layerId: grid });
    store.dispatch({ type: "removeLayer", layerId: tile });
    expect(planTerrainLayer(store.document, grid).kind).toBe("create");
  });
});

describe("activateTerrain", () => {
  it("creates tile + terrain layer in one undo step, then reuses them", () => {
    activateTerrain(1);
    const layers = store.document.layers;
    expect(layers).toHaveLength(3);
    const [, tile, grid] = layers;
    expect(isGridLayer(tile)).toBe(false);
    expect(tile!.name).toBe("Grass");
    expect(isGridLayer(grid) && grid.role === "terrain" && grid.targetLayerId === tile!.id).toBe(true);
    const s = useEditorStore.getState();
    expect(s.activeLayerId).toBe(grid!.id);
    expect(s.gridValue).toBe(1);
    expect(s.tool).toBe("brush");
    expect(store.undoDepth).toBe(1);

    s.setActiveLayer(ground);
    activateTerrain(1);
    expect(store.document.layers).toHaveLength(3);
    expect(useEditorStore.getState().activeLayerId).toBe(grid!.id);

    store.undo();
    expect(store.document.layers).toHaveLength(1);
  });
});

describe("addCollisionLayer", () => {
  it("adds a collision grid above the active layer and paints 'force solid'", () => {
    useEditorStore.getState().setGridValue(7);
    const id = addCollisionLayer()!;
    const layer = store.document.getLayer(id);
    expect(isGridLayer(layer) && layer.role === "collision").toBe(true);
    expect(store.document.indexOfLayer(id)).toBe(1);
    expect(useEditorStore.getState().gridValue).toBe(1);
  });
});

describe("validGridValue / tileLayerForPick / names", () => {
  it("keeps the grid value valid for the layer", () => {
    const c = store.dispatch({ type: "addLayer", layer: { type: "grid", role: "collision", name: "C" } });
    const tr = store.dispatch({ type: "addLayer", layer: { type: "grid", role: "terrain", name: "T" } });
    const doc = store.document;
    expect(validGridValue(doc, doc.getLayer(c), 2)).toBe(2);
    expect(validGridValue(doc, doc.getLayer(c), 5)).toBe(1);
    expect(validGridValue(doc, doc.getLayer(tr), 1)).toBe(1);
    expect(validGridValue(doc, doc.getLayer(tr), 2)).toBe(1);
    expect(validGridValue(doc, doc.getLayer(ground), 9)).toBe(9);
  });

  it("switches a tile pick on a grid layer to a hand-painted tile layer", () => {
    expect(tileLayerForPick(store.document, ground)).toBeNull();
    activateTerrain(1); // Ground, Grass (derived), Grass (terrain)
    const grid = useEditorStore.getState().activeLayerId;
    expect(tileLayerForPick(store.document, grid)).toBe(ground);
    store.dispatch({ type: "removeLayer", layerId: ground });
    expect(tileLayerForPick(store.document, grid)).toBeNull();
  });

  it("names and ids", () => {
    expect(nextTerrainId(store.document)).toBe(2);
    expect(uniqueTerrainName(store.document)).toBe("Arazi 2");
  });

  it("reports blocks that do not fit", () => {
    expect(terrainBlockProblem(tiles, "blob47-godot", 0, 0)).toBeNull();
    expect(terrainBlockProblem(tiles, "blob47-godot", 1, 0)).toMatch(/sığmıyor/);
    expect(terrainBlockProblem({ ...tiles, columns: 4, rows: 4 }, "blob47-cr31", 0, 0)).toMatch(/küçük/);
    expect(terrainBlockProblem(tiles, "corner16", 8, 4)).toBeNull();
  });
});
