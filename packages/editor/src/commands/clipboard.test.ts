import { createDocument, FLIP_H, FLIP_V, makeCell, MapStore, serializeClip, type Tileset } from "@smap/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../state/editorStore";
import { clipFromText, deleteSelection, flipStampOrTile, pasteText } from "./clipboard";

const tiles: Tileset = {
  id: "t",
  name: "T",
  imagePath: "tilesets/t.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 4,
  rows: 4,
  margin: 0,
  spacing: 0,
};

let store: MapStore;
let layerId: string;

beforeEach(() => {
  store = new MapStore(createDocument({ width: 8, height: 6 }));
  store.dispatch({ type: "addTileset", tileset: tiles });
  layerId = store.dispatch({ type: "addLayer", layer: { name: "A" } });
  const p = store.getOrAddPaletteIndex("t", 3);
  const cells = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) cells.push({ x, y, cell: makeCell(p) });
  store.dispatch({ type: "paintCells", layerId, cells });
  store.clearHistory();
  useEditorStore.getState().setProject({ name: "x", store, levelPath: "levels/main.json" });
});

describe("clipboard commands", () => {
  it("delete clears the region as one undo step", () => {
    useEditorStore.getState().setRegion({ x: 1, y: 1, width: 3, height: 2 });
    expect(deleteSelection()).toBe(true);
    const layer = store.document.getLayer(layerId)!;
    expect(layer.getCell(1, 1)).toBe(0);
    expect(layer.getCell(3, 2)).toBe(0);
    expect(layer.getCell(4, 1)).not.toBe(0);
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(layer.getCell(1, 1)).not.toBe(0);
  });

  it("flip turns the selected tile into a flipped 1×1 stamp, then flips the stamp", () => {
    useEditorStore.getState().setSelection({ tilesetId: "t", tileId: 5 });
    expect(flipStampOrTile("x")).toBe(true);
    const stamp = useEditorStore.getState().stamp!;
    expect(stamp.palette).toEqual([{ tilesetId: "t", tileId: 5 }]);
    expect(stamp.layers[0]?.layerId).toBe(layerId);
    expect(stamp.layers[0]!.cells[0]).toBe(makeCell(1, FLIP_H));
    flipStampOrTile("y");
    expect(useEditorStore.getState().stamp!.layers[0]!.cells[0]).toBe(makeCell(1, FLIP_H | FLIP_V));
  });

  it("paste reads a serialized clip and starts placing it with the brush", () => {
    const clip = {
      width: 1,
      height: 1,
      palette: [{ tilesetId: "t", tileId: 1 }],
      layers: [{ layerId, name: "A", cells: Uint32Array.of(makeCell(1)) }],
    };
    const text = serializeClip(clip);
    expect(clipFromText(text)?.width).toBe(1);
    expect(clipFromText("hello")).toBeNull();
    useEditorStore.getState().setTool("select");
    useEditorStore.getState().setRegion({ x: 0, y: 0, width: 1, height: 1 });
    expect(pasteText(text)).toBe(true);
    const state = useEditorStore.getState();
    expect(state.tool).toBe("brush");
    expect(state.region).toBeNull();
    expect(state.stamp?.palette).toEqual([{ tilesetId: "t", tileId: 1 }]);
  });

  it("refuses clips that reference tiles this project does not have", () => {
    const text = serializeClip({
      width: 1,
      height: 1,
      palette: [{ tilesetId: "nope", tileId: 1 }],
      layers: [{ layerId, name: "A", cells: Uint32Array.of(makeCell(1)) }],
    });
    expect(pasteText(text)).toBe(false);
    expect(useEditorStore.getState().stamp).toBeNull();
  });
});
