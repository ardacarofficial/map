import fc from "fast-check";
import { createDocument, makeCell, MapStore, type Terrain, type Tileset } from "../src";

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

/** Random valid terrain on TERRAIN_TILESET (12×10) with id 1..3. */
export function terrainArb(): fc.Arbitrary<Terrain> {
  return fc
    .record({
      id: fc.constantFrom(1, 2, 3),
      template: fc.constantFrom("blob47" as const, "corner16" as const),
      col: fc.nat({ max: 8 }),
      row: fc.nat({ max: 6 }),
      variants: fc.array(fc.record({ slot: fc.nat({ max: 15 }), tileIds: fc.array(fc.nat({ max: 119 }), { minLength: 1, maxLength: 3 }) }), { maxLength: 2 }),
    })
    .map(({ id, template, col, row, variants }) => {
      const maxCol = template === "blob47" ? 4 : 8;
      const maxRow = template === "blob47" ? 4 : 6;
      const unique = [...new Map(variants.map((v) => [v.slot, v])).values()];
      return {
        id,
        name: `t${id}`,
        tilesetId: "terrain",
        template,
        origin: { col: Math.min(col, maxCol), row: Math.min(row, maxRow) },
        ...(unique.length > 0 ? { variants: unique } : {}),
      };
    });
}
