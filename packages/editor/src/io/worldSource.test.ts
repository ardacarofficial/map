import { createDocument, makeCell, MapStore, parseProject, PROJECT_FILE_NAME, type Tileset } from "@smap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LevelWorkspace } from "./levelWorkspace";
import { MemoryFileSystem } from "./memoryFs";
import { defaultLevels } from "./projectIo";
import { applyLevelMove, WorkspaceWorldSource } from "./worldSource";

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
const NEW = { width: 12, height: 8, tileSize: 32, layerName: "Zemin" };

function workspace(): LevelWorkspace {
  const store = new MapStore(createDocument({ width: 20, height: 10, tilesets: [grass] }));
  store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  store.clearHistory();
  const levels = defaultLevels("levels/main.json");
  return new LevelWorkspace({ name: "Dünya", levels, active: { id: levels[0]!.id, store, knownText: null } });
}

function paint(store: MapStore, x: number, y: number): void {
  const layer = store.document.layers.find((l) => l.type === "tile")!;
  const index = store.getOrAddPaletteIndex("grass", 3);
  store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x, y, cell: makeCell(index) }] });
}

function setup(ws: LevelWorkspace | null = workspace(), fs: MemoryFileSystem | null = null) {
  const source = new WorkspaceWorldSource({ workspace: () => ws, fs: () => fs, throttleMs: 500 });
  const changes: unknown[] = [];
  source.onChange((c) => changes.push(c));
  return { ws, source, changes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkspaceWorldSource", () => {
  it("levels() is the workspace's list: the same array until the list changes", () => {
    const { ws, source } = setup();
    const first = source.levels();
    expect(source.levels()).toBe(first);
    expect(source.levels()).toBe(ws!.levels);
    ws!.add({ ...NEW, name: "Zindan" });
    const second = source.levels();
    expect(second).not.toBe(first);
    expect(second.map((l) => l.name)).toEqual(["main", "Zindan"]);
    expect(source.levels()).toBe(second);
  });

  it("levels() without a project is a stable empty list", () => {
    const { source } = setup(null);
    expect(source.levels()).toEqual([]);
    expect(source.levels()).toBe(source.levels());
  });

  it("list changes report no levels; content changes list their ids", () => {
    const { source, changes } = setup();
    source.listChanged();
    source.contentChanged(["a", "b"]);
    source.contentChanged([]);
    source.contentChanged("all");
    expect(changes).toEqual([{}, { levels: ["a", "b"] }, { levels: "all" }]);
  });

  it("edits of the active level are coalesced to one report per interval", () => {
    vi.useFakeTimers();
    const { source, changes } = setup();
    source.activeEdited("main");
    source.activeEdited("main");
    vi.advanceTimersByTime(300);
    source.activeEdited("main");
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(changes).toEqual([{ levels: ["main"] }]);
    // Quiet: nothing more.
    vi.advanceTimersByTime(2000);
    expect(changes).toHaveLength(1);
    // A level switch inside the interval reports both.
    source.activeEdited("main");
    source.activeEdited("zindan");
    vi.advanceTimersByTime(500);
    expect(changes[1]).toEqual({ levels: ["main", "zindan"] });
  });

  it("a content report covers pending edits of the same level; dispose stops the timer", () => {
    vi.useFakeTimers();
    const { source, changes } = setup();
    source.activeEdited("main");
    source.contentChanged(["main"]);
    vi.advanceTimersByTime(600);
    expect(changes).toEqual([{ levels: ["main"] }]);
    source.activeEdited("main");
    source.dispose();
    vi.advanceTimersByTime(600);
    expect(changes).toHaveLength(1);
  });

  it("loads cached levels from memory (unsaved edits) and others from their file", async () => {
    const fs = new MemoryFileSystem();
    const ws = workspace();
    const zindan = ws.add({ ...NEW, name: "Zindan" });
    paint(ws.entry(zindan.id)!.store, 2, 2);
    await ws.save(fs, { tilesetBytes: () => undefined });
    const { source } = setup(ws, fs);

    // Cached (it is dirty-free now but has no history: still cached until another level opens).
    expect(await source.loadThumbnailDoc(ws.activeId)).toBe(ws.active.store.document);

    // Open Zindan, then main again: Zindan is dropped from the cache and read from disk.
    await ws.activate(zindan.id, fs);
    ws.entry(zindan.id)!.store.clearHistory();
    await ws.activate(defaultLevels("levels/main.json")[0]!.id, fs);
    expect(ws.entry(zindan.id)).toBeUndefined();
    const doc = await source.loadThumbnailDoc(zindan.id);
    expect(doc.map.width).toBe(12);
    expect(doc.layers[0]!.type).toBe("tile");
    expect(ws.entry(zindan.id)).toBeUndefined(); // reading does not cache

    await expect(source.loadThumbnailDoc("nope")).rejects.toThrow();
  });
});

describe("new level placement", () => {
  it("puts a new level right of the others on the tile grid (no pile at 0,0)", () => {
    const ws = workspace(); // main: 20×10 at 0,0, 32 px tiles
    const a = ws.add({ ...NEW, name: "A" });
    expect(a.world).toEqual({ x: 20 * 32 + 64, y: 0 });
    const b = ws.add({ ...NEW, name: "B" });
    expect(b.world).toEqual({ x: a.world.x + 12 * 32 + 64, y: 0 });
  });
});

describe("applyLevelMove", () => {
  it("writes the position unsnapped and reports whether it moved", async () => {
    const ws = workspace();
    const id = ws.activeId;
    const before = ws.levels;
    expect(applyLevelMove(ws, { levelId: id, x: 37, y: -64 })).toBe(true);
    expect(ws.level(id)!.world).toEqual({ x: 37, y: -64 });
    expect(ws.levels).not.toBe(before);
    expect(applyLevelMove(ws, { levelId: id, x: 37, y: -64 })).toBe(false);
    expect(applyLevelMove(ws, { levelId: "gone", x: 0, y: 0 })).toBe(false);

    // Saved into project.smap.
    const fs = new MemoryFileSystem();
    await ws.save(fs, { tilesetBytes: () => undefined });
    const project = parseProject(await fs.readText(PROJECT_FILE_NAME));
    expect(project.levels.find((l) => l.id === id)!.world).toEqual({ x: 37, y: -64 });
  });
});
