import {
  createDocument,
  createStamp,
  makeCell,
  MapStore,
  PROJECT_FILE_NAME,
  serializeStamp,
  stampPath,
  type Stamp,
  type Tileset,
  withStampMeta,
} from "@smap/core";

import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "./memoryFs";
import { DEFAULT_LEVEL_PATH, loadProject, projectFiles, saveProject, type SaveProjectInput } from "./projectIo";
import { stampEditLayout, stampEditStore, stampFromDocument } from "../ui/stampEditor/stampDoc";
import { loadStamps, removeStaleStamps } from "./stampsIo";

const grass: Tileset = {
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
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const fakeDecode = async () => ({ width: 1, height: 1, close() {} }) as unknown as ImageBitmap;

function sample() {
  const store = new MapStore(createDocument({ width: 12, height: 8, tileWidth: 16, tileHeight: 16 }));
  store.dispatch({ type: "addTileset", tileset: grass });
  const ground = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  const walls = store.dispatch({ type: "addLayer", layer: { name: "Duvar" } });
  const coll = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
  store.dispatch({ type: "addLayer", layer: { name: "Entity", type: "entity" } });
  const a = store.getOrAddPaletteIndex("grass", 1);
  const b = store.getOrAddPaletteIndex("grass", 7);
  store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: makeCell(a) }, { x: 2, y: 1, cell: makeCell(a) }] });
  store.dispatch({ type: "paintCells", layerId: walls, cells: [{ x: 1, y: 2, cell: makeCell(b) }] });
  store.dispatch({ type: "paintTerrain", layerId: coll, cells: [{ x: 1, y: 2, value: 1 }] });
  return store;
}

function stampOf(store: MapStore, id: string, name: string, x = 1): Stamp {
  const doc = store.document;
  const layers = doc.layers.filter((l) => l.type !== "entity").map((l) => l.id);
  return createStamp(doc, layers, { x, y: 1, width: 2, height: 2 }, { id, name });
}

function input(store: MapStore, stamps?: Stamp[], extra: Partial<SaveProjectInput> = {}): SaveProjectInput {
  return {
    name: "Köy",
    document: store.document,
    levelPath: DEFAULT_LEVEL_PATH,
    tilesetBytes: () => PNG,
    ...(stamps ? { stamps } : {}),
    ...extra,
  };
}

