import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  FLIP_D,
  FLIP_H,
  FLIP_V,
  createDocument,
  decodeRle,
  deriveCollision,
  encodeRle,
  exportBaseName,
  exportGameJson,
  exportTmj,
  exportUnityMap,
  layerDrawList,
  makeCell,
  MapStore,
  parseLevel,
  serializeLevel,
  tmjFirstGids,
  type Tileset,
} from "../src";
import { TILESET } from "./helpers";

/** Second tileset: 4×2 tiles of 16×16, margin 1, spacing 2. */
const ITEMS: Tileset = {
  id: "items",
  name: "Items",
  imagePath: "tilesets/sub/items.png",
  tileWidth: 16,
  tileHeight: 16,
  columns: 4,
  rows: 2,
  margin: 1,
  spacing: 2,
};

interface Game {
  smapExport: number;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  yUp: boolean;
  tilesets: { name: string; image: string; columns: number; rows: number; margin: number; spacing: number }[];
  layers: { id: string; name: string; visible: boolean; opacity: number; cells: number[] }[];
  collision: { solid: number[] };
}

/** 4×3 map: grass (8×8, 32px) + items; layers ground, deco, a terrain grid and a collision grid. */
function setup() {
  const store = new MapStore(createDocument({ width: 4, height: 3 }));
  store.dispatch({ type: "addTileset", tileset: TILESET });
  store.dispatch({ type: "addTileset", tileset: ITEMS });
  const grass = (t: number) => store.getOrAddPaletteIndex("grass", t);
  const item = (t: number) => store.getOrAddPaletteIndex("items", t);
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
  store.dispatch({ type: "addLayer", layer: { id: "deco", name: "Deco" } });
  store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
  store.dispatch({
    type: "paintCells",
    layerId: "ground",
    cells: [
      { x: 0, y: 0, cell: makeCell(grass(1)) },
      { x: 3, y: 0, cell: makeCell(grass(9), FLIP_H) },
      { x: 1, y: 2, cell: makeCell(grass(63), FLIP_H | FLIP_V) },
    ],
  });
  store.dispatch({ type: "paintCells", layerId: "deco", cells: [{ x: 2, y: 1, cell: makeCell(item(5), FLIP_V) }] });
  store.clearHistory();
  return store;
}

