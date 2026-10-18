/**
 * Labels for undo / redo feedback ("Geri alındı: Kalem (12 hücre)"). Pure.
 *
 * Labels are keyed by the core history step's stable id
 * (`HistoryEntry.id`, read with `peekUndo()` / `peekRedo()`), not by undo
 * depth: at the history limit the depth stays put while the oldest step
 * falls off, so a depth would name the wrong step. The canvas'
 * `onStrokeCommitted` summary — reported right after the step's commit —
 * names the step on top. Steps the canvas did not report (layer changes,
 * terrain definitions...) are described from their changes
 * ({@link describeEntry}: "Geri alındı: Katman eklendi").
 */
import { patchCellCount, type ChangeCause, type HistoryChange, type HistoryEntry, type MapStore } from "@smap/core";

import type { StrokeSummary } from "../../canvas/canvasEvents";
import { formatNumber, t, type MessageKey } from "../../i18n";

export type HistoryMove = "undo" | "redo";

/** What an undo / redo just did: the step's label, if known. */
export interface HistoryFeedback {
  readonly move: HistoryMove;
  readonly summary: StrokeSummary | null;
}

/** The part of a store the labels read. */
export type HistoryTops = Pick<MapStore, "peekUndo" | "peekRedo">;

/** Labels kept at most (older ones are forgotten; ids never repeat, so a stale label is never shown). */
const MAX_LABELS = 2000;

export class HistoryLabels {
  readonly #labels = new Map<number, StrokeSummary>();

  /** Forget everything (another document / level). */
  reset(): void {
    this.#labels.clear();
  }

