import { describe, expect, it } from "vitest";
import {
  FormatError,
  copyRegion,
  cutRegion,
  flipClip,
  parseClip,
  parseLevel,
  parseProject,
  pasteClip,
  serializeClip,
  serializeLevel,
  serializeProject,
  type ProjectData,
} from "../src";
import { BLOB_ID, CORNER_ID, TERRAIN_TILESET, makeTerrainStore } from "./helpers";

function painted() {
  const store = makeTerrainStore(40, 36, 77);
  store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
  store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: [{ x: 3, y: 3, value: BLOB_ID }, { x: 35, y: 33, value: CORNER_ID }] });
  store.dispatch({ type: "paintTerrain", layerId: "col", cells: [{ x: 1, y: 2, value: 2 }] });
  store.dispatch({ type: "setTileSolid", tilesetId: "terrain", tileIds: [5, 2], solid: true });
  store.dispatch({
    type: "defineTerrain",
    terrain: { id: 7, name: "Lava", tilesetId: "terrain", template: "corner16", origin: { col: 0, row: 6 }, variants: [{ slot: 15, tileIds: [119, 118] }] },
  });
  return store;
}

const project = (store: ReturnType<typeof painted>): ProjectData => ({ name: "p", levels: [], tilesets: store.document.tilesets });

describe("grid layers and tileset metadata serialization", () => {
  it("roundtrips byte-identically: legacy terrains become terrain sets, terrain grids migrate away", () => {
    const store = painted();
    const projectText = serializeProject(project(store));
    const parsedProject = parseProject(projectText);
    expect(serializeProject(parsedProject)).toBe(projectText);
    // Legacy terrains are written as terrain sets only.
    expect(parsedProject.tilesets[0]!.terrains).toBeUndefined();
    expect(parsedProject.tilesets[0]!.terrainSets!.map((s) => s.id)).toEqual(["terrain-1", "terrain-2", "terrain-7"]);

    const levelText = serializeLevel(store.document);
    const doc = parseLevel(levelText, parsedProject.tilesets);
    expect(doc.getLayer("terrain")).toBeUndefined();
    expect(doc.migrations).toEqual(['terrain grid layer "terrain" removed; its tiles stay on layer "tiles"']);
    expect(doc.getGridLayer("col")?.role).toBe("collision");
    expect(doc.seed).toBe(77);
    // The derived tiles are ordinary tiles now: byte-identical chunks.
    const tilesBefore = JSON.parse(levelText).layers[0];
    const savedAgain = serializeLevel(doc);
    expect(JSON.parse(savedAgain).layers[0]).toEqual(tilesBefore);
    expect(serializeLevel(parseLevel(savedAgain, parsedProject.tilesets))).toBe(savedAgain);

    const json = JSON.parse(levelText);
    expect(json.layers.map((l: Record<string, unknown>) => [l.type, l.role, l.target])).toEqual([
      ["tile", undefined, undefined],
      ["grid", "terrain", "tiles"],
      ["grid", "collision", undefined],
    ]);
    const ts = JSON.parse(projectText).tilesets[0];
    expect(ts.solidTiles).toEqual([2, 5]);
    expect(ts.terrains).toBeUndefined();
    expect(ts.terrainSets.map((t: { id: string }) => t.id)).toEqual(["terrain-1", "terrain-2", "terrain-7"]);
    expect(Object.keys(ts.terrainSets[2])).toEqual(["id", "name", "kind", "terrains", "tiles"]);
    // Lava (corner16 at (0, 6)) + variants 119 and 118 tagged like slot 15.
    const lava = ts.terrainSets[2];
    expect(lava.kind).toBe("corner");
    expect(lava.tiles.find((t: { tileId: number }) => t.tileId === 119).corners).toEqual([1, 1, 1, 1]);
    expect(lava.tiles.find((t: { tileId: number }) => t.tileId === 6 * 12 + 1).corners).toEqual([0, 1, 0, 0]);
  });

  it("files without terrain data keep their exact layout (no new keys)", () => {
    const store = makeTerrainStore(4, 4);
    const text = serializeProject({ name: "p", levels: [], tilesets: [{ ...TERRAIN_TILESET, solidTiles: [], terrains: [], terrainSets: [] }] });
    expect(text).not.toMatch(/solidTiles|terrains|terrainSets/);
    expect(JSON.parse(serializeLevel(store.document)).seed).toBeUndefined();
    expect(JSON.parse(text).documentFormatVersion).toBe(2);
  });

  it("migrates a terrain grid with a dangling target (its tile layer was removed)", () => {
    const store = painted();
    store.dispatch({ type: "removeLayer", layerId: "tiles" });
    const text = serializeLevel(store.document);
    const doc = parseLevel(text, store.document.tilesets);
    expect(doc.getLayer("terrain")).toBeUndefined();
    expect(doc.migrations).toEqual(['terrain grid layer "terrain" removed; its tiles stay on layer "tiles"']);
    // painting the in-session (deprecated) grid still works; there is nothing to derive into
    store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: [{ x: 0, y: 0, value: BLOB_ID }] });
  });

  it("rejects bad grid layers", () => {
    const store = painted();
    const tilesets = store.document.tilesets;
    const bad = (mutate: (l: { layers: Record<string, unknown>[]; seed?: unknown }) => void, pattern: RegExp) => {
      const level = JSON.parse(serializeLevel(store.document));
      mutate(level);
      expect(() => parseLevel(JSON.stringify(level), tilesets)).toThrow(FormatError);
      expect(() => parseLevel(JSON.stringify(level), tilesets)).toThrow(pattern);
    };
    bad((l) => (l.layers[1]!.role = "water"), /unknown grid role/);
    bad((l) => delete l.layers[1]!.role, /role: expected a string/);
    bad((l) => (l.layers[1]!.target = 5), /target: expected a string/);
    bad((l) => (l.layers[2]!.target = "tiles"), /only terrain grid layers/);
    bad((l) => (l.layers[0]!.role = "terrain"), /only grid layers/);
    bad((l) => (l.seed = -1), /seed/);
    bad((l) => {
      const second = { ...l.layers[1]!, id: "terrain2" };
      l.layers.push(second);
    }, /target of two terrain layers/);
  });

  it("rejects bad tileset metadata", () => {
    const store = painted();
    const bad = (mutate: (p: { tilesets: Record<string, unknown>[] }) => void, pattern: RegExp) => {
      const p = JSON.parse(serializeProject(project(store)));
      mutate(p);
      expect(() => parseProject(JSON.stringify(p))).toThrow(pattern);
    };
    type T = { solidTiles: number[]; terrains: Record<string, unknown>[]; terrainSets: Record<string, unknown>[] };
    const legacy = (p: { tilesets: Record<string, unknown>[] }) => {
      const t = p.tilesets[0] as unknown as T;
      delete (t as Partial<T>).terrainSets;
      t.terrains = [
        { id: 1, name: "Blob", template: "blob47", origin: { col: 0, row: 0 } },
        { id: 2, name: "Corner", template: "corner16", origin: { col: 8, row: 0 } },
      ];
      return t;
    };
    bad((p) => ((p.tilesets[0] as unknown as T).solidTiles = [5, 2]), /strictly ascending/);
    bad((p) => ((p.tilesets[0] as unknown as T).solidTiles = [2, 500]), /outside the tileset/);
    bad((p) => (legacy(p).terrains[0]!.template = "wang"), /unknown template/);
    bad((p) => (legacy(p).terrains[0]!.origin = { col: 9, row: 0 }), /does not fit/);
    bad((p) => (legacy(p).terrains[1]!.id = 1), /sorted by ascending id/);
    bad((p) => {
      legacy(p);
      p.tilesets.push({ ...p.tilesets[0]!, id: "other" });
    }, /terrain id 1 is used by tilesets/);
    bad((p) => ((p.tilesets[0] as unknown as T).terrainSets[0]!.kind = "hex"), /unknown terrain set kind/);
    bad((p) => ((p.tilesets[0] as unknown as T).terrainSets[1]!.id = "terrain-1"), /duplicate terrain set id/);
    bad((p) => {
      const tiles = (p.tilesets[0] as unknown as T).terrainSets[0]!.tiles as { tileId: number }[];
      tiles[1]!.tileId = tiles[0]!.tileId;
    }, /ascending tile id/);
    bad((p) => {
      const tiles = (p.tilesets[0] as unknown as T).terrainSets[1]!.tiles as { corners: number[] }[];
      tiles[0]!.corners = [9, 0, 0, 0];
    }, /not a terrain of the set/);
    bad((p) => {
      const tiles = (p.tilesets[0] as unknown as T).terrainSets[0]!.tiles as { tileId: number }[];
      tiles[tiles.length - 1]!.tileId = 500;
    }, /outside the tileset/);
  });
});