describe("game JSON export", () => {
  it("is deterministic and independent of palette order", () => {
    const a = setup();
    expect(exportGameJson(a.document)).toBe(exportGameJson(a.document));
    // Same picture, palette built in a different order → same bytes.
    const b = new MapStore(createDocument({ width: 4, height: 3 }));
    b.dispatch({ type: "addTileset", tileset: TILESET });
    b.dispatch({ type: "addTileset", tileset: ITEMS });
    const i5 = b.getOrAddPaletteIndex("items", 5);
    const g63 = b.getOrAddPaletteIndex("grass", 63);
    const g9 = b.getOrAddPaletteIndex("grass", 9);
    const g1 = b.getOrAddPaletteIndex("grass", 1);
    b.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
    b.dispatch({ type: "addLayer", layer: { id: "deco", name: "Deco" } });
    b.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
    b.dispatch({
      type: "paintCells",
      layerId: "ground",
      cells: [
        { x: 1, y: 2, cell: makeCell(g63, FLIP_H | FLIP_V) },
        { x: 3, y: 0, cell: makeCell(g9, FLIP_H) },
        { x: 0, y: 0, cell: makeCell(g1) },
      ],
    });
    b.dispatch({ type: "paintCells", layerId: "deco", cells: [{ x: 2, y: 1, cell: makeCell(i5, FLIP_V) }] });
    expect(exportGameJson(b.document)).toBe(exportGameJson(a.document));
    // ...and survives a save/load roundtrip.
    const reloaded = parseLevel(serializeLevel(a.document), [TILESET, ITEMS]);
    expect(exportGameJson(reloaded)).toBe(exportGameJson(a.document));
  });

  it("writes the documented structure; cell (0,0) is top-left, y down", () => {
    const text = exportGameJson(setup().document);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toContain("\r");
    const game = JSON.parse(text) as Game;
    expect(Object.keys(game)).toEqual(["smapExport", "width", "height", "tileWidth", "tileHeight", "yUp", "tilesets", "layers", "collision", "entities", "spawn"]);
    expect(game).toMatchObject({ smapExport: 1, width: 4, height: 3, tileWidth: 32, tileHeight: 32, yUp: false });
    expect(game.tilesets.map((t) => t.image)).toEqual(["grass.png", "items.png"]);
    expect(game.tilesets[1]).toEqual({ name: "Items", image: "items.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 2, margin: 1, spacing: 2 });
    // Grid layers are not exported.
    expect(game.layers.map((l) => l.id)).toEqual(["ground", "deco"]);
    // Rows of x, y, tileset, tileId, flags (1 = H, 2 = V), sorted by y then x.
    expect(game.layers[0]!.cells).toEqual([0, 0, 0, 1, 0, 3, 0, 0, 9, 1, 1, 2, 0, 63, 3]);
    expect(game.layers[1]!.cells).toEqual([2, 1, 1, 5, 2]);
    // One cell tuple per line.
    expect(text).toContain('"cells": [\n        0, 0, 0, 1, 0,\n        3, 0, 0, 9, 1,\n');
    expect(game.collision.solid).toEqual([12]);
  });

  it("collision is the derived grid (solid tiles + exceptions), RLE row-major from the top-left", () => {
    const store = setup();
    store.dispatch({ type: "setTileSolid", tilesetId: "grass", tileIds: [1, 9], solid: true }); // (0,0) and (3,0)
    store.dispatch({ type: "paintTerrain", layerId: "col", cells: [{ x: 3, y: 0, value: COLLISION_PASSABLE }, { x: 3, y: 2, value: COLLISION_SOLID }] });
    const game = JSON.parse(exportGameJson(store.document)) as Game;
    expect(game.collision.solid).toEqual([0, 1, 10, 1]); // (0,0) solid … (3,2) = last cell solid
    const grid = deriveCollision(store.document);
    expect(decodeRle(game.collision.solid, game.width * game.height)).toEqual(grid.data);
  });

  it("an empty map exports empty layers and an all-passable collision run", () => {
    const store = new MapStore(createDocument({ width: 2, height: 2 }));
    store.dispatch({ type: "addTileset", tileset: TILESET });
    store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
    const game = JSON.parse(exportGameJson(store.document)) as Game;
    expect(game.tilesets).toEqual([]); // unused tilesets are left out
    expect(game.layers).toEqual([{ id: "a", name: "A", visible: true, opacity: 1, cells: [] }]);
    expect(game.collision.solid).toEqual([4]);
  });

  it("keeps hidden layers (with visible: false) and opacity", () => {
    const store = setup();
    store.dispatch({ type: "setLayerProps", layerId: "deco", props: { visible: false, opacity: 0.5 } });
    const game = JSON.parse(exportGameJson(store.document)) as Game;
    expect(game.layers[1]).toMatchObject({ visible: false, opacity: 0.5 });
  });

  it("skips cells outside the map after shrinking", () => {
    const store = setup();
    store.dispatch({ type: "resizeMap", width: 2, height: 3 });
    const game = JSON.parse(exportGameJson(store.document)) as Game;
    for (const layer of game.layers) for (let i = 0; i < layer.cells.length; i += 5) expect(layer.cells[i]).toBeLessThan(2);
  });
});

describe("Unity map file", () => {
  it("is the game JSON under <level>.smapmap, listing the PNGs to copy", () => {
    const doc = setup().document;
    const result = exportUnityMap(doc, "main");
    expect(result.fileName).toBe("main.smapmap");
    expect(result.text).toBe(exportGameJson(doc));
    expect(result.images.map((i) => [i.sourcePath, i.fileName])).toEqual([
      ["tilesets/grass.png", "grass.png"],
      ["tilesets/sub/items.png", "items.png"],
    ]);
  });

  it("makes image file names unique (case-insensitive) and level names file-safe", () => {
    const store = new MapStore(createDocument({ width: 2, height: 1 }));
    store.dispatch({ type: "addTileset", tileset: { ...TILESET, id: "a", imagePath: "a/tiles.png" } });
    store.dispatch({ type: "addTileset", tileset: { ...TILESET, id: "b", imagePath: "b/Tiles.png" } });
    store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
    store.dispatch({
      type: "paintCells",
      layerId: "l",
      cells: [
        { x: 0, y: 0, cell: makeCell(store.getOrAddPaletteIndex("a", 0)) },
        { x: 1, y: 0, cell: makeCell(store.getOrAddPaletteIndex("b", 0)) },
      ],
    });
    expect(exportUnityMap(store.document, "x").images.map((i) => i.fileName)).toEqual(["tiles.png", "Tiles-2.png"]);
    expect(exportBaseName('a<b>:c"d/e\\f|g?h*')).toBe("a_b__c_d_e_f_g_h_");
    expect(exportBaseName("level. ")).toBe("level");
    expect(exportBaseName("")).toBe("map");
  });
});

describe("collision RLE", () => {
  it("encodes runs starting with passable", () => {
    expect(encodeRle(new Uint8Array([0, 0, 1, 1, 1, 0]))).toEqual([2, 3, 1]);
    expect(encodeRle(new Uint8Array([1, 1]))).toEqual([0, 2]);
    expect(encodeRle(new Uint8Array([]))).toEqual([]);
  });

  it("roundtrips any grid", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }).map((a) => a.map((v) => v & 1)), (data) => {
        const runs = encodeRle(data);
        expect(runs.reduce((s, r) => s + r, 0)).toBe(data.length);
        expect(decodeRle(runs, data.length)).toEqual(data);
      }),
    );
  });

  it("rejects runs that do not cover the grid", () => {
    expect(() => decodeRle([2, 3], 4)).toThrow(RangeError);
    expect(() => decodeRle([2], 3)).toThrow(RangeError);
    expect(() => decodeRle([-1, 5], 4)).toThrow(RangeError);
  });
});

