/**
 * Tick math of the canvas rulers (tile coordinates along the top and left
 * edges). Pure: unit tested.
 */

/** Ruler thickness in CSS px. */
export const RULER_SIZE = 20;

/** Labels are at least this far apart (CSS px). */
const MIN_LABEL_PX = 44;
/** Minor ticks are at least this far apart (CSS px). */
const MIN_TICK_PX = 5;

/** One tick: `pos` CSS px from the ruler start, at cell boundary `cell`. */
export interface RulerTick {
  readonly pos: number;
  readonly cell: number;
  /** Labelled tick (longer, with the cell number). */
  readonly major: boolean;
}

/** Smallest "nice" step (1, 2, 5 × 10ⁿ cells) whose length is at least `minPx`. */
export function niceStep(cellPx: number, minPx: number): number {
  if (!(cellPx > 0)) return 1;
  for (let mag = 1; ; mag *= 10) {
    for (const m of [1, 2, 5]) {
      const step = m * mag;
      if (step * cellPx >= minPx || step >= 1e9) return step;
    }
  }
}

/** Cells between labels for cells `cellPx` CSS px wide. */
export function labelStep(cellPx: number): number {
  return cellPx * 10 >= MIN_LABEL_PX ? 10 : niceStep(cellPx, MIN_LABEL_PX);
}

/** Cells between minor ticks: a divisor of the label step (5, 2 or 1 parts) at least {@link MIN_TICK_PX} apart, or the label step. */
export function tickStep(cellPx: number): number {
  const major = labelStep(cellPx);
  for (const parts of [10, 5, 2]) {
    const step = major / parts;
    if (Number.isInteger(step) && step * cellPx >= MIN_TICK_PX) return step;
  }
  return major;
}

/**
 * Ticks of a ruler `length` CSS px long whose cell 0 starts at `origin`
 * (CSS px from the ruler start; negative when scrolled past), with cells
 * `cellPx` wide, for a map `cells` cells long. Only boundaries inside the
 * map (0 … `cells`) and inside the ruler are listed, in order.
 */
export function rulerTicks(origin: number, cellPx: number, length: number, cells: number): RulerTick[] {
  if (!(cellPx > 0) || cells <= 0 || length <= 0) return [];
  const minor = tickStep(cellPx);
  const major = labelStep(cellPx);
  const first = Math.max(0, Math.ceil(-origin / cellPx / minor) * minor);
  const last = Math.min(cells, Math.floor((length - origin) / cellPx));
  const out: RulerTick[] = [];
  for (let cell = first; cell <= last; cell += minor) {
    out.push({ pos: origin + cell * cellPx, cell, major: cell % major === 0 });
  }
  return out;
}

/** The span (CSS px from the ruler start) of `cell`, clipped to the ruler; null when off it or outside the map. */
export function cellSpan(origin: number, cellPx: number, length: number, cell: number | null, cells: number): { from: number; to: number } | null {
  if (cell === null || cell < 0 || cell >= cells || !(cellPx > 0)) return null;
  const from = Math.max(0, origin + cell * cellPx);
  const to = Math.min(length, origin + (cell + 1) * cellPx);
  return to > from ? { from, to } : null;
}
