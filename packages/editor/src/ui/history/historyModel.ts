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
import type { HistoryChange, MapStore } from "@smap/core";

import type { StrokeSummary } from "../../canvas/canvasEvents";
import { formatNumber, t, type MessageKey } from "../../i18n";

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
 * A transaction label wins, then the stroke verb, captured structural verb,
 * and finally the existing kind label for steps captured before binding.
 */
export function itemLabel(item: HistoryItem, summary: StrokeSummary | null, verb: MessageKey | null = null): string {
  if (item.label) return item.label;
  if (summary) {
    const tools = { brush: "history.paint", eraser: "history.erase", fill: "history.fill", rect: "history.rectangle", stamp: "history.stamp" } as const;
    return t("history.stroke", { tool: t(tools[summary.tool]), count: formatNumber(summary.cells) });
  }
  if (verb) return t(verb);
  const key = KIND_LABEL[item.kind];
  if (key) return t(key);
  if (item.cellCount) return t("feedback.cells", { count: formatNumber(item.cellCount) });
  return t("history.change");
}

/** Structural verbs from public, reversible changes; no document mutation. */
export function verbForChanges(changes: readonly HistoryChange[]): MessageKey | null {
  const layers = changes.filter(c => c.kind === "layer");
  if (layers.length) {
    if (layers.every(c => c.before === null)) return "history.layerAdd";
    if (layers.every(c => c.after === null)) return "history.layerRemove";
    if (layers.every(c => c.before !== null && c.after !== null)) return "history.layerMove";
  }
  for (const c of changes) {
    if (c.kind === "layerProps") {
      if (c.before.name !== c.after.name) return "history.layerRename";
      if (c.before.visible !== c.after.visible) return c.after.visible ? "history.layerShow" : "history.layerHide";
      if (c.before.locked !== c.after.locked) return c.after.locked ? "history.layerLock" : "history.layerUnlock";
      if (c.before.opacity !== c.after.opacity) return "history.opacity";
    }
    if (c.kind === "map") return "history.mapResize";
    if (c.kind === "mapProps") return "history.mapProps";
    if (c.kind === "entities") {
      if (c.after.some(e => !c.before.some(b => b.id === e.id))) return "history.entityAdd";
      if (c.before.some(e => !c.after.some(a => a.id === e.id))) return "history.entityRemove";
      if (c.after.some(e => { const b = c.before.find(b => b.id === e.id); return b && (b.x !== e.x || b.y !== e.y); })) return "history.entityMove";
      return "history.entityField";
    }
    if (c.kind === "entityTypes") return "history.entityTypesEdit";
    if (c.kind === "tileset" || c.kind === "tilesetList" || c.kind === "palette") return "history.tilesetEdit";
    if (c.kind === "randomSets") return "history.randomSets";
    if (c.kind === "collections") return "history.collections";
  }
  return null;
}

/** The rows for `items` (core order: done oldest → newest, then undone next → last). */
export function historyRows(items: readonly HistoryItem[], summaryOf: (id: number) => StrokeSummary | null, verbOf: (id: number) => MessageKey | null = () => null): HistoryRow[] {
  const doneCount = items.filter((i) => i.state === "done").length;
  const rows: HistoryRow[] = [
    { id: null, label: t("history.initial"), tool: null, kind: "initial", state: doneCount === 0 ? "current" : "done" },
  ];
  items.forEach((item, i) => {
    const summary = summaryOf(item.id);
    rows.push({
      id: item.id,
      label: itemLabel(item, summary, verbOf(item.id)),
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
