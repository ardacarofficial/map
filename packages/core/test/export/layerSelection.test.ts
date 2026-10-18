/** `layers` / `collision` export options (export dialog's per-layer checkboxes). */
import { describe, expect, it } from "vitest";
import {
  createDocument,
  exportGameJson,
  exportLayerSummaries,
  exportTmj,
  exportUnityMap,
  layerDrawList,
  makeCell,
  MapStore,
  type Tileset,
} from "../../src";
import { TILESET } from "../helpers";

const ITEMS: Tileset = { ...TILESET, id: "items", name: "Items", imagePath: "tilesets/items.png" };

/** 3×2 map: ground (grass, a solid tile), deco (items), an entity layer, top (empty). */
function setup() {
  const store = new MapStore(createDocument({ width: 3, height: 2 }));
  store.dispatch({ type: "addTileset", tileset: TILESET });
  store.dispatch({ type: "addTileset", tileset: ITEMS });
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
  store.dispatch({ type: "addLayer", layer: { id: "things", name: "Things", type: "entity" } });
  store.dispatch({ type: "addLayer", layer: { id: "deco", name: "Deco" } });
  store.dispatch({ type: "addLayer", layer: { id: "top", name: "Top" } });
  const g = store.getOrAddPaletteIndex("grass", 1);
  const i = store.getOrAddPaletteIndex("items", 2);
  store.dispatch({
    type: "paintCells",
    layerId: "ground",
    cells: [
      { x: 0, y: 0, cell: makeCell(g) },
      { x: 1, y: 0, cell: makeCell(g) },
      { x: 2, y: 1, cell: makeCell(g) },
      { x: 40, y: 1, cell: makeCell(g) }, // outside the map: not counted
    ],
  });
  store.dispatch({ type: "paintCells", layerId: "deco", cells: [{ x: 1, y: 1, cell: makeCell(i) }] });
  store.dispatch({ type: "addLayer", layer: { id: "collision", name: "Collision", type: "grid", role: "collision" } });
  store.dispatch({ type: "paintGrid", layerId: "collision", cells: [{x:0,y:0,value:1},{x:1,y:0,value:1},{x:2,y:1,value:1}] });
  return store;
}

interface Game {
  tilesets: { image: string }[];
  layers: { id: string; cells: number[] }[];
  collision: { solid: number[] };
}

describe("export layer selection", () => {
  it("no options = every tile layer (backward compatible)", () => {
    const doc = setup().document;
    expect(exportGameJson(doc, {})).toBe(exportGameJson(doc));
    expect(exportGameJson(doc, { layers: ["ground", "deco", "top"] })).toBe(exportGameJson(doc));
    expect(exportTmj(doc, "m", {}).text).toBe(exportTmj(doc, "m").text);
  });

  it("game JSON / Unity keep only the chosen layers and their tilesets, in document order", () => {
    const doc = setup().document;
    const game = JSON.parse(exportGameJson(doc, { layers: ["top", "ground"] })) as Game;
    expect(game.layers.map((l) => l.id)).toEqual(["ground", "top"]);
    expect(game.tilesets.map((t) => t.image)).toEqual(["grass.png"]);
    // Collision still comes from every tile layer: solid at (0,0), (1,0), (2,1).
    expect(game.collision.solid).toEqual([0, 2, 3, 1]);
    const unity = exportUnityMap(doc, "main", { layers: ["deco"] });
    expect(unity.images.map((i) => i.fileName)).toEqual(["items.png"]);
    expect((JSON.parse(unity.text) as Game).layers.map((l) => l.id)).toEqual(["deco"]);
    expect((JSON.parse(exportGameJson(doc, { layers: [] })) as Game).layers).toEqual([]);
  });

  it("collision: false writes one passable run", () => {
    const game = JSON.parse(exportGameJson(setup().document, { collision: false })) as Game;
    expect(game.collision.solid).toEqual([6]);
  });

  it("TMJ filters tile layers but always keeps entity layers", () => {
    const tmj = JSON.parse(exportTmj(setup().document, "m", { layers: ["deco"] }).text) as {
      layers: { name: string; type: string }[];
      tilesets: { name: string }[];
    };
    expect(tmj.layers.map((l) => `${l.type}:${l.name}`)).toEqual(["objectgroup:Things", "tilelayer:Deco", "objectgroup:Collision"]);
    expect(tmj.tilesets.map((t) => t.name)).toEqual(["Items"]);
  });

  it("draw list (PNG) honours the selection", () => {
    const list = layerDrawList(setup().document, { layers: ["deco"] });
    expect(list.layers.map((l) => l.layerId)).toEqual(["deco"]);
  });

  it("summarises tile layers with their in-bounds tile counts", () => {
    expect(exportLayerSummaries(setup().document)).toEqual([
      { id: "ground", name: "Ground", visible: true, tiles: 3 },
      { id: "deco", name: "Deco", visible: true, tiles: 1 },
      { id: "top", name: "Top", visible: true, tiles: 0 },
    ]);
  });
});
