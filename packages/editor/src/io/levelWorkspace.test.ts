import {
  createDocument,
  makeCell,
  MapStore,
  parseProject,
  portalStatus,
  PROJECT_FILE_NAME,
  serializeLevel,
  type Tileset,
} from "@smap/core";
import { describe, expect, it } from "vitest";

import { LevelWorkspace, levelFileStem, paletteProblems, withProjectData } from "./levelWorkspace";
import { MemoryFileSystem } from "./memoryFs";
import { defaultLevels, loadProject } from "./projectIo";

const grass: Tileset = {
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
const water: Tileset = { ...grass, id: "water", name: "Water", imagePath: "tilesets/water.png" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const bytes = () => PNG;
const fakeDecode = async () => ({ width: 1, height: 1, close() {} }) as unknown as ImageBitmap;

function firstStore(): MapStore {
  const store = new MapStore(createDocument({ width: 20, height: 10, tilesets: [grass] }));
  store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  store.clearHistory();
  return store;
}

function workspace(store = firstStore()): LevelWorkspace {
  const levels = defaultLevels("levels/main.json");
  return new LevelWorkspace({ name: "Dünya", levels, active: { id: levels[0]!.id, store, knownText: null } });
}

function paint(store: MapStore, x: number, y: number, tileId = 3): void {
  const layer = store.document.layers.find((l) => l.type === "tile")!;
  const index = store.getOrAddPaletteIndex("grass", tileId);
  store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x, y, cell: makeCell(index) }] });
}

const cell = (store: MapStore, x: number, y: number) => store.document.layers.find((l) => l.type === "tile")!.getCell(x, y);

const NEW = { width: 12, height: 8, tileSize: 32, layerName: "Zemin" };

