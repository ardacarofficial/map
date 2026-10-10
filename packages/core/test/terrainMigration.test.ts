/**
 * Format 1 → 2: legacy terrains (grid layer + derived tile layer) become
 * terrain-set tags on the tileset; the grid layer is dropped and the tiles
 * stay byte-identical. The brush then continues seamlessly on the old tiles.
 */
import { describe, expect, it } from "vitest";
import {
  deriveTerrainTiles,
  fileFormatVersion,
  MapStore,
  parseLevel,
  parseProject,
  serializeLevel,
  serializeProject,
} from "../src";
import { BLOB_ID, CORNER_ID, TERRAIN_TILESET, makeTerrainStore } from "./helpers";

/** A version-1 project + level pair as the v0.3–v1.x editor wrote them. */
function v1Fixture() {
  const store = makeTerrainStore(24, 20, 9, "blob47-godot");
  const cells = [];
  for (let y = 2; y < 8; y++) for (let x = 2; x < 10; x++) cells.push({ x, y, value: BLOB_ID });
  for (let y = 12; y < 16; y++) for (let x = 14; x < 20; x++) cells.push({ x, y, value: CORNER_ID });
  store.dispatch({ type: "paintTerrain", layerId: "terrain", cells });
  const level = JSON.parse(serializeLevel(store.document));
  level.documentFormatVersion = 1;
  const project = {
    format: "smap-project",
    documentFormatVersion: 1,
    name: "old",
    levels: [{ id: "lvl-1", name: "Main", path: "levels/main.json", world: { x: 0, y: 0 } }],
    tilesets: [
      {
        ...TERRAIN_TILESET,
        terrains: [
          { id: BLOB_ID, name: "Grass", template: "blob47-godot", origin: { col: 0, row: 0 } },
          { id: CORNER_ID, name: "Sand", template: "corner16", origin: { col: 8, row: 0 } },
        ],
      },
    ],
  };
  return { store, levelText: JSON.stringify(level, null, 2) + "\n", projectText: JSON.stringify(project, null, 2) + "\n" };
}

describe("format 1 → 2 migration", () => {
  it("project: legacy terrains → terrain sets (template macros); written as version 2 without `terrains`", () => {
    const { projectText } = v1Fixture();
    expect(fileFormatVersion(projectText)).toBe(1);
    const project = parseProject(projectText);
    const tileset = project.tilesets[0]!;
    expect(tileset.terrains?.length).toBe(2); // still in memory for the deprecated API
    expect(tileset.terrainSets!.map((s) => [s.id, s.kind, s.tiles.length])).toEqual([
      ["terrain-1", "blob", 47],
      ["terrain-2", "corner", 15],
    ]);
    const written = serializeProject(project);
    expect(fileFormatVersion(written)).toBe(2);
    expect(JSON.parse(written).tilesets[0].terrains).toBeUndefined();
    expect(serializeProject(parseProject(written))).toBe(written);
  });

  it("level: grid layer dropped, tile layer and palette byte-identical, stable afterwards", () => {
    const { levelText, projectText } = v1Fixture();
    const tilesets = parseProject(projectText).tilesets;
    const doc = parseLevel(levelText, tilesets);
    expect(doc.migrations).toEqual(['terrain grid layer "terrain" removed; its tiles stay on layer "tiles"']);
    const before = JSON.parse(levelText);
    const after = JSON.parse(serializeLevel(doc));
    expect(after.documentFormatVersion).toBe(2);
    expect(after.palette).toEqual(before.palette);
    expect(after.layers).toEqual(before.layers.filter((l: { role?: string }) => l.role !== "terrain"));
    // Reading the written v2 level again changes nothing.
    const again = serializeLevel(parseLevel(serializeLevel(doc), parseProject(serializeProject(parseProject(projectText))).tilesets));
    expect(again).toBe(serializeLevel(doc));
  });

  it("the brush continues on migrated tiles exactly like the old grid would have", () => {
    const { store, levelText, projectText } = v1Fixture();
    const doc = parseLevel(levelText, parseProject(projectText).tilesets);
    const migrated = new MapStore(doc);
    // Extend the blob area by one column and the sand area by one row.
    const blobCells = [2, 3, 4, 5, 6, 7].map((y) => ({ x: 10, y }));
    const sandCells = [14, 15, 16, 17, 18, 19].map((x) => ({ x, y: 16 }));
    migrated.dispatch({ type: "paintTerrainBrush", layerId: "tiles", cells: blobCells, tilesetId: "terrain", setId: "terrain-1", terrainId: 1 });
    migrated.dispatch({ type: "paintTerrainBrush", layerId: "tiles", cells: sandCells, tilesetId: "terrain", setId: "terrain-2", terrainId: 1 });
    store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: [...blobCells, ...sandCells].map((c, i) => ({ ...c, value: i < 6 ? BLOB_ID : CORNER_ID })) });
    const expected = deriveTerrainTiles(store.document, "terrain");
    const tiles = migrated.document.getLayer("tiles")!;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 24; x++) {
        const cell = tiles.getCell(x, y);
        expect(cell === 0 ? null : migrated.document.palette.get(cell)!.tileId).toBe(expected[y * 24 + x]?.tileId ?? null);
      }
    }
  });
});
