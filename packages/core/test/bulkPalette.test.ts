import { describe, expect, it } from "vitest";
import { createDocument, makeCell, MapStore, serializeLevel } from "../src";

function setup() {
  const store = new MapStore(createDocument({
    width: 64, height: 64,
    tilesets: [{ id: "tiles", name: "Tiles", tileWidth: 1, tileHeight: 1, columns: 8192, rows: 1, margin: 0, spacing: 0, imagePath: "tiles.png" }],
  }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  store.clearHistory();
  return { store, layerId };
}
const refs = (count: number, start = 0) => Array.from({ length: count }, (_, i) => ({ tilesetId: "tiles", tileId: start + i }));

describe("bulk reversible palette allocation", () => {
  it("deduplicates in first-use order, including existing references, and owns immutable entries", () => {
    const { store } = setup();
    store.getOrAddPaletteIndex("tiles", 7);
    const entries = [7, 4, 2, 4, 7, 2].map(tileId => ({ tilesetId: "tiles", tileId }));
    expect(store.dispatch({ type: "addPaletteEntries", entries })).toEqual([1, 2, 3, 2, 1, 3]);
    entries[1]!.tileId = 99;
    expect(store.document.palette.entries()).toEqual(refs(1, 7).concat(refs(1, 4), refs(1, 2)));
    const revision = store.revision, entry = store.peekUndo();
    expect(store.dispatch({ type: "addPaletteEntries", entries: refs(1, 2) })).toEqual([3]);
    expect(store.dispatch({ type: "addPaletteEntries", entries: [] })).toEqual([]);
    expect(store.revision).toBe(revision);
    expect(store.peekUndo()).toBe(entry);
  });

  it.each([
    { tilesetId: "missing", tileId: 0 },
    { tilesetId: "tiles", tileId: 8192 },
    { tilesetId: "tiles", tileId: -1 },
    { tilesetId: "tiles", tileId: 0.5 },
  ])("rejects a late invalid reference atomically: %j", invalid => {
    const { store } = setup();
    store.getOrAddPaletteIndex("tiles", 3);
    const before = serializeLevel(store.document), revision = store.revision;
    expect(() => store.dispatch({ type: "addPaletteEntries", entries: [...refs(100), invalid] })).toThrow();
    expect(serializeLevel(store.document)).toBe(before);
    expect(store.revision).toBe(revision);
    expect(store.canUndo).toBe(false);
  });

  it.each([1024, 2048, 4096])("retains exactly two arrays with 2p+n pointer slots for %i new references", count => {
    const { store } = setup();
    for (const ref of refs(128)) store.getOrAddPaletteIndex(ref.tilesetId, ref.tileId);
    store.dispatch({ type: "addPaletteEntries", entries: refs(count, 128) });
    const changes = store.peekUndo()!.changes;
    expect(changes).toHaveLength(1);
    const change = changes[0]!;
    expect(change.kind).toBe("paletteAppend");
    if (change.kind !== "paletteAppend") throw new Error("Missing palette snapshot");
    expect(change.before).toHaveLength(128);
    expect(change.after).toHaveLength(128 + count);
    expect((change.before.length + change.after.length) * 8).toBe((256 + count) * 8);
    expect(change.before[0]).toBe(change.after[0]);
    expect(Object.isFrozen(change.before)).toBe(true);
    expect(Object.isFrozen(change.after)).toBe(true);
  });

  it("restores palette and cells byte-exactly on undo/redo and rollback", () => {
    const { store, layerId } = setup(), before = serializeLevel(store.document);
    const paint = () => {
      const indices = store.dispatch({ type: "addPaletteEntries", entries: refs(4096) });
      store.dispatch({ type: "paintCells", layerId, cells: indices.map((index, i) => ({ x: i % 64, y: Math.floor(i / 64), cell: makeCell(index) })) });
    };
    store.beginTransaction();
    paint();
    store.commit();
    const after = serializeLevel(store.document);
    expect(store.undoDepth).toBe(1);
    expect(store.undo()).toBe(true);
    expect(serializeLevel(store.document)).toBe(before);
    expect(store.redo()).toBe(true);
    expect(serializeLevel(store.document)).toBe(after);
    store.undo();
    store.beginTransaction();
    paint();
    store.rollback();
    expect(serializeLevel(store.document)).toBe(before);
    expect(store.redo()).toBe(true);
    expect(serializeLevel(store.document)).toBe(after);
  });
});
