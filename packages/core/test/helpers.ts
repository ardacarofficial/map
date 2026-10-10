import fc from "fast-check";
import {
  cellFlags,
  cellPaletteIndex,
  createDocument,
  deriveTerrainTiles,
  isGridLayer,
  isTileLayer,
  makeCell,
  MapStore,
  TERRAIN_TEMPLATES,
  terrainSlotForMask,
  terrainTemplateInfo,
  type MapDocument,
  type Terrain,
  type TerrainTemplate,
  type Tileset,
} from "../src";

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

/**
 * 12×10 tileset: a blob block at (0, 0) (8×6 legacy, 12×4 godot or 7×7 cr31)
 * and a corner16 block at (8, 0) (4×4). The blocks may overlap; tests only
 * look at one terrain at a time.
 */
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

/** Base tile id of a legacy `blob47` slot in TERRAIN_TILESET. */
export const blobTile = (slot: number) => (slot % 8) + Math.floor(slot / 8) * 12;
/** Base tile id of a slot of a blob block at (0, 0) of TERRAIN_TILESET. */
export const blobSlotTile = (template: TerrainTemplate, slot: number) => {
  const { columns } = terrainTemplateInfo(template);
  return (slot % columns) + Math.floor(slot / columns) * 12;
};
/** Base tile id showing 8-neighbour `mask` for a blob block at (0, 0) of TERRAIN_TILESET. */
export const blobMaskTile = (template: TerrainTemplate, mask: number) => blobSlotTile(template, terrainSlotForMask(template, mask));
/** Every blob47 layout id. */
export const BLOB_TEMPLATES: readonly TerrainTemplate[] = TERRAIN_TEMPLATES.filter((t) => t.family === "blob47").map((t) => t.id);
/** Base tile id of a corner16 slot in TERRAIN_TILESET. */
export const cornerTile = (slot: number) => 8 + (slot % 4) + Math.floor(slot / 4) * 12;

/**
 * A store with TERRAIN_TILESET, both terrains defined, a tile layer
 * "tiles" and a terrain grid "terrain" deriving into it. History cleared.
 */
export function makeTerrainStore(width = 16, height = 16, seed = 0, blobTemplate: TerrainTemplate = "blob47") {
  const store = new MapStore(createDocument({ width, height, seed }));
  store.dispatch({ type: "addTileset", tileset: TERRAIN_TILESET });
  store.dispatch({
    type: "defineTerrain",
    terrain: { id: BLOB_ID, name: "Grass", tilesetId: "terrain", template: blobTemplate, origin: { col: 0, row: 0 } },
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

/** Random valid terrain on TERRAIN_TILESET (12×10) with id 1..3, any template. */
export function terrainArb(): fc.Arbitrary<Terrain> {
  return fc
    .record({
      id: fc.constantFrom(1, 2, 3),
      template: fc.constantFrom(...TERRAIN_TEMPLATES.map((t) => t.id)),
      col: fc.nat({ max: 8 }),
      row: fc.nat({ max: 6 }),
      variants: fc.array(fc.record({ slot: fc.nat({ max: 15 }), tileIds: fc.array(fc.nat({ max: 119 }), { minLength: 1, maxLength: 3 }) }), { maxLength: 2 }),
    })
    .map(({ id, template, col, row, variants }) => {
      const info = terrainTemplateInfo(template);
      const used = variants.filter((v) => info.masks[v.slot] !== null);
      const unique = [...new Map(used.map((v) => [v.slot, v])).values()];
      return {
        id,
        name: `t${id}`,
        tilesetId: "terrain",
        template,
        origin: { col: Math.min(col, 12 - info.columns), row: Math.min(row, 10 - info.rows) },
        ...(unique.length > 0 ? { variants: unique } : {}),
      };
    });
}

/**
 * Cells ("x,y") where a terrain grid's target tile layer differs from
 * `deriveTerrainTiles` (wrong tile, extra tile, missing tile or flip flags),
 * for every terrain grid layer whose target tile layer exists.
 * Invariant: empty after any op.
 */
export function derivedMismatches(doc: MapDocument): string[] {
  const out: string[] = [];
  const { width, height } = doc.map;
  for (const grid of doc.layers) {
    if (!isGridLayer(grid) || grid.role !== "terrain" || grid.targetLayerId === null) continue;
    const target = doc.getLayer(grid.targetLayerId);
    if (!isTileLayer(target)) continue;
    const expected = deriveTerrainTiles(doc, grid.id);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const e = expected[y * width + x] ?? null;
        const cell = target.getCell(x, y);
        const got = cell === 0 ? null : doc.palette.get(cellPaletteIndex(cell)) ?? null;
        const same = e === null ? got === null : got !== null && cellFlags(cell) === 0 && got.tilesetId === e.tilesetId && got.tileId === e.tileId;
        if (!same) out.push(`${grid.id}→${target.id} ${x},${y}`);
      }
    }
  }
  return out;
}

/**
 * Level text as a format-2 load writes it back: the same JSON without the
 * legacy terrain grid layers (their derived tiles stay on the tile layers).
 */
export function stripTerrainGrids(text: string): string {
  const json = JSON.parse(text);
  json.documentFormatVersion = 2;
  json.layers = json.layers.filter((l: { role?: string }) => l.role !== "terrain");
  return JSON.stringify(json, null, 2) + "\n";
}
