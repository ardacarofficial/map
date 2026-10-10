import { createDocument, makeCell, MapStore, serializeLevel, FLIP_H, type Stamp, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { LevelWorkspace } from "./levelWorkspace";
import { MemoryFileSystem } from "./memoryFs";
import { defaultLevels } from "./projectIo";
import { dropTileRefs, gridKey, loadAllLevels, remapTileRefs, recordRegrid, remapBrush, remapStamp, remapStamps, sameGrid, stampKey, syncLevelGrids, syncStampGrid, type StampRegrid } from "./tilesetRegrid";
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
    expect(sync).toEqual({ levels: [other], clearedCells: 1, restoredCells: 0, keptCells: 0 });
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

/** Tile id and flip flags at (x, y), or null for an empty cell. */
function tileWithFlags(store: MapStore, x: number, y: number): [number, number] | null {
  const cell = store.document.layers.find((l) => l.type === "tile")!.getCell(x, y);
  if (cell === 0) return null;
  return [store.document.palette.get(cell & 0x1fffffff)!.tileId, cell >>> 29];
}

function paintFlipped(store: MapStore, x: number, y: number, tileId: number, flags: number): void {
  const layer = store.document.layers.find((l) => l.type === "tile")!;
  const index = store.getOrAddPaletteIndex("dungeon", tileId);
  store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x, y, cell: makeCell(index, flags) }] });
}

