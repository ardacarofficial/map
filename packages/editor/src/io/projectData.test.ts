import { createDocument, MapStore, parseProject, PROJECT_FILE_NAME, type Collection, type RandomSet, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { withProjectData } from "./levelWorkspace";
import { MemoryFileSystem } from "./memoryFs";
import { DEFAULT_LEVEL_PATH, loadProject, projectFiles, saveProject } from "./projectIo";

const grass: Tileset = { id: "grass", name: "Grass", imagePath: "tilesets/grass.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 4, margin: 0, spacing: 0 };
const set: RandomSet = {
  id: "flowers",
  name: "Çiçekler",
  candidates: [
    { kind: "tile", tilesetId: "grass", tileId: 1 },
    { kind: "tile", tilesetId: "grass", tileId: 2, weight: 3 },
  ],
};
const palette: Collection = { id: "fav", name: "Favoriler", columns: 2, cells: [{ x: 0, y: 0, tilesetId: "grass", tileId: 5 }] };
const fakeDecode = async () => ({ width: 1, height: 1, close() {} }) as unknown as ImageBitmap;

function storeWithData(): MapStore {
  const store = new MapStore(createDocument({ width: 8, height: 8, tileWidth: 16, tileHeight: 16 }));
  store.dispatch({ type: "addTileset", tileset: grass });
  store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  store.dispatch({ type: "setRandomSet", set });
  store.dispatch({ type: "setCollection", collection: palette });
  return store;
}

describe("round 4 project data (random sets, collections)", () => {
  it("is written to project.smap", () => {
    const store = storeWithData();
    const files = projectFiles({ name: "P", document: store.document, levelPath: DEFAULT_LEVEL_PATH, tilesetBytes: () => undefined });
    const project = files.find((f) => f.path === PROJECT_FILE_NAME)!;
    if (typeof project.data !== "string") throw new Error("project metadata must be text");
    const parsed = parseProject(project.data);
    expect(parsed.randomSets.map((s) => s.id)).toEqual(["flowers"]);
    expect(parsed.collections.map((c) => c.id)).toEqual(["fav"]);
  });

  it("survives save → open", async () => {
    const fs = new MemoryFileSystem("p");
    await saveProject(fs, { name: "P", document: storeWithData().document, levelPath: DEFAULT_LEVEL_PATH, tilesetBytes: () => new Uint8Array([1]) });
    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.document.randomSets.map((s) => s.name)).toEqual(["Çiçekler"]);
    expect(loaded.document.collections[0]?.cells).toEqual(palette.cells);
  });

  it("follows the active level on a level switch (withProjectData)", () => {
    const source = storeWithData().document;
    const other = new MapStore(createDocument({ width: 4, height: 4, tileWidth: 16, tileHeight: 16, tilesets: [grass] }));
    const synced = withProjectData(other, source);
    expect(synced.document.randomSets).toEqual(source.randomSets);
    expect(synced.document.collections).toEqual(source.collections);
  });
});
