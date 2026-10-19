/**
 * Per-store {@link HistoryLabels}, shared by the undo HUD
 * (`UndoHud`) and the Geçmiş tab (`ui/history/HistoryPanel`): the canvas
 * names its strokes once ("Kalem · 12 hücre") and both read the names.
 * `UndoHud` feeds the canvas' stroke summaries; anyone may bind the store.
 */
import type { MapStore } from "@smap/core";

import type { StrokeSummary } from "../../canvas/canvasEvents";
import { useEditorStore } from "../../state/editorStore";
import { useTilesetView } from "../tileset/tilesetViewStore";
import { HistoryLabels } from "./historyLabels";

const byStore = new WeakMap<MapStore, HistoryLabels>();
export let sharedHistoryLabels = new HistoryLabels();

export function historyLabelsFor(store: MapStore): HistoryLabels {
  let labels = byStore.get(store);
  if (!labels) { labels = new HistoryLabels(); byStore.set(store, labels); }
  return labels;
}

let boundStore: MapStore | undefined;
let version = 0;
let tilesetStroke = false;

/** Snapshot the brush source before a canvas press starts its transaction. */
export function captureHistoryBrushSource(): void {
  const clip = useEditorStore.getState().stamp;
  tilesetStroke = clip !== null && useTilesetView.getState().selection?.clip === clip;
}

const listeners = new Set<() => void>();

function bump(): void {
  version++;
  for (const l of [...listeners]) l();
}

/** Bind the active store; switching maps preserves each store's labels for world history. */
export function bindHistoryLabels(store: MapStore | undefined): void {
  if (store === boundStore) return;
  boundStore = store;
  sharedHistoryLabels = store ? historyLabelsFor(store) : new HistoryLabels();
  tilesetStroke = false;
  bump();
}

/** The canvas finished an edit: it names the step on top of the bound store's undo stack. */
export function recordStrokeLabel(summary: StrokeSummary): void {
  if (!boundStore) return;
  sharedHistoryLabels.stroke(summary.tool === "stamp" && tilesetStroke ? { ...summary, tool: "brush" } : summary, boundStore);
  bump();
}

export function subscribeHistoryLabels(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function historyLabelsVersion(): number {
  return version;
}