/** Every cell of the 8 × 8 level as tile + flags (palette indices aside: unused entries may stay). */
function allTiles(store: MapStore): ([number, number] | null)[] {
  const out: ([number, number] | null)[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out.push(tileWithFlags(store, x, y));
  return out;
}

/** The active level's edit as the app runs it: dispatch, record, sync. */
function editActive(ws: LevelWorkspace) {
  const before = { ...ws.active.store.document.getTileset("dungeon")! };
  ws.active.store.dispatch(to32);
  recordRegrid(ws.active.store, "dungeon", before);
  return syncLevelGrids(ws);
}

// Bug: after a grid edit in level A, painting in level B and then undoing the edit in A,
// B was remapped a second time (16 → 32 → 16 by pixel position): the cells the edit had
// cleared in B never came back.
describe("undo of a project-wide grid edit is lossless in the other levels", () => {
  async function edited() {
    const p = await project();
    await loadAllLevels(p.ws, p.fs);
    const o = p.ws.entry(p.other)!.store;
    // More cells the 32 px grid has no place for (16 px ids 7 and 9), one flipped.
    o.beginTransaction();
    paintFlipped(o, 2, 2, 7, FLIP_H);
    paint(o, 6, 4, 9);
    o.commit();
    const sync = editActive(p.ws);
    return { ...p, o, sync };
  }

  it("restores the cleared cells exactly, keeps cells painted since, and redo follows", async () => {
    const { ws, o, sync } = await edited();
    expect(sync.clearedCells).toBe(3);
    expect(tileAt(o, 5, 4)).toBeNull();
    expect(tileAt(o, 2, 2)).toBeNull();
    // Paint in B after the edit (32 px ids): over a cleared cell, and a new one.
    paint(o, 6, 4, 2); // 32 px tile 2 = x 64 = 16 px tile 4
    paint(o, 0, 7, 4); // 32 px tile 4 = (32, 32) = 16 px tile 14
    const painted = allTiles(o);

    ws.active.store.undo();
    const undo = syncLevelGrids(ws);
    expect(undo.restoredCells).toBe(2);
    expect(undo.keptCells).toBe(1);
    expect(sameGrid(o.document.getTileset("dungeon")!, dungeon)).toBe(true);
    // Untouched cleared cells: back exactly (tile and flip flags).
    expect(tileWithFlags(o, 5, 4)).toEqual([3, 0]);
    expect(tileWithFlags(o, 2, 2)).toEqual([7, FLIP_H >>> 29]);
    expect(tileAt(o, 4, 4)).toBe(2);
    // Painted since: the new paint stays (same pixels in the old grid).
    expect(tileAt(o, 6, 4)).toBe(4);
    expect(tileAt(o, 0, 7)).toBe(14);
    // B's tileset is the active level's again (no rebuild when it opens).
    expect(o.document.getTileset("dungeon")).toEqual(ws.active.store.document.getTileset("dungeon"));

    // Redo in A: B goes back to exactly what it was before the undo (its own undo of the restore step).
    const canRedoBefore = o.redoDepth;
    ws.active.store.redo();
    expect(syncLevelGrids(ws).levels).toHaveLength(1);
    expect(o.redoDepth).toBe(canRedoBefore + 1);
    expect(allTiles(o)).toEqual(painted);
    expect(sameGrid(o.document.getTileset("dungeon")!, as32)).toBe(true);
    // And undo again restores again.
    ws.active.store.undo();
    syncLevelGrids(ws);
    expect(tileWithFlags(o, 5, 4)).toEqual([3, 0]);
    expect(tileWithFlags(o, 2, 2)).toEqual([7, FLIP_H >>> 29]);
    expect(tileAt(o, 6, 4)).toBe(4);
  });

  it("restoring is one undo step in B; painting after the undo still allows the redo", async () => {
    const { ws, o } = await edited();
    paint(o, 0, 7, 4);
    ws.active.store.undo();
    syncLevelGrids(ws);
    paint(o, 1, 7, 5); // 16 px tile 5 = x 80: no 32 px tile starts there
    ws.active.store.redo();
    const redo = syncLevelGrids(ws);
    expect(sameGrid(o.document.getTileset("dungeon")!, as32)).toBe(true);
    // The redo is the edit again: tiles without a place are cleared, the rest moves by pixel position.
    expect(tileAt(o, 5, 4)).toBeNull();
    expect(tileAt(o, 1, 7)).toBeNull();
    expect(redo.clearedCells).toBeGreaterThan(0);
    expect(tileAt(o, 0, 7)).toBe(4);
    // Undo again: everything the redo cleared that is untouched comes back.
    ws.active.store.undo();
    syncLevelGrids(ws);
    expect(tileAt(o, 5, 4)).toBe(3);
    expect(tileAt(o, 1, 7)).toBe(5);
    expect(tileAt(o, 0, 7)).toBe(14);
  });

  it("writes into a layer locked since, and leaves it locked", async () => {
    const { ws, o } = await edited();
    const layer = o.document.layers.find((l) => l.type === "tile")!;
    o.dispatch({ type: "setLayerProps", layerId: layer.id, props: { locked: true } });
    ws.active.store.undo();
    syncLevelGrids(ws);
    expect(tileAt(o, 5, 4)).toBe(3);
    expect(o.document.getLayer(layer.id)!.locked).toBe(true);
  });

  it("the other level made the edit itself: the active one follows its undo losslessly too", async () => {
    const { fs, ws, main, other } = await project();
    await loadAllLevels(ws, fs);
    await ws.activate(other, fs);
    const a = ws.entry(main)!.store;
    editActive(ws);
    expect(tileAt(a, 1, 0)).toBeNull(); // 16 px tile 3 has no place
    paint(a, 3, 3, 1);
    await ws.activate(main, fs);
    // Undo the edit from B's history while A is open (B is not active: undo it directly, then sync from B).
    await ws.activate(other, fs);
    ws.active.store.undo();
    syncLevelGrids(ws);
    expect(tileAt(a, 1, 0)).toBe(3);
    expect(tileAt(a, 0, 0)).toBe(2);
    expect(tileAt(a, 3, 3)).toBe(2); // painted since: 32 px tile 1 = 16 px tile 2
  });
});

describe("syncStampGrid (stamps follow undo / redo losslessly)", () => {
  const ev: Stamp = {
    id: "ev",
    name: "Ev",
    width: 2,
    height: 1,
    palette: [
      { tilesetId: "dungeon", tileId: 2 },
      { tilesetId: "dungeon", tileId: 3 },
    ],
    layers: [{ layerId: "a", name: "Zemin", cells: Uint32Array.of(makeCell(1), makeCell(2, FLIP_H)) }],
  };
  const kule: Stamp = { ...ev, id: "kule", name: "Kule" };

  it("restores stamps that were not edited since, remaps the others", () => {
    const records: StampRegrid[] = [];
    const fwd = syncStampGrid([ev, kule], "dungeon", dungeon, as32, records);
    expect(fwd.changed).toBe(2);
    records.push(fwd.record!);
    // Tile 3 had no place: the stamp lost it.
    expect(fwd.stamps[0]!.palette).toEqual([{ tilesetId: "dungeon", tileId: 1 }]);
    // Edit "kule" and add a new stamp after the edit.
    const edited: Stamp = { ...fwd.stamps[1]!, name: "Kule 2" };
    const added: Stamp = { ...fwd.stamps[0]!, id: "yeni", name: "Yeni" };
    const back = syncStampGrid([fwd.stamps[0]!, edited, added], "dungeon", as32, dungeon, records);
    expect(back.kept).toBe(1);
    // "ev" is exactly what it was (the cleared tile is back).
    expect(back.stamps[0]).toBe(ev);
    expect(stampKey(back.stamps[0]!)).toBe(stampKey(ev));
    // Edited and new stamps were remapped by pixel position (32 px tile 1 → 16 px tile 2).
    expect(back.stamps[1]!.name).toBe("Kule 2");
    expect(back.stamps[1]!.palette).toEqual([{ tilesetId: "dungeon", tileId: 2 }]);
    expect(back.stamps[2]!.palette).toEqual([{ tilesetId: "dungeon", tileId: 2 }]);
    records.push(back.record!);
    // Redo: everything the undo changed and nobody touched comes back exactly.
    const redo = syncStampGrid(back.stamps, "dungeon", dungeon, as32, records);
    expect(redo.kept).toBe(0);
    expect(redo.stamps[0]).toBe(fwd.stamps[0]);
    expect(redo.stamps[1]).toBe(edited);
    expect(redo.stamps[2]).toBe(added);
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

describe("palette refs follow tileset grid edits and removal", () => {
  const palette = {
    id: "p",
    name: "Palet",
    columns: 4,
    cells: [
      { x: 0, y: 0, tilesetId: "dungeon", tileId: 2 }, // 16 px (2,0) → 32 px (1,0) = id 1
      { x: 1, y: 0, tilesetId: "dungeon", tileId: 1 }, // (16,0): not on the 32 px grid → dropped
      { x: 3, y: 1, tilesetId: "dungeon", tileId: 14, flags: FLIP_H }, // (2,2) px (32,32) → (1,1) = id 4
    ],
  };

  it("the grid op remaps the level's palettes (one undo step) and undo restores them", () => {
    const store = levelStore();
    store.dispatch({ type: "setCollection", collection: palette });
    store.clearHistory();
    store.dispatch(to32);
    expect(store.document.getCollection("p")!.cells).toEqual([
      { x: 0, y: 0, tilesetId: "dungeon", tileId: 1 },
      { x: 3, y: 1, tilesetId: "dungeon", tileId: 4, flags: FLIP_H },
    ]);
    store.undo();
    expect(store.document.getCollection("p")!.cells).toEqual(palette.cells);
  });

  it("removing the tileset drops its tiles from palettes; the palette stays", () => {
    const store = levelStore();
    store.dispatch({ type: "setCollection", collection: palette });
    store.dispatch({ type: "removeTileset", tilesetId: "dungeon" });
    expect(store.document.getCollection("p")!.cells).toEqual([]);
    store.undo();
    expect(store.document.getCollection("p")!.cells).toHaveLength(3);
  });

  it("copied tiles (palette clipboard) follow with the same pixel rule", () => {
    const refs = [
      { dx: 0, dy: 0, tilesetId: "dungeon", tileId: 2 },
      { dx: 1, dy: 0, tilesetId: "dungeon", tileId: 1 },
      { dx: 0, dy: 1, tilesetId: "other", tileId: 1 },
    ];
    expect(remapTileRefs(refs, "dungeon", dungeon, as32)).toEqual([
      { dx: 0, dy: 0, tilesetId: "dungeon", tileId: 1 },
      { dx: 0, dy: 1, tilesetId: "other", tileId: 1 },
    ]);
    expect(remapTileRefs(refs, "dungeon", dungeon, dungeon)).toBe(refs);
    expect(dropTileRefs(refs, (id) => id !== "dungeon")).toEqual([refs[2]]);
    expect(dropTileRefs(refs, () => true)).toBe(refs);
  });
});
