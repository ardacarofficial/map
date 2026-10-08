import { createDocument, makeCell, MapStore, tilesetUsage, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { LevelWorkspace } from "./levelWorkspace";
import { MemoryFileSystem } from "./memoryFs";
import { defaultLevels } from "./projectIo";
import { dropTilesetRefs, loadAllLevels, recordListChange, syncLevelLists, tilesetListKey } from "./tilesetRegrid";
import { summarizeUsage } from "../ui/tileset/libraryModel";

const tileset = (id: string): Tileset => ({
  id,
  name: id,
  imagePath: `tilesets/${id}.png`,
  tileWidth: 16,
  tileHeight: 16,
  columns: 4,
  rows: 4,
  margin: 0,
  spacing: 0,
});
const bytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function paint(store: MapStore, x: number, y: number, tilesetId: string, tileId: number): void {
  const layer = store.document.layers.find((l) => l.type === "tile")!;
  store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x, y, cell: makeCell(store.getOrAddPaletteIndex(tilesetId, tileId)) }] });
}

function tileAt(store: MapStore, x: number, y: number): string | null {
  const cell = store.document.layers.find((l) => l.type === "tile")!.getCell(x, y);
  if (cell === 0) return null;
  const e = store.document.palette.get(cell & 0x1fffffff)!;
  return `${e.tilesetId}#${e.tileId}`;
}

/** Edits the active level like the app does: one step, recorded, then the other levels follow. */
function edit(ws: LevelWorkspace, fn: (store: MapStore) => void): void {
  const store = ws.active.store;
  const before = tilesetListKey(store.document.tilesets);
  fn(store);
  recordListChange(store, before);
  syncLevelLists(ws);
}

/** Three saved levels; "rock" is painted in B and C (12 cells in C), "grass" everywhere. */
async function project() {
  const fs = new MemoryFileSystem();
  const levels = defaultLevels("levels/main.json");
  const store = new MapStore(createDocument({ width: 8, height: 8, tilesets: [tileset("grass"), tileset("rock")] }));
  store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  store.clearHistory();
  const ws = new LevelWorkspace({ name: "P", levels, active: { id: levels[0]!.id, store, knownText: null } });
  const main = ws.activeId;
  paint(ws.active.store, 0, 0, "grass", 1);
  const b = ws.add({ name: "B", width: 8, height: 8, tileSize: 16, layerName: "Zemin" });
  const c = ws.add({ name: "C", width: 8, height: 8, tileSize: 16, layerName: "Zemin" });
  await ws.activate(b.id, fs);
  paint(ws.active.store, 1, 1, "rock", 5);
  paint(ws.active.store, 2, 1, "grass", 2);
  await ws.activate(c.id, fs);
  for (let i = 0; i < 12; i++) paint(ws.active.store, i % 8, Math.floor(i / 8), "rock", 3);
  await ws.save(fs, { tilesetBytes: bytes });
  for (const id of ws.cachedIds()) ws.entry(id)!.store.clearHistory();
  await ws.activate(main, fs);
  return { fs, ws, main, b: b.id, c: c.id };
}

describe("project-wide tileset list (remove / rename / group / order)", () => {
  it("counts usage over every level, removes everywhere as one step, and undo restores every level exactly", async () => {
    const { fs, ws, b, c } = await project();
    expect(await loadAllLevels(ws, fs)).toEqual([]);
    const usage = summarizeUsage(ws.cachedIds().map((id) => tilesetUsage(ws.entry(id)!.store.document, "rock")));
    expect(usage).toMatchObject({ cells: 13, levels: 2, used: true });

    edit(ws, (s) => s.dispatch({ type: "removeTileset", tilesetId: "rock" }));
    for (const id of ws.cachedIds()) expect(ws.entry(id)!.store.document.tilesets.map((t) => t.id)).toEqual(["grass"]);
    const B = ws.entry(b)!.store;
    expect(tileAt(B, 1, 1)).toBeNull();
    expect(tileAt(B, 2, 1)).toBe("grass#2");
    expect(ws.dirtyIds()).toEqual(expect.arrayContaining([b, c]));

    // Ctrl+Z in the active level: every level gets the tileset and its cells back.
    ws.active.store.undo();
    syncLevelLists(ws);
    for (const id of ws.cachedIds()) expect(ws.entry(id)!.store.document.tilesets.map((t) => t.id)).toEqual(["grass", "rock"]);
    expect(tileAt(B, 1, 1)).toBe("rock#5");
    expect(tilesetUsage(ws.entry(c)!.store.document, "rock").cells).toBe(12);
    // The follow was the level's own undo (byte-exact), not a new step.
    expect(B.canUndo).toBe(false);

    // Redo follows too.
    ws.active.store.redo();
    syncLevelLists(ws);
    expect(tileAt(B, 1, 1)).toBeNull();
  });

  it("name, group and order follow; a level that made the edit itself mirrors back losslessly", async () => {
    const { fs, ws, b } = await project();
    await loadAllLevels(ws, fs);
    edit(ws, (s) => {
      s.beginTransaction();
      s.dispatch({ type: "setTilesetMeta", tilesetId: "rock", name: "Kaya", group: "Zindan" });
      s.dispatch({ type: "moveTileset", tilesetId: "rock", index: 0 });
      s.commit();
    });
    const key = tilesetListKey(ws.active.store.document.tilesets);
    expect(tilesetListKey(ws.entry(b)!.store.document.tilesets)).toBe(key);
    expect(ws.entry(b)!.store.document.tilesets[0]).toMatchObject({ id: "rock", name: "Kaya", group: "Zindan" });

    // Open B and undo its follow step there: the old main level mirrors it.
    await ws.activate(b, fs);
    ws.active.store.undo();
    syncLevelLists(ws);
    for (const id of ws.cachedIds()) expect(ws.entry(id)!.store.document.tilesets.map((t) => [t.id, t.name, t.group ?? null])).toEqual([
      ["grass", "grass", null],
      ["rock", "rock", null],
    ]);
  });

  it("an added tileset reaches the cached levels", async () => {
    const { fs, ws, c } = await project();
    await loadAllLevels(ws, fs);
    edit(ws, (s) => s.dispatch({ type: "addTileset", tileset: tileset("sand") }));
    expect(ws.entry(c)!.store.document.getTileset("sand")).toBeDefined();
    ws.active.store.undo();
    syncLevelLists(ws);
    expect(ws.entry(c)!.store.document.getTileset("sand")).toBeUndefined();
  });
});

describe("dropTilesetRefs", () => {
  it("drops brush state that names a missing tileset", () => {
    const exists = (id: string) => id === "grass";
    const clip = { width: 1, height: 1, palette: [{ tilesetId: "rock", tileId: 1 }], layers: [] };
    const out = dropTilesetRefs(
      {
        selection: { tilesetId: "rock", tileId: 1 },
        randomSet: [
          { tilesetId: "rock", tileId: 1 },
          { tilesetId: "grass", tileId: 2 },
        ],
        stamp: clip,
        recentTiles: [{ tilesetId: "grass", tileId: 1 }, { tilesetId: "rock", tileId: 2 }, { stamp: clip, key: "k" }],
      },
      exists,
    );
    expect(out).toEqual({ selection: null, randomSet: [{ tilesetId: "grass", tileId: 2 }], stamp: null, recentTiles: [{ tilesetId: "grass", tileId: 1 }] });
    expect(dropTilesetRefs({ selection: null, randomSet: [], stamp: null, recentTiles: [] }, exists)).toEqual({});
  });
});
