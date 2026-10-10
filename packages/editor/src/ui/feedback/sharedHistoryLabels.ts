/**
 * One {@link HistoryLabels} for the open document, shared by the undo pill
 * (`UndoHud`) and the Geçmiş tab (`ui/history/HistoryPanel`): the canvas
 * names its strokes once ("Kalem · 12 hücre") and both read the names.
 * `UndoHud` feeds the canvas' stroke summaries; anyone may bind the store.
 */
import type { MapStore } from "@smap/core";

import type { StrokeSummary } from "../../canvas/canvasEvents";
import { HistoryLabels } from "./historyLabels";

export const sharedHistoryLabels = new HistoryLabels();

let boundStore: MapStore | undefined;
let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version++;
  for (const l of [...listeners]) l();
}

/** The labels now belong to `store`'s history (a new store = a new history: labels are forgotten). */
export function bindHistoryLabels(store: MapStore | undefined): void {
  if (store === boundStore) return;
  boundStore = store;
  sharedHistoryLabels.reset();
  bump();
}

/** The canvas finished an edit: it names the step on top of the bound store's undo stack. */
export function recordStrokeLabel(summary: StrokeSummary): void {
  if (!boundStore) return;
  sharedHistoryLabels.stroke(summary, boundStore);
  bump();
}

export function subscribeHistoryLabels(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function historyLabelsVersion(): number {
  return version;
}