describe("LevelWorkspace", () => {
  it("saves several levels and opens them again (round trip)", async () => {
    const fs = new MemoryFileSystem();
    const ws = workspace();
    paint(ws.active.store, 1, 1);
    const b = ws.add({ ...NEW, name: "Zindan" });
    expect(b.path).toBe("levels/zindan.json");
    await ws.activate(b.id, fs);
    paint(ws.active.store, 2, 3, 5);
    const saved = await ws.save(fs, { tilesetBytes: bytes });
    expect(saved.map((l) => l.path).sort()).toEqual(["levels/main.json", "levels/zindan.json"]);

    const project = parseProject(await fs.readText(PROJECT_FILE_NAME));
    expect(project.levels.map((l) => [l.id, l.name, l.path])).toEqual(ws.levels.map((l) => [l.id, l.name, l.path]));

    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.levelId).toBe(ws.levels[0]!.id);
    expect(loaded.levels).toHaveLength(2);
    const reopened = new LevelWorkspace({
      name: loaded.name,
      levels: loaded.levels,
      active: { id: loaded.levelId, store: new MapStore(loaded.document), knownText: loaded.levelText },
    });
    expect(cell(reopened.active.store, 1, 1)).not.toBe(0);
    const zindan = await reopened.activate(b.id, fs);
    expect(cell(zindan.store, 2, 3)).not.toBe(0);
    expect(serializeLevel(zindan.store.document)).toBe(await fs.readText("levels/zindan.json"));
    // A specific level can be opened directly.
    expect((await loadProject(fs, fakeDecode, { levelId: b.id })).levelPath).toBe("levels/zindan.json");
  });

  it("keeps unsaved edits and each level's undo history while switching", async () => {
    const fs = new MemoryFileSystem();
    const ws = workspace();
    const main = ws.activeId;
    const b = ws.add({ ...NEW, name: "B" });
    await ws.save(fs, { tilesetBytes: bytes });
    expect(ws.dirtyIds()).toEqual([]);

    const mainStore = ws.active.store;
    paint(mainStore, 0, 0);
    ws.markDirty();
    await ws.activate(b.id, fs);
    expect(ws.entry(main)?.store).toBe(mainStore); // dirty: kept in memory
    paint(ws.active.store, 4, 4);
    paint(ws.active.store, 5, 4);
    ws.markDirty();

    const back = await ws.activate(main, fs);
    expect(back.store).toBe(mainStore);
    expect(cell(back.store, 0, 0)).not.toBe(0);
    expect(back.store.undo()).toBe(true);
    expect(cell(back.store, 0, 0)).toBe(0);
    expect(back.store.canUndo).toBe(false);

    const bAgain = await ws.activate(b.id, fs);
    expect(bAgain.store.undoDepth).toBe(2);
    expect(ws.dirtyIds()).toEqual([main, b.id]);
  });

  it("drops a clean level without history when another opens, and reads it again", async () => {
    const fs = new MemoryFileSystem();
    const ws = workspace();
    const main = ws.activeId;
    const b = ws.add({ ...NEW, name: "B" });
    await ws.save(fs, { tilesetBytes: bytes });
    await ws.activate(b.id, fs);
    expect(ws.cachedIds()).not.toContain(main);
    await ws.activate(main, fs);
    expect(ws.cachedIds()).toEqual([b.id, main].filter((id) => ws.entry(id)));
    expect(ws.entry(b.id)).toBeUndefined();
  });

  it("never drops a level that is not on disk yet (project never saved)", async () => {
    const ws = workspace();
    const main = ws.activeId;
    const b = ws.add({ ...NEW, name: "B" });
    await ws.activate(b.id, null);
    expect(ws.entry(main)).toBeDefined();
    await ws.activate(main, null);
    expect(ws.entry(b.id)).toBeDefined();
  });

  it("deleting a level leaves portals to it missing, deletes its file and retires its id", async () => {
    const fs = new MemoryFileSystem();
    const ws = workspace();
    const b = ws.add({ ...NEW, name: "Zindan" });
    const store = ws.active.store;
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "Entity", type: "entity" } });
    const entityId = store.dispatch({
      type: "addEntity",
      layerId,
      entity: { typeId: "portal", x: 0, y: 0, fields: { targetLevel: b.id } },
    });
    await ws.save(fs, { tilesetBytes: bytes });
    const portal = store.document.findEntity(entityId as unknown as string)?.entity ?? store.document.entityLayers()[0]!.entities[0]!;
    const project = () => ({ name: "x", levels: ws.levels, tilesets: [] });
    expect(portalStatus(project(), portal)).toBe("ok");
    expect(await ws.portalsTo(b.id, fs)).toEqual({ count: 1, levels: ["main"], unreadable: 0 });

    expect(() => ws.remove(ws.activeId)).toThrow();
    ws.remove(b.id);
    expect(portalStatus(project(), portal)).toBe("missingLevel");
    expect(fs.files.has("levels/zindan.json")).toBe(true); // until saved
    await ws.save(fs, { tilesetBytes: bytes });
    expect(fs.files.has("levels/zindan.json")).toBe(false);
    expect(parseProject(await fs.readText(PROJECT_FILE_NAME)).retiredLevelIds).toEqual([b.id]);

    // A new level with the same name gets the same path but never the old id.
    const again = ws.add({ ...NEW, name: "Zindan" });
    expect(again.path).toBe("levels/zindan.json");
    expect(again.id).not.toBe(b.id);
    expect(portalStatus(project(), portal)).toBe("missingLevel");
    expect(() => ws.remove(again.id)).not.toThrow();
    expect(() => ws.remove(ws.activeId)).toThrow(); // the last level stays
  });

  it("duplicates a level (with unsaved edits) under a new id and file", async () => {
    const fs = new MemoryFileSystem();
    const ws = workspace();
    await ws.save(fs, { tilesetBytes: bytes });
    paint(ws.active.store, 7, 2);
    const copy = await ws.duplicate(ws.activeId, "main kopya", fs);
    expect(copy.id).not.toBe(ws.activeId);
    expect(copy.path).toBe("levels/main-kopya.json");
    expect(ws.levels.map((l) => l.name)).toEqual(["main", "main kopya"]);
    expect(serializeLevel(ws.entry(copy.id)!.store.document)).toBe(serializeLevel(ws.active.store.document));
    expect(ws.isDirty(copy.id)).toBe(true);
    // Its own store: editing the copy leaves the original alone.
    paint(ws.entry(copy.id)!.store, 0, 9);
    expect(cell(ws.active.store, 0, 9)).toBe(0);
  });

  it("autosave writes every dirty level once and keeps edits made during the write dirty", async () => {
    const fs = new MemoryFileSystem();
    const ws = workspace();
    const main = ws.activeId;
    const b = ws.add({ ...NEW, name: "B" });
    const c = ws.add({ ...NEW, name: "C" });
    await ws.save(fs, { tilesetBytes: bytes });
    await ws.activate(b.id, fs);
    paint(ws.active.store, 1, 1);
    ws.markDirty();
    await ws.activate(main, fs);
    paint(ws.active.store, 2, 2);
    ws.markDirty();

    const writes: string[] = [];
    const write = fs.writeText.bind(fs);
    fs.writeText = async (path, text) => {
      writes.push(path);
      // The user keeps drawing in the open level while files are written.
      if (path === "levels/b.json") paint(ws.active.store, 3, 3);
      await write(path, text);
    };
    const saved = await ws.save(fs, { tilesetBytes: bytes });
    expect(saved.map((l) => l.id).sort()).toEqual([main, b.id].sort());
    expect(writes.filter((p) => p.startsWith("levels/")).sort()).toEqual(["levels/b.json", "levels/main.json"]);
    expect(writes).not.toContain(`levels/c.json`);
    expect(ws.isDirty(b.id)).toBe(false);
    expect(ws.isDirty(main)).toBe(true); // changed during the write
    expect(ws.isDirty(c.id)).toBe(false);
  });

  it("brings a cached level's tilesets up to date when it becomes active", async () => {
    const ws = workspace();
    const main = ws.activeId;
    const b = ws.add({ ...NEW, name: "B" });
    ws.active.store.dispatch({ type: "addTileset", tileset: water });
    const entry = await ws.activate(b.id, null);
    expect(entry.store.document.tilesets.map((t) => t.id)).toEqual(["grass", "water"]);
    expect(entry.store.canUndo).toBe(false);
    void main;
  });

  it("finds a disk conflict for any level a save would overwrite", async () => {
    const fs = new MemoryFileSystem();
    const ws = workspace();
    const main = ws.activeId;
    const b = ws.add({ ...NEW, name: "B" });
    await ws.save(fs, { tilesetBytes: bytes });
    await ws.activate(b.id, fs);
    paint(ws.active.store, 1, 1);
    ws.markDirty();
    await ws.activate(main, fs);
    expect(await ws.findDiskConflict(fs)).toBeNull();
    await fs.writeText("levels/b.json", (await fs.readText("levels/b.json")).replace('"name": "Zemin"', '"name": "Değişti"'));
    expect((await ws.findDiskConflict(fs))?.path).toBe("levels/b.json");
    ws.acceptDiskText("levels/b.json", await fs.readText("levels/b.json"));
    expect(await ws.findDiskConflict(fs)).toBeNull();
  });

  it("makes portable, readable file names", () => {
    expect(levelFileStem("Zindan 2")).toBe("zindan-2");
    expect(levelFileStem("Çöl Şehri")).toBe("col-sehri");
    expect(levelFileStem("  ***  ")).toBe("level");
    expect(levelFileStem("con")).toBe("con_");
  });

  it("reports palette entries that cannot be drawn", () => {
    const store = firstStore();
    paint(store, 0, 0, 3);
    expect(paletteProblems(store.document)).toEqual({ missingTilesets: [], outOfRange: 0 });
  });
});