describe("stamp persistence", () => {
  it("round-trips stamps with every tile and grid layer through save / open", async () => {
    const fs = new MemoryFileSystem();
    const store = sample();
    const house = stampOf(store, "ev", "Büyük Ev");
    const well = stampOf(store, "kuyu", "Kuyu", 2);
    await saveProject(fs, input(store, [well, house]));

    expect(fs.files.has("stamps/ev.json")).toBe(true);
    expect(fs.files.has("stamps/kuyu.json")).toBe(true);
    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.stamps.map((s) => s.name)).toEqual(["Büyük Ev", "Kuyu"]);
    expect(loaded.brokenStamps).toEqual([]);
    const back = loaded.stamps[0]!;
    expect(serializeStamp(back)).toBe(serializeStamp(house));
    expect(back.layers.map((l) => [l.name, l.grid === true])).toEqual([
      ["Zemin", false],
      ["Duvar", false],
      ["Collision", true],
    ]);
  });

  it("round-trips library metadata (category, tags, ★) and a stamp-editor save", async () => {
    const fs = new MemoryFileSystem();
    const store = sample();
    const house = withStampMeta(stampOf(store, "ev", "Ev"), { category: "Binalar", tags: ["köy", "ahşap"], favorite: true });
    const plain = stampOf(store, "kuyu", "Kuyu");
    await saveProject(fs, input(store, [house, plain]));
    let loaded = await loadProject(fs, fakeDecode);
    const ev = loaded.stamps.find((s) => s.id === "ev")!;
    expect([ev.category, ev.tags, ev.favorite]).toEqual(["Binalar", ["köy", "ahşap"], true]);
    const kuyu = loaded.stamps.find((s) => s.id === "kuyu")!;
    expect([kuyu.category, kuyu.tags, kuyu.favorite]).toEqual([undefined, undefined, undefined]);
    expect(serializeStamp(ev)).toBe(serializeStamp(house));

    // Clearing metadata leaves the keys out of the file again.
    const cleared = withStampMeta(ev, { category: "", tags: [], favorite: false });
    await saveProject(fs, input(store, [cleared, kuyu]));
    expect(await fs.readText(stampPath("ev"))).not.toMatch(/category|tags|favorite/);

    // Stamp editor: open, draw, save → cropped content under the same id, name and metadata.
    const editing = stampEditStore(ev, store.document);
    const idx = editing.getOrAddPaletteIndex("grass", 9);
    const ground = editing.document.layers[0]!.id;
    const { x, y } = stampEditLayout(ev);
    editing.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: x + 2, y, cell: makeCell(idx) }] });
    const content = stampFromDocument(editing.document, ev)!;
    const saved = withStampMeta(content, { category: ev.category!, tags: ev.tags!, favorite: ev.favorite! });
    await saveProject(fs, input(store, [saved, kuyu]));
    loaded = await loadProject(fs, fakeDecode);
    const back = loaded.stamps.find((s) => s.id === "ev")!;
    expect([back.name, back.width, back.height, back.category, back.favorite]).toEqual(["Ev", 3, 2, "Binalar", true]);
    expect(back.layers.map((l) => l.name)).toEqual(["Zemin", "Duvar", "Collision"]);
    // The level itself is untouched (stamps are flat copies, nothing links back).
    expect(loaded.document.layers.length).toBe(store.document.layers.length);
  });

  it("removes the file of a deleted stamp on the next save and keeps unchanged files", async () => {
    const fs = new MemoryFileSystem();
    const store = sample();
    const house = stampOf(store, "ev", "Ev");
    const well = stampOf(store, "kuyu", "Kuyu");
    await saveProject(fs, input(store, [house, well]));
    const before = fs.files.get(stampPath("ev"));

    await saveProject(fs, input(store, [house]));
    expect(fs.files.has(stampPath("kuyu"))).toBe(false);
    expect(fs.files.get(stampPath("ev"))).toBe(before); // not rewritten (same object)
    expect((await loadProject(fs, fakeDecode)).stamps.map((s) => s.id)).toEqual(["ev"]);
  });

  it("writes a renamed stamp under the same id", async () => {
    const fs = new MemoryFileSystem();
    const store = sample();
    const house = stampOf(store, "ev", "Ev");
    await saveProject(fs, input(store, [house]));
    await saveProject(fs, input(store, [{ ...house, name: "Kulübe" }]));
    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.stamps.map((s) => [s.id, s.name])).toEqual([["ev", "Kulübe"]]);
  });

  it("leaves stamp files alone when no library is given", async () => {
    const fs = new MemoryFileSystem();
    const store = sample();
    await saveProject(fs, input(store, [stampOf(store, "ev", "Ev")]));
    await saveProject(fs, input(store));
    expect(fs.files.has(stampPath("ev"))).toBe(true);
  });

  it("reports unreadable stamp files and never deletes them", async () => {
    const fs = new MemoryFileSystem();
    const store = sample();
    await saveProject(fs, input(store, [stampOf(store, "ev", "Ev")]));
    await fs.writeText("stamps/bozuk.json", "{ not json");
    await fs.writeText("stamps/notes.txt", "x");
    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.brokenStamps).toEqual(["stamps/bozuk.json"]);
    await saveProject(fs, input(store, loaded.stamps, { keepStampFiles: loaded.brokenStamps }));
    expect(fs.files.has("stamps/bozuk.json")).toBe(true);
    expect(fs.files.has("stamps/notes.txt")).toBe(true);
    // Without the keep list a stale file is removed.
    await removeStaleStamps(fs, loaded.stamps);
    expect(fs.files.has("stamps/bozuk.json")).toBe(false);
  });

  it("puts stamp files into the project file list (zip export) before project.smap", () => {
    const store = sample();
    const paths = projectFiles(input(store, [stampOf(store, "ev", "Ev")])).map((f) => f.path);
    expect(paths).toContain("stamps/ev.json");
    expect(paths.indexOf("stamps/ev.json")).toBeLessThan(paths.indexOf(PROJECT_FILE_NAME));
  });

  it("an empty stamps folder loads as an empty library", async () => {
    expect(await loadStamps(new MemoryFileSystem())).toEqual({ stamps: [], broken: [] });
  });
});

describe("project-level entity data", () => {
  it("saves entity types and entities, and opens them again", async () => {
    const fs = new MemoryFileSystem();
    const store = sample();
    store.dispatch({
      type: "defineEntityType",
      entityType: { id: "sandik", name: "Sandık", color: "#f59e0b", fields: [{ name: "adet", type: "int", default: 1 }] },
    });
    const layerId = store.document.entityLayers()[0]!.id;
    store.dispatch({ type: "addEntity", layerId, entity: { typeId: "sandik", x: 32, y: 16, fields: { adet: 3 } } });
    store.dispatch({ type: "addEntity", layerId, entity: { typeId: "spawn", x: 0, y: 0 } });
    await saveProject(fs, input(store, []));

    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.document.entityTypes.map((t) => t.id)).toEqual(["sandik"]);
    const entities = loaded.document.entityLayers()[0]!.entities;
    expect(entities.map((e) => [e.typeId, e.x, e.y, e.fields])).toEqual([
      ["sandik", 32, 16, { adet: 3 }],
      ["spawn", 0, 0, {}],
    ]);
    expect(loaded.document.spawn()?.typeId).toBe("spawn");
  });

  it("keeps level ids and the level list when saving", async () => {
    const fs = new MemoryFileSystem();
    const store = sample();
    const levels = [
      { id: "lvl-koy", name: "Köy", path: DEFAULT_LEVEL_PATH, world: { x: 0, y: 0 } },
      { id: "lvl-zindan", name: "Zindan", path: "levels/zindan.json", world: { x: 640, y: 0 } },
    ];
    await saveProject(fs, input(store, [], { levels }));
    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.levels.map((l) => [l.id, l.name, l.path])).toEqual(levels.map((l) => [l.id, l.name, l.path]));
  });
});
