import { createDocument, MapStore, type TileClip } from "@smap/core";
import { afterEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../../state/editorStore";
import { useTilesetView } from "../tileset/tilesetViewStore";
import { itemLabel } from "../history/historyModel";
import { bindHistoryLabels, captureHistoryBrushSource, recordStrokeLabel, sharedHistoryLabels } from "./sharedHistoryLabels";

const clip: TileClip = { width: 2, height: 1, palette: [], layers: [] };

afterEach(() => {
  bindHistoryLabels(undefined);
  useEditorStore.getState().setProject(null);
  useTilesetView.getState().setSelection(null);
});

function setup(tileset: boolean) {
  const store = new MapStore(createDocument({ width: 8, height: 8 }));
  useEditorStore.getState().setProject({ name: "Test", levelPath: "test.json", store });
  useEditorStore.getState().setStamp(clip);
  useTilesetView.getState().setSelection(tileset ? {
    tilesetId: "t", ids: [0, 1], anchor: { col: 0, row: 0 }, focus: { col: 1, row: 0 }, clip,
  } : null);
  bindHistoryLabels(store);
  captureHistoryBrushSource();
  store.dispatch({ type: "addLayer", layer: { name: "Step" } });
  return store;
}

describe("stroke source history labels", () => {
  it("names a tileset-selection clip as paint and remembers its source at gesture start", () => {
    const store = setup(true);
    useEditorStore.getState().setStamp(null);
    useTilesetView.getState().setSelection(null);
    recordStrokeLabel({ tool: "stamp", cells: 24 });
    const summary = sharedHistoryLabels.labelOf(store.peekUndo()!.id);
    expect(summary).toEqual({ tool: "brush", cells: 24 });
    expect(itemLabel(store.historyEntries()[0]!, summary)).toBe("Boya 24 hücre");
    store.undo();
    expect(sharedHistoryLabels.change("undo", store)?.summary).toEqual(summary);
  });

  it("keeps library stamp and paste labels", () => {
    const store = setup(false);
    recordStrokeLabel({ tool: "stamp", cells: 24 });
    expect(sharedHistoryLabels.labelOf(store.peekUndo()!.id)).toEqual({ tool: "stamp", cells: 24 });
  });
});
