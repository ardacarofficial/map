import { createDocument, makeCell, MapStore, serializeLevel, FLIP_H, type Stamp, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { LevelWorkspace } from "./levelWorkspace";
import { MemoryFileSystem } from "./memoryFs";
import { defaultLevels } from "./projectIo";
import { gridKey, loadAllLevels, remapBrush, remapStamp, remapStamps, sameGrid, syncLevelGrids } from "./tilesetRegrid";
import { clipFromTileset } from "@smap/core";

/** 96 × 64 px image cut in 16 px tiles: 6 × 4. */
const dungeon: Tileset = {
  id: "dungeon",
  name: "Dungeon",
  imagePath: "tilesets/dungeon.png",
  tileWidth: 16,
  tileHeight: 16,
  columns: 6,
  rows: 4,
  margin: 0,
  spacing: 0,
};
/** The same image cut in 32 px tiles: 3 × 2. */
const as32 = { ...dungeon, tileWidth: 32, tileHeight: 32, columns: 3, rows: 2 };
const bytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function levelStore(): MapStore {
  const store = new MapStore(createDocument({ width: 8, height: 8, tilesets: [dungeon] }));
  store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  store.clearHistory();
  return store;
}

function paint(store: MapStore, x: number, y: number, tileId: number): void {
  const layer = store.document.layers.find((l) => l.type === "tile")!;
  const index = store.getOrAddPaletteIndex("dungeon", tileId);
  store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x, y, cell: makeCell(index) }] });
}

/** Tile id drawn at (x, y), or null for an empty cell. */
function tileAt(store: MapStore, x: number, y: number): number | null {
  const cell = store.document.layers.find((l) => l.type === "tile")!.getCell(x, y);
  if (cell === 0) return null;
  return store.document.palette.get(cell & 0x1fffffff)!.tileId;
}

const to32 = { type: "updateTilesetGrid", tilesetId: "dungeon", tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0, imageWidth: 96, imageHeight: 64 } as const;

/** A saved two-level project: tile 2 (16 px, x = 32) and tile 3 (x = 48) in each level. */
async function project() {
  const fs = new MemoryFileSystem();
  const levels = defaultLevels("levels/main.json");
  const ws = new LevelWorkspace({ name: "P", levels, active: { id: levels[0]!.id, store: levelStore(), knownText: null } });
  paint(ws.active.store, 0, 0, 2);
  paint(ws.active.store, 1, 0, 3);
  const b = ws.add({ name: "Zindan", width: 8, height: 8, tileSize: 16, layerName: "Zemin" });
  const main = ws.activeId;
  await ws.activate(b.id, fs);
  paint(ws.active.store, 4, 4, 2);
  paint(ws.active.store, 5, 4, 3);
  await ws.save(fs, { tilesetBytes: bytes });
  ws.active.store.clearHistory(); // clean, no history: dropped from memory when main opens
  await ws.activate(main, fs);
  return { fs, ws, main, other: b.id };
}

describe("grid helpers", () => {
  it("compares and keys grids", () => {
    expect(sameGrid(dungeon, { ...dungeon })).toBe(true);
    expect(sameGrid(dungeon, as32)).toBe(false);
    expect(gridKey(dungeon)).toBe("16x16+0+0:6x4");
  });
});

describe("remapStamp", () => {
  const stamp: Stamp = {
    id: "ev",
    name: "Ev",
    width: 3,
    height: 1,
    palette: [
      { tilesetId: "dungeon", tileId: 2 },
      { tilesetId: "other", tileId: 5 },
      { tilesetId: "dungeon", tileId: 3 },
    ],
    layers: [
      { layerId: "a", name: "Zemin", cells: Uint32Array.of(makeCell(1, FLIP_H), makeCell(2), makeCell(3)) },
      { layerId: "g", name: "Collision", grid: true, role: "collision", cells: Uint32Array.of(1, 0, 1) },
    ],
  };

  it("moves tiles by pixel position and clears the ones that map nowhere", () => {
    const r = remapStamp(stamp, "dungeon", dungeon, as32);
    expect(r.changed).toBe(true);
    // 16 px tile 2 starts at x = 32 = 32 px tile 1; tile 3 (x = 48) is inside a 32 px tile → cleared.
    expect(r.clearedCells).toBe(1);
    expect(r.stamp.palette).toEqual([
      { tilesetId: "dungeon", tileId: 1 },
      { tilesetId: "other", tileId: 5 },
    ]);
    expect([...r.stamp.layers[0]!.cells]).toEqual([makeCell(1, FLIP_H), makeCell(2), 0]);
    // Grid layers do not use the palette.
    expect(r.stamp.layers[1]).toBe(stamp.layers[1]);
  });

  it("leaves stamps of other tilesets alone (same identity)", () => {
    const r = remapStamps([stamp], "nope", dungeon, as32);
    expect(r.changed).toEqual([]);
    expect(r.stamps[0]).toBe(stamp);
  });

  it("image mode keeps tiles that fall outside a smaller image", () => {
    const shorter = { ...dungeon, rows: 1 }; // 96 × 16: tiles 0–5
    const s: Stamp = { ...stamp, palette: [{ tilesetId: "dungeon", tileId: 8 }], layers: [{ layerId: "a", name: "Zemin", cells: Uint32Array.of(makeCell(1), 0, 0) }] };
    const r = remapStamp(s, "dungeon", dungeon, shorter);
    expect(r.changed).toBe(false);
    expect(r.stamp).toBe(s);
  });
});

