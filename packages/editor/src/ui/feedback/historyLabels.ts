/**
 * Labels for undo / redo feedback ("Geri alındı: Kalem (12 hücre)"). Pure.
 *
 * The core store keeps its history private, so the labels live in a stack
 * parallel to it, indexed by undo depth: a new step (depth grew, or the
 * redo stack was cleared by a new edit) gets an empty label, and the
 * canvas' `onStrokeCommitted` summary — reported right after the step's
 * commit — names the step on top. Steps the canvas did not report (layer
 * changes, terrain definitions...) keep no label and fall back to a bare
 * "Geri alındı".
 */
import type { ChangeCause } from "@smap/core";

import type { StrokeSummary } from "../../canvas/canvasEvents";
import { formatNumber, t } from "../../i18n";

export type HistoryMove = "undo" | "redo";

/** What an undo / redo just did: the step's label, if known. */
export interface HistoryFeedback {
  readonly move: HistoryMove;
  readonly summary: StrokeSummary | null;
}

export class HistoryLabels {
  #labels: (StrokeSummary | null)[] = [];
  #undoDepth = 0;
  #redoDepth = 0;

  /** Forget everything (another document / level). Pass the store's current depths. */
  reset(undoDepth = 0, redoDepth = 0): void {
    this.#labels = new Array<StrokeSummary | null>(undoDepth + redoDepth).fill(null);
    this.#undoDepth = undoDepth;
    this.#redoDepth = redoDepth;
  }

  /**
   * Feed every store change (cause + the store's depths after it). Returns
   * the feedback for an undo / redo, else null.
   */
  change(cause: ChangeCause, undoDepth: number, redoDepth: number): HistoryFeedback | null {
    const prevUndo = this.#undoDepth;
    const prevRedo = this.#redoDepth;
    this.#undoDepth = undoDepth;
    this.#redoDepth = redoDepth;
    if (cause === "undo") return { move: "undo", summary: this.#labels[undoDepth] ?? null };
    if (cause === "redo") return { move: "redo", summary: this.#labels[undoDepth - 1] ?? null };
    if (undoDepth > prevUndo) {
      // A new step on top; the redo branch is gone.
      this.#labels.length = undoDepth;
      this.#labels[undoDepth - 1] = null;
    } else if (undoDepth === prevUndo && undoDepth > 0 && redoDepth < prevRedo) {
      // New step at the history limit: the oldest fell off.
      this.#labels.length = undoDepth + 1;
      this.#labels.shift();
      this.#labels[undoDepth - 1] = null;
    } else if (undoDepth < prevUndo || redoDepth < prevRedo) {
      // History cleared (or trimmed).
      this.#labels.length = undoDepth;
    }
    return null;
  }

  /** The canvas finished an edit: it is the step on top of the undo stack. */
  stroke(summary: StrokeSummary, undoDepth: number): void {
    if (undoDepth <= 0) return;
    if (this.#labels.length < undoDepth) this.#labels.length = undoDepth;
    this.#labels[undoDepth - 1] = summary;
  }

  /** @internal for tests */
  labelAt(index: number): StrokeSummary | null {
    return this.#labels[index] ?? null;
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
