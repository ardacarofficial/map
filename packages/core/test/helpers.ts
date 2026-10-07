import { createDocument, makeCell, MapStore, type Tileset } from "../src";

export const TILESET: Tileset = {
  id: "grass",
  name: "Grass",
  imagePath: "tilesets/grass.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 8,
  rows: 8,
  margin: 0,
  spacing: 0,
};

/** A store with one tileset, `paletteSize` palette entries and two layers. */
export function makeStore(width = 100, height = 80, paletteSize = 6) {
  const store = new MapStore(createDocument({ width, height }));
  store.dispatch({ type: "addTileset", tileset: TILESET });
  for (let t = 0; t < paletteSize; t++) store.getOrAddPaletteIndex(TILESET.id, t);
  const ground = store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
  const top = store.dispatch({ type: "addLayer", layer: { id: "top", name: "Top" } });
  // addLayer is undoable since v0.2; the setup is the starting point, not a user step.
  store.clearHistory();
  return { store, ground, top, cell: (i: number, flags = 0) => makeCell(i, flags) };
}