describe("project-wide grid edit", () => {
  it("applies the edit to every level, and undo / redo follow", async () => {
    const { fs, ws, other } = await project();
    expect(ws.entry(other)).toBeUndefined(); // only on disk
    expect(await loadAllLevels(ws, fs)).toEqual([]);
    const otherBefore = serializeLevel(ws.entry(other)!.store.document);

    const result = ws.active.store.dispatch(to32);
    expect(result.remapped).toBe(1);
    expect(result.clearedCells).toBe(1);
    const sync = syncLevelGrids(ws);
    expect(sync).toEqual({ levels: [other], clearedCells: 1 });
    expect(ws.isDirty(other)).toBe(true);
    const o = ws.entry(other)!.store;
    expect(tileAt(o, 4, 4)).toBe(1);
    expect(tileAt(o, 5, 4)).toBeNull();

    // Undo in the active level: the other level follows byte for byte.
    ws.active.store.undo();
    expect(syncLevelGrids(ws).levels).toEqual([other]);
    expect(serializeLevel(o.document)).toBe(otherBefore);
    // Redo too.
    ws.active.store.redo();
    syncLevelGrids(ws);
    expect(tileAt(o, 4, 4)).toBe(1);
    expect(sameGrid(o.document.getTileset("dungeon")!, as32)).toBe(true);
    // Nothing left to do.
    expect(syncLevelGrids(ws).levels).toEqual([]);
  });

  it("keeps the other level after a save, and it opens with the right tiles", async () => {
    const { fs, ws, other } = await project();
    await loadAllLevels(ws, fs);
    ws.active.store.dispatch(to32);
    syncLevelGrids(ws);
    await ws.save(fs, { tilesetBytes: bytes });
    // Pinned: still in memory although clean.
    expect(ws.isDirty(other)).toBe(false);
    const entry = await ws.activate(other, fs);
    expect(tileAt(entry.store, 4, 4)).toBe(1);
    expect(ws.entry(other)).toBeDefined();
  });

  it("remaps with the core op when the level has no matching history", async () => {
    const { fs, ws, other } = await project();
    await loadAllLevels(ws, fs);
    const o = ws.entry(other)!.store;
    o.clearHistory();
    ws.active.store.dispatch(to32);
    ws.active.store.clearHistory();
    syncLevelGrids(ws);
    expect(tileAt(o, 4, 4)).toBe(1);
    expect(tileAt(o, 5, 4)).toBeNull();
  });

  it("undo / redo of the edit announce a tileset change (the app syncs on it)", () => {
    const store = levelStore();
    const seen: string[][] = [];
    store.subscribe((e) => seen.push([...e.structure]));
    store.dispatch(to32);
    store.undo();
    store.redo();
    expect(seen.filter((s) => s.includes("tilesets"))).toHaveLength(3);
  });

  it("reports levels that cannot be read", async () => {
    const { fs, ws } = await project();
    fs.files.delete("levels/zindan.json");
    expect(await loadAllLevels(ws, fs)).toEqual(["Zindan"]);
  });
});

describe("remapBrush (the brush follows a grid edit)", () => {
  // Bug: after "Tileset ayarları" 16 → 32 px the brush kept tile id 2 / 4 of the old grid
  // and painted other pixels (or, for ids beyond the new grid, silently nothing).
  it("moves the selected tile, random set, brush stamp and recent strip by pixel position", () => {
    const clip = clipFromTileset(dungeon, [{ col: 2, row: 0 }, { col: 4, row: 0 }])!;
    const refs = {
      selection: { tilesetId: "dungeon", tileId: 2 },
      randomSet: [
        { tilesetId: "dungeon", tileId: 2 },
        { tilesetId: "dungeon", tileId: 3 },
        { tilesetId: "other", tileId: 7 },
      ],
      stamp: clip,
      recentTiles: [
        { tilesetId: "dungeon", tileId: 4 },
        { tilesetId: "dungeon", tileId: 5 },
        { tilesetId: "other", tileId: 1 },
        { tilesetId: "dungeon", tileId: 2 },
      ],
    };
    const r = remapBrush(refs, "dungeon", dungeon, as32);
    expect(r.selection).toEqual({ tilesetId: "dungeon", tileId: 1 });
    expect(r.randomSet).toEqual([
      { tilesetId: "dungeon", tileId: 1 },
      { tilesetId: "other", tileId: 7 },
    ]);
    expect(r.stamp!.palette).toEqual([
      { tilesetId: "dungeon", tileId: 1 },
      { tilesetId: "dungeon", tileId: 2 },
    ]);
    expect(r.recentTiles).toEqual([
      { tilesetId: "dungeon", tileId: 2 },
      { tilesetId: "other", tileId: 1 },
      { tilesetId: "dungeon", tileId: 1 },
    ]);
  });

  it("drops what maps nowhere; a saved stamp is taken from the library by id", () => {
    const saved: Stamp = { id: "ev", name: "Ev", ...clipFromTileset(dungeon, [{ col: 3, row: 0 }, { col: 2, row: 0 }])! };
    const library: Stamp[] = [{ ...saved, palette: [{ tilesetId: "dungeon", tileId: 1 }] }];
    const r = remapBrush({ selection: { tilesetId: "dungeon", tileId: 3 }, randomSet: [], stamp: saved, recentTiles: [] }, "dungeon", dungeon, as32, library);
    expect(r.selection).toBeNull();
    expect(r.stamp).toBe(library[0]);
    const lone = clipFromTileset(dungeon, [{ col: 3, row: 0 }, { col: 5, row: 0 }])!;
    expect(remapBrush({ selection: null, randomSet: [], stamp: lone, recentTiles: [] }, "dungeon", dungeon, as32).stamp).toBeNull();
    // Nothing of that tileset: nothing changes.
    expect(remapBrush({ selection: { tilesetId: "x", tileId: 3 }, randomSet: [], stamp: null, recentTiles: [] }, "dungeon", dungeon, as32)).toEqual({});
  });
});
