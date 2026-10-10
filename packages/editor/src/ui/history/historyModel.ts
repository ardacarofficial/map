/**
 * The Geçmiş (history) tab's list, from core `store.historyEntries()`.
 * Pure so the mapping and the click → undo / redo rule are testable.
 *
 * Rows, top to bottom: "Başlangıç" (the map as opened), then every step
 * oldest first. Steps on the undo stack are "done", the last of them is
 * "current" ("Şu an"); steps on the redo stack follow, "undone". No
 * branching: a new edit after undoing drops the undone rows (core clears
 * the redo stack).
 */
import type { MapStore } from "@smap/core";

import type { StrokeSummary } from "../../canvas/canvasEvents";
import { formatNumber, t, type MessageKey } from "../../i18n";
import { strokeToolLabel } from "../feedback/historyLabels";

/** One row of `store.historyEntries()`. */
export type HistoryItem = ReturnType<MapStore["historyEntries"]>[number];

export type RowState = "done" | "current" | "undone";

export interface HistoryRow {
  /** Step id; null for the "Başlangıç" row. */
  id: number | null;
  label: string;
  /** The canvas tool that made the step, when known (icon). */
  tool: StrokeSummary["tool"] | null;
  kind: HistoryItem["kind"] | "initial";
  state: RowState;
}

const KIND_LABEL: Partial<Record<HistoryItem["kind"], MessageKey>> = {
  layer: "feedback.layersChanged",
  layerProps: "feedback.layersChanged",
  map: "feedback.mapResized",
  mapProps: "history.mapProps",
  tileset: "feedback.tileset",
  tilesetList: "feedback.tileset",
  palette: "feedback.tileset",
  entities: "feedback.entities",
  entityTypes: "feedback.entityTypes",
  randomSets: "history.randomSets",
  collections: "history.collections",
};

/**
 * A step's label: the canvas' name for it ("Kalem · 12 hücre"), else the
 * transaction label core keeps, else what kind of change it was.
 */
export function itemLabel(item: HistoryItem, summary: StrokeSummary | null): string {
  if (summary) return t("history.stroke", { tool: strokeToolLabel(summary), count: formatNumber(summary.cells) });
  if (item.label) return item.label;
  const key = KIND_LABEL[item.kind];
  if (key) return t(key);
  if (item.cellCount) return t("feedback.cells", { count: formatNumber(item.cellCount) });
  return t("history.change");
}

/** The rows for `items` (core order: done oldest → newest, then undone next → last). */
export function historyRows(items: readonly HistoryItem[], summaryOf: (id: number) => StrokeSummary | null): HistoryRow[] {
  const doneCount = items.filter((i) => i.state === "done").length;
  const rows: HistoryRow[] = [
    { id: null, label: t("history.initial"), tool: null, kind: "initial", state: doneCount === 0 ? "current" : "done" },
  ];
  items.forEach((item, i) => {
    const summary = summaryOf(item.id);
    rows.push({
      id: item.id,
      label: itemLabel(item, summary),
      tool: summary?.tool ?? null,
      kind: item.kind,
      state: item.state === "undone" ? "undone" : i === doneCount - 1 ? "current" : "done",
    });
  });
  return rows;
}

/** What clicking a row does: core `undoTo(id)` / `redoTo(id)`, or nothing (already there). */
export type HistoryJump = { move: "undo" | "redo"; id: number } | null;

/**
 * Clicking row `index` makes it the current state:
 * - an earlier row: undo every step after it (`undoTo` the first one after it);
 * - a later (undone) row: redo up to and including it (`redoTo` it).
 */
export function jumpFor(rows: readonly HistoryRow[], index: number): HistoryJump {
  const current = rows.findIndex((r) => r.state === "current");
  if (index < 0 || index >= rows.length || index === current) return null;
  if (index < current) {
    const next = rows[index + 1];
    return next && next.id !== null ? { move: "undo", id: next.id } : null;
  }
  const row = rows[index]!;
  return row.id !== null ? { move: "redo", id: row.id } : null;
}

/** Runs a jump on the store. Returns the number of steps moved. */
export function applyJump(store: Pick<MapStore, "undoTo" | "redoTo">, jump: HistoryJump): number {
  if (!jump) return 0;
  return jump.move === "undo" ? store.undoTo(jump.id) : store.redoTo(jump.id);
}
