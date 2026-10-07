/** Shared test fixtures for the export tests (not shipped: only imported by *.test.ts). */
import { createDocument, FLIP_H, FLIP_V, makeCell, MapStore, type Tileset } from "@smap/core";

export const grass: Tileset = {
  id: "grass",
  name: "Grass",
  imagePath: "tilesets/grass.png",
  tileWidth: 16,
  tileHeight: 16,
  columns: 4,
  rows: 4,
  margin: 0,
  spacing: 0,
};
/** Same basename as grass in another folder: export names it `grass-2.png`. */
export const grass2: Tileset = { ...grass, id: "grass2", name: "Grass 2", imagePath: "tilesets/other/grass.png" };
/** Never painted: not exported. */
export const unused: Tileset = { ...grass, id: "unused", name: "Unused", imagePath: "tilesets/unused.png" };

export const BYTES: Record<string, Uint8Array> = {
  grass: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]),
  grass2: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]),
  unused: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 3]),
};

/** 4×3 map of 16 px cells: ground layer (opaque) + deco layer (opacity 0.5, flips) + a hidden layer. */
export function sampleStore(): { store: MapStore; ground: string; deco: string; hidden: string } {
  const store = new MapStore(createDocument({ width: 4, height: 3, tileWidth: 16, tileHeight: 16 }));
  store.dispatch({ type: "addTileset", tileset: grass });
  store.dispatch({ type: "addTileset", tileset: grass2 });
  store.dispatch({ type: "addTileset", tileset: unused });
  const ground = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const deco = store.dispatch({ type: "addLayer", layer: { name: "Deco" } });
  const hidden = store.dispatch({ type: "addLayer", layer: { name: "Hidden" } });
  const a = store.getOrAddPaletteIndex("grass", 5); // col 1, row 1
  const b = store.getOrAddPaletteIndex("grass2", 2); // col 2, row 0
  store.dispatch({
    type: "paintCells",
    layerId: ground,
    cells: [
      { x: 0, y: 0, cell: makeCell(a) },
      { x: 3, y: 2, cell: makeCell(a) },
    ],
  });
  store.dispatch({
    type: "paintCells",
    layerId: deco,
    cells: [
      { x: 1, y: 0, cell: makeCell(b, FLIP_H) },
      { x: 2, y: 1, cell: makeCell(b, FLIP_V) },
      { x: 3, y: 1, cell: makeCell(b, FLIP_H | FLIP_V) },
    ],
  });
  store.dispatch({ type: "paintCells", layerId: hidden, cells: [{ x: 1, y: 1, cell: makeCell(a) }] });
  store.dispatch({ type: "setLayerProps", layerId: deco, props: { opacity: 0.5 } });
  store.dispatch({ type: "setLayerProps", layerId: hidden, props: { visible: false } });
  return { store, ground, deco, hidden };
}