describe("clips with grid layers", () => {
  it("copy / flip / paste / cut a terrain grid; tiles re-derive; serialized clip roundtrips", () => {
    const store = makeTerrainStore(20, 20);
    store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: [{ x: 1, y: 1, value: BLOB_ID }, { x: 2, y: 1, value: BLOB_ID }] });
    const clip = copyRegion(store.document, ["terrain", "tiles"], { x: 0, y: 0, width: 4, height: 3 });
    expect(clip.layers[0]!.grid).toBe(true);
    expect(clip.layers[1]!.grid).toBeUndefined();
    const text = serializeClip(clip);
    expect(serializeClip(parseClip(text))).toBe(text);
    const flipped = flipClip(clip, "x");
    expect(flipped.layers[0]!.cells[1 * 4 + 1]).toBe(BLOB_ID);

    pasteClip(store, flipped, { terrain: "terrain" }, 10, 10);
    const grid = store.document.getLayer("terrain")!;
    expect(grid.getCell(11, 11)).toBe(BLOB_ID);
    expect(grid.getCell(12, 11)).toBe(BLOB_ID);
    expect(store.document.getLayer("tiles")!.getCell(11, 11)).not.toBe(0);
    expect(() => pasteClip(store, clip, { terrain: "tiles" }, 0, 0)).toThrow(/different kinds/);

    cutRegion(store, ["terrain"], { x: 10, y: 10, width: 4, height: 3 });
    expect(grid.getCell(11, 11)).toBe(0);
    expect(store.document.getLayer("tiles")!.getCell(11, 11)).toBe(0);
  });
});
