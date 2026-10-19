import { createHash } from "node:crypto";
import { createDocument, FLIP_H, MapStore, parseProject, serializeProject, type Tileset } from "@smap/core";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { useUiStore } from "../ui/uiStore";
import { copyPaletteSlots, copyTilesetTiles, pasteIntoPalette, setPaletteRowCount } from "../ui/palettes/paletteActions";
import { usePaletteStore } from "../ui/palettes/paletteStore";
import { useTilesetView } from "../ui/tileset/tilesetViewStore";
import { copyReferences } from "./tilesetEditing";
import { renameTileset } from "./tilesetActions";

const ts: Tileset = { id: "t", name: "Tiles", imagePath: "tilesets/Original.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 3, margin: 0, spacing: 0 };
let store: MapStore;
const snapshot = () => serializeProject({ name: "test", levels: [{ name: "Map", path: "levels/main.json" }], tilesets: store.document.tilesets, collections: store.document.collections });
beforeEach(() => {
  store = new MapStore(createDocument({ width: 8, height: 8 }));
  store.dispatch({ type: "addTileset", tileset: ts });
  store.dispatch({ type: "setCollection", collection: { id: "p", name: "P", columns: 4, rows: 2, cells: [] } });
  store.clearHistory();
  useEditorStore.getState().setProject({ name: "test", store, levelPath: "levels/main.json" });
  useUiStore.getState().setActiveTileset("t");
  usePaletteStore.setState({ activePaletteId: null, selection: null, clipboard: null });
  useTilesetView.setState({ view: "single", selection: null });
});
describe("reference editing actions", () => {
  it("copies a PNG rectangle into a palette, with its transparent border shape", () => {
    expect(copyTilesetTiles(ts, [0, 1, 2, 4, 5, 6], new Set([0, 2, 4, 5, 6]))).toBe(true);
    expect(pasteIntoPalette("p", { col: 0, row: 2 })).toBe(true);
    expect(store.document.getCollection("p")).toMatchObject({ rows: 4, cells: [{ x: 1, y: 2, tilesetId: "t", tileId: 1 }] });
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(store.document.getCollection("p")?.cells).toEqual([]);
  });
  it("PNG cut clears the transient selection and keeps its encoded byte hash identical", () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const hash = () => createHash("sha256").update(getTilesetImage("t")!.bytes!).digest("hex");
    setTilesetImage({ tilesetId: "t", bitmap: { width: 0, height: 0, close() {} } as ImageBitmap, bytes });
    const before = hash();
    useTilesetView.getState().setSelection({ tilesetId: "t", ids: [1, 2], referenceIds: [0, 1, 2], anchor: { col: 0, row: 0 }, focus: { col: 2, row: 0 }, clip: null });
    expect(copyReferences(true)).toBe(true);
    expect(useTilesetView.getState().selection).toBeNull();
    expect(hash()).toBe(before);
    expect(store.document.getTileset("t")).toEqual(ts);
    expect(store.undoDepth).toBe(0);
    expect(pasteIntoPalette("p", null)).toBe(true);
  });
  it("palette cut is one undo step and restores flipped slots", () => {
    store.dispatch({ type: "setCollection", collection: { id: "p", name: "P", columns: 4, rows: 2, cells: [{ x: 1, y: 1, tilesetId: "t", tileId: 2, flags: FLIP_H }] } });
    store.clearHistory();
    const before = snapshot();
    usePaletteStore.setState({ activePaletteId: "p", selection: { paletteId: "p", ids: [4, 5, 6], anchor: { col: 0, row: 1 }, focus: { col: 2, row: 1 }, clip: null } });
    expect(copyReferences(true)).toBe(true);
    expect(store.document.getCollection("p")?.cells).toEqual([]);
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(snapshot()).toBe(before);
    store.redo();
    expect(store.document.getCollection("p")?.cells).toEqual([]);
  });
  it("refuses shrink and overflow without adding history; grows and undoes", () => {
    copyTilesetTiles(ts, [0], new Set());
    pasteIntoPalette("p", { col: 0, row: 5 });
    store.clearHistory();
    expect(setPaletteRowCount("p", 1)).toBe(false);
    expect(store.undoDepth).toBe(0);
    expect(setPaletteRowCount("p", 8)).toBe(true);
    expect(store.document.getCollection("p")?.rows).toBe(8);
    store.undo();
    expect(store.document.getCollection("p")?.rows).toBe(6);
    expect(setPaletteRowCount("p", 1, true)).toBe(true);
    store.undo();
    expect(store.document.getCollection("p")?.cells).toHaveLength(1);
  });
  it("row edits and reference paste undo/redo round trip deterministically", () => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 254 }), fc.integer({ min: 0, max: 11 }), (rows, tileId) => {
      const before = snapshot();
      store.clearHistory();
      setPaletteRowCount("p", rows);
      copyTilesetTiles(ts, [tileId], new Set());
      pasteIntoPalette("p", { col: 0, row: rows });
      const after = snapshot(), count = store.undoDepth;
      for (let i = 0; i < count; i++) store.undo();
      expect(snapshot()).toBe(before);
      for (let i = 0; i < count; i++) store.redo();
      expect(snapshot()).toBe(after);
      for (let i = 0; i < count; i++) store.undo();
    }));
  });
  it("rename → undo → redo → reopen keeps ids, case-only display changes and source path", () => {
    renameTileset("t", "TILES");
    expect(store.document.getTileset("t")?.name).toBe("TILES");
    store.undo();
    expect(store.document.getTileset("t")?.name).toBe("Tiles");
    store.redo();
    const reopened = parseProject(snapshot());
    expect(reopened.tilesets[0]).toEqual({ ...ts, name: "TILES" });
  });
  it("copies an entirely empty palette rectangle and pastes its shape", () => {
    const empty = { id: "empty", name: "Empty", columns: 4, rows: 2, cells: [] };
    expect(copyPaletteSlots(empty, [0, 1, 4, 5])).toBe(true);
    expect(pasteIntoPalette("p", { col: 0, row: 2 })).toBe(true);
    expect(store.document.getCollection("p")).toMatchObject({ rows: 4, cells: [] });
  });
  it("palette copy retains cross-tileset flags and holes", () => {
    const p = { id: "x", name: "X", columns: 4, rows: 2, cells: [{ x: 1, y: 0, tilesetId: "t", tileId: 3, flags: FLIP_H }] };
    expect(copyPaletteSlots(p, [0, 1, 2, 4, 5, 6])).toBe(true);
    expect(pasteIntoPalette("p", { col: 0, row: 1 })).toBe(true);
    expect(store.document.getCollection("p")).toMatchObject({ rows: 3, cells: [{ x: 1, y: 1, tilesetId: "t", tileId: 3, flags: FLIP_H }] });
  });
});
