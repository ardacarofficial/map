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

/** 12×10 tileset: a blob47 block at (0, 0) (8×6) and a corner16 block at (8, 0) (4×4). */
export const TERRAIN_TILESET: Tileset = {
  id: "terrain",
  name: "Terrain",
  imagePath: "tilesets/terrain.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 12,
  rows: 10,
  margin: 0,
  spacing: 0,
};

export const BLOB_ID = 1;
export const CORNER_ID = 2;

/** Base tile id of a blob47 slot in TERRAIN_TILESET. */
export const blobTile = (slot: number) => (slot % 8) + Math.floor(slot / 8) * 12;
/** Base tile id of a corner16 slot in TERRAIN_TILESET. */
export const cornerTile = (slot: number) => 8 + (slot % 4) + Math.floor(slot / 4) * 12;

/**
 * A store with TERRAIN_TILESET, both terrains defined, a tile layer
 * "tiles" and a terrain grid "terrain" deriving into it. History cleared.
 */
export function makeTerrainStore(width = 16, height = 16, seed = 0) {
  const store = new MapStore(createDocument({ width, height, seed }));
  store.dispatch({ type: "addTileset", tileset: TERRAIN_TILESET });
  store.dispatch({
    type: "defineTerrain",
    terrain: { id: BLOB_ID, name: "Grass", tilesetId: "terrain", template: "blob47", origin: { col: 0, row: 0 } },
  });
  store.dispatch({
    type: "defineTerrain",
    terrain: { id: CORNER_ID, name: "Sand", tilesetId: "terrain", template: "corner16", origin: { col: 8, row: 0 } },
  });
  store.dispatch({ type: "addLayer", layer: { id: "tiles", name: "Tiles" } });
  store.dispatch({ type: "addLayer", layer: { id: "terrain", name: "Terrain", type: "grid", role: "terrain", targetLayerId: "tiles" } });
  store.clearHistory();
  return store;
}
