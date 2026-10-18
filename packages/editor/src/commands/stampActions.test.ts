import { createDocument, createStamp, makeCell, MapStore, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { stampEditStore, stampFromDocument } from "../ui/stampEditor/stampDoc";
import { replaceStampContent, setStampMeta, stampLayerIds, toggleStampFavorite, usedStampLayerIds } from "./stampActions";

const ts: Tileset = {
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

describe("stamp layers", () => {
  it("keeps only the layers that have something in the region", () => {
    const store = new MapStore(createDocument({ width: 10, height: 10, tileWidth: 16, tileHeight: 16 }));
    store.dispatch({ type: "addTileset", tileset: ts });
    const ground = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
    const roof = store.dispatch({ type: "addLayer", layer: { name: "Çatı" } });
    const coll = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "addLayer", layer: { name: "Entity", type: "entity" } });
    const a = store.getOrAddPaletteIndex("grass", 5);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 2, y: 2, cell: makeCell(a) }] });
    store.dispatch({ type: "paintCells", layerId: roof, cells: [{ x: 8, y: 8, cell: makeCell(a) }] });
    store.dispatch({ type: "paintGrid", layerId: coll, cells: [{ x: 3, y: 3, value: 1 }] });
    const doc = store.document;
    expect(stampLayerIds(doc)).toEqual([ground, roof, coll]); // every layer but the entity layer
    // The roof tile is outside the region: only Zemin and Collision are saved.
    expect(usedStampLayerIds(doc, { x: 2, y: 2, width: 2, height: 2 })).toEqual([ground, coll]);
    expect(usedStampLayerIds(doc, { x: 5, y: 5, width: 2, height: 2 })).toEqual([]);
  });
});

describe("stamp library metadata and editor save", () => {
  function libraryWithHouse() {
    const store = new MapStore(createDocument({ width: 10, height: 10, tileWidth: 16, tileHeight: 16 }));
    store.dispatch({ type: "addTileset", tileset: ts });
    const ground = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
    const a = store.getOrAddPaletteIndex("grass", 5);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 2, y: 2, cell: makeCell(a) }, { x: 3, y: 2, cell: makeCell(a) }] });
    const house = createStamp(store.document, [ground], { x: 2, y: 2, width: 2, height: 1 }, { id: "ev", name: "Ev" });
    useProjectLibrary.getState().load({ stamps: [house], levels: [] });
    useEditorStore.getState().setProject({ name: "x", store, levelPath: "levels/main.json" });
    return { store, ground, house };
  }

  it("sets category, tags and ★ (normalized), and ignores unchanged or invalid metadata", () => {
    libraryWithHouse();
    const rev = useProjectLibrary.getState().revision;
    const next = setStampMeta("ev", { category: "  Binalar ", tags: ["köy", " köy", ""] })!;
    expect([next.category, next.tags]).toEqual(["Binalar", ["köy"]]);
    expect(useProjectLibrary.getState().revision).toBe(rev + 1); // saved with the project
    expect(setStampMeta("ev", { category: "Binalar" })).toBeNull();
    expect(setStampMeta("ev", { category: "x".repeat(65) })).toBeNull();
    toggleStampFavorite("ev");
    expect(useProjectLibrary.getState().stamps[0]!.favorite).toBe(true);
    toggleStampFavorite("ev");
    expect(useProjectLibrary.getState().stamps[0]!.favorite).toBeUndefined();
  });

  it("replaces a stamp's cells but keeps id, name and metadata; the brush picks up the new version", () => {
    const { store, house } = libraryWithHouse();
    setStampMeta("ev", { category: "Binalar", favorite: true });
    useEditorStore.getState().setStamp(useProjectLibrary.getState().stamps[0]!);
    const editing = stampEditStore(useProjectLibrary.getState().stamps[0]!, store.document);
    const idx = editing.getOrAddPaletteIndex("grass", 1);
    editing.dispatch({ type: "paintCells", layerId: editing.document.layers[0]!.id, cells: [{ x: 3, y: 3, cell: makeCell(idx) }] });
    const content = stampFromDocument(editing.document, { id: "other", name: "Other" })!;
    const saved = replaceStampContent("ev", content)!;
    expect([saved.id, saved.name, saved.category, saved.favorite]).toEqual(["ev", "Ev", "Binalar", true]);
    expect(saved.height).toBeGreaterThan(house.height);
    expect(useProjectLibrary.getState().stamps).toEqual([saved]);
    expect(useEditorStore.getState().stamp).toBe(saved);
    expect(replaceStampContent("missing", content)).toBeNull();
  });

  it.each([false, true])("keeps the saved smart-off preference when editor artwork changes: %s", changed => {
    const { store, house } = libraryWithHouse();
    const stamp = { ...house, smartDisabled: true };
    useProjectLibrary.getState().addStamp(stamp);
    useEditorStore.getState().setStamp(stamp);
    const editing = stampEditStore(stamp, store.document);
    if (changed) editing.dispatch({ type: "paintCells", layerId: editing.document.layers[0]!.id, cells: [{ x: 3, y: 3, cell: makeCell(editing.getOrAddPaletteIndex("grass", 1)) }] });
    const content = stampFromDocument(editing.document, { id: house.id, name: house.name })!;
    expect(content.smartDisabled).toBeUndefined();
    expect(replaceStampContent(stamp.id, content)?.smartDisabled).toBe(true);
    expect(useEditorStore.getState().stamp).toHaveProperty("smartDisabled", true);
  });
});
