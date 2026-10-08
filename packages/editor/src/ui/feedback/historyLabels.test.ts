import { createDocument, MapStore } from "@smap/core";
import { describe, expect, it } from "vitest";

import { BURST_MS, HistoryLabels, historyMessage, nextBurst } from "./historyLabels";

/** Drives a real store and feeds its events to the label stack, like UndoHud does. */
function harness() {
  const store = new MapStore(createDocument({ width: 8, height: 8 }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "L" } });
  store.dispatch({
    type: "addTileset",
    tileset: { id: "t", name: "T", imagePath: "t.png", tileWidth: 32, tileHeight: 32, columns: 4, rows: 4, margin: 0, spacing: 0 },
  });
  const cell = store.getOrAddPaletteIndex("t", 0);
  store.clearHistory();
  const labels = new HistoryLabels();
  labels.reset(store.undoDepth, store.redoDepth);
  const feedback: (ReturnType<HistoryLabels["change"]>)[] = [];
  store.subscribe((e) => {
    if (!e.historyChanged) return;
    const f = labels.change(e.cause, store.undoDepth, store.redoDepth);
    if (f) feedback.push(f);
  });
  let n = 0;
  const paint = (cells: number, tool: "brush" | "fill" | "eraser" = "brush") => {
    store.beginTransaction();
    const writes = Array.from({ length: cells }, (_, i) => ({ x: i % 8, y: n % 8, cell }));
    n++;
    store.dispatch({ type: "paintCells", layerId, cells: writes });
    store.commit();
    labels.stroke({ tool, cells }, store.undoDepth);
  };
  return { store, labels, feedback, paint, layerId };
}

describe("HistoryLabels", () => {
  it("labels undo / redo by the stroke that made the step", () => {
    const { store, feedback, paint } = harness();
    paint(12);
    paint(3, "fill");
    store.undo();
    store.undo();
    store.redo();
    expect(feedback).toEqual([
      { move: "undo", summary: { tool: "fill", cells: 3 } },
      { move: "undo", summary: { tool: "brush", cells: 12 } },
      { move: "redo", summary: { tool: "brush", cells: 12 } },
    ]);
  });

  it("a new edit drops the redo branch; unlabelled steps fall back", () => {
    const { store, feedback, paint, layerId } = harness();
    paint(5);
    store.undo();
    store.dispatch({ type: "setLayerProps", layerId, props: { visible: false } }); // not a stroke
    store.undo();
    expect(feedback.at(-1)).toEqual({ move: "undo", summary: null });
    store.redo();
    expect(feedback.at(-1)).toEqual({ move: "redo", summary: null });
  });

  it("clearing the history forgets the labels", () => {
    const { store, feedback, paint, labels } = harness();
    paint(4);
    store.clearHistory();
    expect(labels.labelAt(0)).toBeNull();
    paint(2, "eraser");
    store.undo();
    expect(feedback.at(-1)).toEqual({ move: "undo", summary: { tool: "eraser", cells: 2 } });
  });
});

describe("messages", () => {
  it("formats stroke, bare and burst messages", () => {
    expect(historyMessage("undo", { tool: "brush", cells: 12 })).toBe("Geri alındı: Kalem (12 hücre)");
    expect(historyMessage("redo", { tool: "stamp", cells: 1 })).toBe("Yinelendi: Stamp (1 hücre)");
    expect(historyMessage("undo", null)).toBe("Geri alındı");
    expect(historyMessage("undo", { tool: "fill", cells: 3 }, 5)).toBe("Geri alındı: 5 adım");
  });

  it("counts held Ctrl+Z as one burst", () => {
    let b = nextBurst(null, "undo", 0);
    b = nextBurst(b, "undo", 100);
    b = nextBurst(b, "undo", 200);
    expect(b.count).toBe(3);
    expect(nextBurst(b, "redo", 250).count).toBe(1);
    expect(nextBurst(b, "undo", 200 + BURST_MS).count).toBe(1);
  });
});
