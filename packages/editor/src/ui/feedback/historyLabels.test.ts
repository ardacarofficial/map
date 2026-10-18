import { createDocument, MapStore } from "@smap/core";
import { describe, expect, it } from "vitest";

import { BURST_MS, HistoryLabels, historyMessage, nextBurst } from "./historyLabels";

/** Drives a real store and feeds its events to the label stack, like UndoHud does. */
function harness(historyLimit?: number) {
  const store = new MapStore(createDocument({ width: 8, height: 8 }), historyLimit === undefined ? {} : { historyLimit });
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "L" } });
  store.dispatch({
    type: "addTileset",
    tileset: { id: "t", name: "T", imagePath: "t.png", tileWidth: 32, tileHeight: 32, columns: 4, rows: 4, margin: 0, spacing: 0 },
  });
  const cell = store.getOrAddPaletteIndex("t", 0);
  store.clearHistory();
  const labels = new HistoryLabels();
  labels.reset();
  const feedback: (ReturnType<HistoryLabels["change"]>)[] = [];
  store.subscribe((e) => {
    if (!e.historyChanged) return;
    const f = labels.change(e.cause, store);
    if (f) feedback.push(f);
  });
  let n = 0;
  const paint = (cells: number, tool: "brush" | "fill" | "eraser" = "brush") => {
    store.beginTransaction();
    const writes = Array.from({ length: cells }, (_, i) => ({ x: i % 8, y: n % 8, cell }));
    n++;
    store.dispatch({ type: "paintCells", layerId, cells: writes });
    store.commit();
    labels.stroke({ tool, cells }, store);
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
    const id = store.peekUndo()!.id;
    expect(labels.labelOf(id)).toEqual({ tool: "brush", cells: 4 });
    store.clearHistory();
    expect(store.peekUndo()).toBeUndefined();
    paint(2, "eraser");
    store.undo();
    expect(feedback.at(-1)).toEqual({ move: "undo", summary: { tool: "eraser", cells: 2 } });
  });
});

describe("HistoryLabels at the history limit", () => {
  it("names the right step when the oldest ones fall off (the depth stays the same)", () => {
    const { store, feedback, paint } = harness(3);
    paint(1);
    paint(2, "fill");
    paint(3, "eraser");
    paint(4); // drops the first step; depth stays 3
    paint(5, "fill"); // and the second
    expect(store.undoDepth).toBe(3);
    store.undo();
    store.undo();
    store.undo();
    expect(store.canUndo).toBe(false);
    store.redo();
    expect(feedback).toEqual([
      { move: "undo", summary: { tool: "fill", cells: 5 } },
      { move: "undo", summary: { tool: "brush", cells: 4 } },
      { move: "undo", summary: { tool: "eraser", cells: 3 } },
      { move: "redo", summary: { tool: "eraser", cells: 3 } },
    ]);
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

describe("structural step labels", () => {
  it("names layer, props, resize and pasted-cell steps for the undo HUD", async () => {
    const { describeEntry } = await import("./historyLabels");
    const store = new MapStore(createDocument({ width: 8, height: 8 }));
    const a = store.dispatch({ type: "addLayer", layer: { name: "A" } });
    expect(describeEntry(store.peekUndo())).toBe("Katman eklendi");
    store.dispatch({ type: "addLayer", layer: { name: "B" } });
    store.dispatch({ type: "moveLayer", layerId: a, index: 1 });
    expect(describeEntry(store.peekUndo())).toBe("Katman taşındı");
    store.dispatch({ type: "setLayerProps", layerId: a, props: { visible: false } });
    expect(describeEntry(store.peekUndo())).toBe("Katman gizlendi");
    store.dispatch({ type: "setLayerProps", layerId: a, props: { name: "Z" } });
    expect(describeEntry(store.peekUndo())).toBe("Katman adı");
    store.dispatch({ type: "removeLayer", layerId: a });
    expect(describeEntry(store.peekUndo())).toBe("Katman silindi");
    // Undo puts the step on the redo side; the HUD reads it there.
    store.undo();
    expect(historyMessage("undo", null, 1, describeEntry(store.peekRedo()))).toBe("Geri alındı: Katman silindi");
    expect(historyMessage("undo", null, 1, null)).toBe("Geri alındı");
    expect(describeEntry(undefined)).toBeNull();
  });
});

describe("specific tileset metadata history", () => {
  it("distinguishes renaming, grouping, grid and list edits", async () => {
    const { tilesetHistoryVerb } = await import("./historyLabels");
    const { store } = harness();
    const before = store.document.getTileset("t")!;
    for (const [patch, label] of [
      [{ name: "Renamed" }, "history.tilesetRename"],
      [{ group: "World" }, "history.tilesetGroup"],
      [{ spacing: 1 }, "history.tilesetGrid"],
      [{ imagePath: "other.png" }, "history.tilesetImage"],
    ] as const) {
      expect(tilesetHistoryVerb([{ kind: "tileset", tilesetId: "t", before, after: { ...before, ...patch } }])).toBe(label);
    }
    expect(tilesetHistoryVerb([{ kind: "tilesetList", before: [], after: [before] }])).toBe("history.tilesetAdd");
    expect(tilesetHistoryVerb([{ kind: "tilesetList", before: [before], after: [] }])).toBe("history.tilesetRemove");
  });
});