describe("TMJ export", () => {
  it("computes firstgid per tileset from tile counts", () => {
    expect(tmjFirstGids([TILESET, ITEMS, TILESET])).toEqual([1, 65, 73]);
    expect(tmjFirstGids([])).toEqual([]);
  });

  it("matches the hand-checked snapshot", () => {
    const store = setup();
    store.dispatch({ type: "setTileSolid", tilesetId: "items", tileIds: [5, 2], solid: true });
    const result = exportTmj(store.document, "main");
    expect(result.fileName).toBe("main.tmj");
    expect(result.warnings).toEqual([]);
    // grass firstgid 1, items firstgid 65.
    // (0,0) grass 1 → 2; (3,0) grass 9 + H → 10 | 0x80000000 = 2147483658;
    // (1,2) grass 63 + H|V → 64 | 0xC0000000 = 3221225536; (2,1) items 5 + V → 70 | 0x40000000 = 1073741894.
    expect(result.text).toBe(`{
  "compressionlevel": -1,
  "height": 3,
  "infinite": false,
  "layers": [
    {
      "data": [
        2, 0, 0, 2147483658,
        0, 0, 0, 0,
        0, 3221225536, 0, 0
      ],
      "height": 3,
      "id": 1,
      "name": "Ground",
      "opacity": 1,
      "type": "tilelayer",
      "visible": true,
      "width": 4,
      "x": 0,
      "y": 0
    },
    {
      "data": [
        0, 0, 0, 0,
        0, 0, 1073741894, 0,
        0, 0, 0, 0
      ],
      "height": 3,
      "id": 2,
      "name": "Deco",
      "opacity": 1,
      "type": "tilelayer",
      "visible": true,
      "width": 4,
      "x": 0,
      "y": 0
    }
  ],
  "nextlayerid": 3,
  "nextobjectid": 1,
  "orientation": "orthogonal",
  "renderorder": "right-down",
  "tiledversion": "1.10.2",
  "tileheight": 32,
  "tilesets": [
    {
      "columns": 8,
      "firstgid": 1,
      "image": "grass.png",
      "imageheight": 256,
      "imagewidth": 256,
      "margin": 0,
      "name": "Grass",
      "spacing": 0,
      "tilecount": 64,
      "tileheight": 32,
      "tilewidth": 32
    },
    {
      "columns": 4,
      "firstgid": 65,
      "image": "items.png",
      "imageheight": 36,
      "imagewidth": 72,
      "margin": 1,
      "name": "Items",
      "spacing": 2,
      "tilecount": 8,
      "tileheight": 16,
      "tilewidth": 16,
      "tiles": [
        {
          "id": 2,
          "properties": [
            {
              "name": "solid",
              "type": "bool",
              "value": true
            }
          ]
        },
        {
          "id": 5,
          "properties": [
            {
              "name": "solid",
              "type": "bool",
              "value": true
            }
          ]
        }
      ]
    }
  ],
  "tilewidth": 32,
  "type": "map",
  "version": "1.10",
  "width": 4
}
`);
  });

  it("copies all three flip bits as Tiled's (H 0x80000000, V 0x40000000, D 0x20000000)", () => {
    const store = new MapStore(createDocument({ width: 3, height: 1 }));
    store.dispatch({ type: "addTileset", tileset: TILESET });
    store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
    const p = store.getOrAddPaletteIndex("grass", 0);
    store.dispatch({
      type: "paintCells",
      layerId: "l",
      cells: [
        { x: 0, y: 0, cell: makeCell(p, FLIP_H) },
        { x: 1, y: 0, cell: makeCell(p, FLIP_V) },
        { x: 2, y: 0, cell: makeCell(p, FLIP_D | FLIP_H) },
      ],
    });
    const tmj = JSON.parse(exportTmj(store.document, "m").text) as { layers: { data: number[] }[] };
    expect(tmj.layers[0]!.data).toEqual([0x8000_0001, 0x4000_0001, 0xa000_0001]);
  });

  it("warns about collision exceptions and honours a custom image path", () => {
    const store = setup();
    store.dispatch({ type: "paintTerrain", layerId: "col", cells: [{ x: 0, y: 0, value: COLLISION_SOLID }] });
    const result = exportTmj(store.document, "main", { imagePath: (image) => `../tilesets/${image.fileName}` });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ code: "collisionExceptions", layers: expect.any(Array) });
    const tmj = JSON.parse(result.text) as { tilesets: { image: string }[] };
    expect(tmj.tilesets.map((t) => t.image)).toEqual(["../tilesets/grass.png", "../tilesets/items.png"]);
  });

  it("an empty map exports zero-filled layers and no tilesets", () => {
    const store = new MapStore(createDocument({ width: 2, height: 2 }));
    store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
    const tmj = JSON.parse(exportTmj(store.document, "e").text) as { layers: { data: number[] }[]; tilesets: unknown[] };
    expect(tmj.layers[0]!.data).toEqual([0, 0, 0, 0]);
    expect(tmj.tilesets).toEqual([]);
  });
});

