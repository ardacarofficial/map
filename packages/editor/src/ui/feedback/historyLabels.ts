/**
 * Labels for undo / redo feedback ("Geri alındı: Kalem (12 hücre)"). Pure.
 *
 * Labels are keyed by the core history step's stable id
 * (`HistoryEntry.id`, read with `peekUndo()` / `peekRedo()`), not by undo
 * depth: at the history limit the depth stays put while the oldest step
 * falls off, so a depth would name the wrong step. The canvas'
 * `onStrokeCommitted` summary — reported right after the step's commit —
 * names the step on top. Steps the canvas did not report (layer changes,
 * terrain definitions...) keep no label and fall back to a bare
 * "Geri alındı".
 */
import type { ChangeCause, MapStore } from "@smap/core";

import type { StrokeSummary } from "../../canvas/canvasEvents";
import { formatNumber, t } from "../../i18n";

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

/** "Geri alındı: Kalem (12 hücre)" / "Yinelendi: 5 adım" / "Geri alındı". */
export function historyMessage(move: HistoryMove, summary: StrokeSummary | null, count = 1): string {
  const key = move === "undo" ? "feedback.undone" : "feedback.redone";
  if (count > 1) return t(key, { what: t("feedback.steps", { count: formatNumber(count) }) });
  if (!summary) return t(move === "undo" ? "feedback.undoneBare" : "feedback.redoneBare");
  return t(key, { what: t("feedback.stroke", { tool: strokeToolLabel(summary), count: formatNumber(summary.cells) }) });
}