it("retains cached level identity and undo/redo when only generated provenance changes", async () => {
  const store = firstStore();
  const generated = { kind: "nineSlice" as const, stampId: "road", layerId: "s", sourceWidth: 3, sourceHeight: 3, layoutVersion: 1 as const, sources: [{ tilesetId: "grass", imageHash: "old" }] };
  store.dispatch({ type: "addTileset", tileset: { ...water, generated } });
  const ws = workspace(store), main = ws.activeId;
  const other = ws.add({ ...NEW, name: "Other" });
  await ws.activate(other.id, null);
  const cached = ws.active.store;
  paint(cached, 1, 1); paint(cached, 2, 1); cached.undo();
  const history = cached.historyEntries();
  await ws.activate(main, null);
  const next = { ...generated, sources: [{ tilesetId: "grass", imageHash: "new" }] };
  store.dispatch({ type: "setTilesetMeta", tilesetId: water.id, generated: next, undoable: false });
  // Opening without the normal event synchronizer must also preserve history.
  expect(withProjectData(cached, store.document)).toBe(cached);
  const reopened = await ws.activate(other.id, null);
  expect(reopened.store).toBe(cached);
  expect(cached.historyEntries()).toEqual(history);
  expect(cached.document.getTileset(water.id)?.generated).toEqual(next);
  cached.redo(); expect(cell(cached, 2, 1)).not.toBe(0);
  cached.undo(); cached.undo(); expect(cell(cached, 1, 1)).toBe(0);
});
