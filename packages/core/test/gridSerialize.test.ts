import { describe, expect, it } from "vitest";
import {
  FormatError,
  copyRegion,
  cutRegion,
  flipClip,
  isGridLayer,
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
  it("roundtrips byte-identically with grid layers, seed, solid flags and terrains", () => {
    const store = painted();
    const projectText = serializeProject(project(store));
    const parsedProject = parseProject(projectText);
    expect(serializeProject(parsedProject)).toBe(projectText);
    expect(parsedProject.tilesets).toEqual(store.document.tilesets);

    const levelText = serializeLevel(store.document);
    const doc = parseLevel(levelText, parsedProject.tilesets);
    expect(serializeLevel(doc)).toBe(levelText);
    const grid = doc.getLayer("terrain");
    expect(isGridLayer(grid) && grid.role === "terrain" && grid.targetLayerId === "tiles").toBe(true);
    expect(doc.getGridLayer("col")?.role).toBe("collision");
    expect(doc.getLayer("terrain")!.getCell(35, 33)).toBe(CORNER_ID);
    expect(doc.seed).toBe(77);
    expect(doc.getTerrain(7)?.variants).toEqual([{ slot: 15, tileIds: [119, 118] }]);

    const json = JSON.parse(levelText);
    expect(json.layers.map((l: Record<string, unknown>) => [l.type, l.role, l.target])).toEqual([
      ["tile", undefined, undefined],
      ["grid", "terrain", "tiles"],
      ["grid", "collision", undefined],
    ]);
    expect(Object.keys(json.layers[1])).toEqual(["id", "name", "type", "role", "target", "visible", "locked", "opacity", "chunks"]);
    const ts = JSON.parse(projectText).tilesets[0];
    expect(ts.solidTiles).toEqual([2, 5]);
    expect(ts.terrains.map((t: { id: number }) => t.id)).toEqual([1, 2, 7]);
    expect(Object.keys(ts.terrains[2])).toEqual(["id", "name", "template", "origin", "variants"]);
  });

  it("files without v0.3 data keep their exact layout (no new keys)", () => {
    const store = makeTerrainStore(4, 4);
    const text = serializeProject({ name: "p", levels: [], tilesets: [{ ...TERRAIN_TILESET, solidTiles: [], terrains: [] }] });
    expect(text).not.toMatch(/solidTiles|terrains/);
    expect(JSON.parse(serializeLevel(store.document)).seed).toBeUndefined();
    expect(JSON.parse(text).documentFormatVersion).toBe(1);
  });

  it("accepts a dangling target (its tile layer was removed)", () => {
    const store = painted();
    store.dispatch({ type: "removeLayer", layerId: "tiles" });
    const text = serializeLevel(store.document);
    const doc = parseLevel(text, store.document.tilesets);
    expect(doc.getGridLayer("terrain")?.targetLayerId).toBe("tiles");
    expect(serializeLevel(doc)).toBe(text);
    // painting still works; there is nothing to derive into
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
    type T = { solidTiles: number[]; terrains: Record<string, unknown>[] };
    bad((p) => ((p.tilesets[0] as unknown as T).solidTiles = [5, 2]), /strictly ascending/);
    bad((p) => ((p.tilesets[0] as unknown as T).solidTiles = [2, 500]), /outside the tileset/);
    bad((p) => ((p.tilesets[0] as unknown as T).terrains[0]!.template = "wang"), /unknown template/);
    bad((p) => ((p.tilesets[0] as unknown as T).terrains[0]!.origin = { col: 9, row: 0 }), /does not fit/);
    bad((p) => ((p.tilesets[0] as unknown as T).terrains[1]!.id = 1), /sorted by ascending id/);
    bad((p) => p.tilesets.push({ ...p.tilesets[0]!, id: "other" }), /terrain id 1 is used by tilesets/);
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