  /**
   * Feed every store change (cause + the store after it). Returns the
   * feedback for an undo / redo, else null.
   */
  change(cause: ChangeCause, history: HistoryTops): HistoryFeedback | null {
    if (cause === "undo") return { move: "undo", summary: this.#get(history.peekRedo()?.id) };
    if (cause === "redo") return { move: "redo", summary: this.#get(history.peekUndo()?.id) };
    return null;
  }

  /** The canvas finished an edit: it is the step on top of the undo stack. */
  stroke(summary: StrokeSummary, history: HistoryTops): void {
    const id = history.peekUndo()?.id;
    if (id === undefined) return;
    this.#labels.delete(id);
    this.#labels.set(id, summary);
    if (this.#labels.size > MAX_LABELS) this.#labels.delete(this.#labels.keys().next().value!);
  }

  /** @internal for tests: the label of a step id. */
  labelOf(id: number | undefined): StrokeSummary | null {
    return this.#get(id);
  }

  #get(id: number | undefined): StrokeSummary | null {
    return id === undefined ? null : (this.#labels.get(id) ?? null);
  }
}

/** Consecutive undos (or redos) closer than this become one "N adım" message. */
export const BURST_MS = 700;

export interface Burst {
  readonly move: HistoryMove;
  readonly count: number;
  readonly at: number;
}

/** Holding Ctrl+Z: counts repeats of the same move instead of flashing a new message each time. */
export function nextBurst(prev: Burst | null, move: HistoryMove, now: number): Burst {
  if (prev && prev.move === move && now - prev.at < BURST_MS) return { move, count: prev.count + 1, at: now };
  return { move, count: 1, at: now };
}

/** Localized name of the tool that made a step. */
export function strokeToolLabel(summary: StrokeSummary): string {
  return summary.tool === "stamp" ? t("feedback.stamp") : t(`tools.${summary.tool}`);
}

/** A localized verb, optionally carrying the terrain name from its change. */
export type HistoryVerb = MessageKey | { key: MessageKey; params: { name: string } };

export function renderHistoryVerb(verb: HistoryVerb): string {
  return typeof verb === "string" ? t(verb) : t(verb.key, verb.params);
}

/** Meaning of a tileset metadata edit from its reversible UI-visible diff. */
export function tilesetHistoryVerb(changes: readonly HistoryChange[]): HistoryVerb | null {
  for (const change of changes) {
    if (change.kind === "tilesetList") {
      if (change.after.length > change.before.length) return "history.tilesetAdd";
      if (change.after.length < change.before.length) return "history.tilesetRemove";
      return "history.tilesetReorder";
    }
    if (change.kind === "palette") continue;
    if (change.kind !== "tileset") continue;
    const { before, after } = change;
    if (before.name !== after.name) return "history.tilesetRename";
    if (before.group !== after.group) return "history.tilesetGroup";
    if (before.imagePath !== after.imagePath) return "history.tilesetImage";
    if (before.tileWidth !== after.tileWidth || before.tileHeight !== after.tileHeight || before.columns !== after.columns || before.rows !== after.rows || before.margin !== after.margin || before.spacing !== after.spacing) return "history.tilesetGrid";
    const oldSolid = new Set(before.solidTiles ?? []);
    const newSolid = new Set(after.solidTiles ?? []);
    const addedSolid = [...newSolid].some(id => !oldSolid.has(id));
    const removedSolid = [...oldSolid].some(id => !newSolid.has(id));
    if (addedSolid || removedSolid) return addedSolid && removedSolid ? "history.solidEdit" : addedSolid ? "history.solidMark" : "history.solidClear";
    const oldTerrains = (before.terrainSets ?? []).flatMap(set => set.terrains.map(terrain => ({ set: set.id, terrain })));
    const newTerrains = (after.terrainSets ?? []).flatMap(set => set.terrains.map(terrain => ({ set: set.id, terrain })));
    const added = newTerrains.find(next => !oldTerrains.some(prev => prev.set === next.set && prev.terrain.id === next.terrain.id));
    if (added) return { key: "history.terrainDefine", params: { name: added.terrain.name } };
    if (oldTerrains.some(prev => !newTerrains.some(next => prev.set === next.set && prev.terrain.id === next.terrain.id))) return "history.terrainRemove";
    if (JSON.stringify(before.terrainSets ?? []) !== JSON.stringify(after.terrainSets ?? [])) return "history.terrainEdit";
  }
  return null;
}

/**
 * What a history step did, read from its changes, for steps the canvas did
 * not name (layer add / remove / move / props, resize, tileset and entity
 * edits, pasted cells): "Katman eklendi", "Katman gizlendi", "40 hücre"...
 * Null when there is nothing to say.
 */
export function describeEntry(entry: HistoryEntry | undefined): string | null {
  if (!entry || entry.changes.length === 0) return null;
  const changes = entry.changes;
  const layers = changes.filter((c) => c.kind === "layer");
  if (layers.length > 0) {
    if (layers.every((c) => c.before === null)) return t("feedback.layerAdded");
    if (layers.every((c) => c.after === null)) return t("feedback.layerRemoved");
    if (layers.every((c) => c.before !== null && c.after !== null)) return t("feedback.layerMoved");
    return t("feedback.layersChanged");
  }
  const props = changes.filter((c) => c.kind === "layerProps");
  if (props.length > 0) {
    const first = props[0]!;
    if (first.before.name !== first.after.name) return t("feedback.layerRenamed");
    if (first.before.visible !== first.after.visible) return t(first.after.visible ? "feedback.layerShown" : "feedback.layerHidden");
    if (first.before.locked !== first.after.locked) return t(first.after.locked ? "feedback.layerLocked" : "feedback.layerUnlocked");
    if (first.before.opacity !== first.after.opacity) return t("feedback.layerOpacity");
    return t("feedback.layersChanged");
  }
  if (changes.some((c) => c.kind === "map")) return t("feedback.mapResized");
  const tilesetVerb = tilesetHistoryVerb(changes);
  if (tilesetVerb) return renderHistoryVerb(tilesetVerb);
  if (changes.some((c) => c.kind === "tileset" || c.kind === "palette")) return t("feedback.tileset");
  if (changes.some((c) => c.kind === "entityTypes")) return t("feedback.entityTypes");
  if (changes.some((c) => c.kind === "entities")) return t("feedback.entities");
  const cells = entry.patches.reduce((n, p) => n + patchCellCount(p), 0);
  return cells > 0 ? t("feedback.cells", { count: formatNumber(cells) }) : null;
}

/**
 * "Geri alındı: Kalem (12 hücre)" / "Yinelendi: 5 adım" / "Geri alındı".
 * `fallback` names a step the canvas did not report (see {@link describeEntry}).
 */
export function historyMessage(move: HistoryMove, summary: StrokeSummary | null, count = 1, fallback: string | null = null): string {
  const key = move === "undo" ? "feedback.undone" : "feedback.redone";
  if (count > 1) return t(key, { what: t("feedback.steps", { count: formatNumber(count) }) });
  if (!summary) return fallback ? t(key, { what: fallback }) : t(move === "undo" ? "feedback.undoneBare" : "feedback.redoneBare");
  return t(key, { what: t("feedback.stroke", { tool: strokeToolLabel(summary), count: formatNumber(summary.cells) }) });
}