describe("layerDrawList", () => {
  it("lists visible cells per layer in draw order with source/dest rects and flips", () => {
    const store = setup();
    store.dispatch({ type: "addLayer", layer: { id: "hidden", name: "Hidden" } });
    store.dispatch({ type: "paintCells", layerId: "hidden", cells: [{ x: 0, y: 0, cell: makeCell(store.getOrAddPaletteIndex("grass", 2)) }] });
    store.dispatch({ type: "setLayerProps", layerId: "hidden", props: { visible: false } });
    store.dispatch({ type: "setLayerProps", layerId: "deco", props: { opacity: 0.25 } });
    const list = layerDrawList(store.document);
    expect([list.width, list.height]).toEqual([128, 96]);
    expect(list.layers.map((l) => [l.layerId, l.opacity, l.items.length])).toEqual([
      ["ground", 1, 3],
      ["deco", 0.25, 1],
    ]);
    const [first, second, third] = list.layers[0]!.items;
    expect(first).toMatchObject({ src: { x: 32, y: 0, width: 32, height: 32 }, dest: { x: 0, y: 0, width: 32, height: 32 }, flipH: false, flipV: false });
    expect(second).toMatchObject({ src: { x: 32, y: 32 }, dest: { x: 96, y: 0 }, flipH: true, flipV: false });
    expect(third).toMatchObject({ src: { x: 224, y: 224 }, dest: { x: 32, y: 64 }, flipH: true, flipV: true });
    // 16px tile in a 32px cell: bottom-left anchored; margin 1 + spacing 2 in the source.
    expect(list.layers[1]!.items[0]).toMatchObject({
      tileset: { id: "items" },
      src: { x: 1 + 1 * 18, y: 1 + 1 * 18, width: 16, height: 16 },
      dest: { x: 64, y: 32 + 16, width: 16, height: 16 },
      flipV: true,
    });
  });
});
