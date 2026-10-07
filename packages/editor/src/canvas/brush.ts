/**
 * Pure brush-stroke helpers: turn pointer samples into cell writes with no
 * gaps (Bresenham between consecutive samples) and no redundant writes.
 */
import { lineCells, type CellPoint, type CellWrite } from "@smap/core";

/**
 * Cells covered by moving from `last` (already painted, excluded) through
 * each of `samples` in order. Consecutive cells are 8-connected. Duplicates
 * are removed (first occurrence kept).
 */
export function strokeCells(last: CellPoint | null, samples: readonly CellPoint[]): CellPoint[] {
  const out: CellPoint[] = [];
  const seen = new Set<string>();
  let prev = last;
  for (const s of samples) {
    const pts = prev ? lineCells(prev.x, prev.y, s.x, s.y) : [{ x: s.x, y: s.y }];
    for (let i = prev ? 1 : 0; i < pts.length; i++) {
      const p = pts[i]!;
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    prev = s;
  }
  return out;
}

/** Writes for `cells` that are inside the map and do not already hold `value`. */
export function cellWrites(
  cells: readonly CellPoint[],
  value: number,
  width: number,
  height: number,
  getCell: (x: number, y: number) => number,
): CellWrite[] {
  const writes: CellWrite[] = [];
  for (const { x, y } of cells) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (getCell(x, y) === value) continue;
    writes.push({ x, y, cell: value });
  }
  return writes;
}

/** How a wheel event should be interpreted. */
export type WheelAction = "zoom" | "pinch" | "pan";

/**
 * Classifies a wheel event (deltas already in pixels).
 *
 * - ctrl/⌘ + wheel: trackpad pinch (Chrome reports pinch this way) when the
 *   delta is small, otherwise a ctrl+mouse-wheel zoom.
 * - any horizontal delta, or small pixel deltas typical of two-finger
 *   scrolling: pan. `recentPan` keeps an ongoing pan gesture panning.
 * - otherwise (mouse wheel notches): zoom.
 */
export function classifyWheel(
  e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  recentPan: boolean,
): WheelAction {
  if (e.ctrlKey || e.metaKey) {
    return e.deltaMode === 0 && Math.abs(e.deltaY) < 50 ? "pinch" : "zoom";
  }
  if (e.shiftKey) return "pan";
  if (e.deltaMode !== 0) return "zoom";
  if (e.deltaX !== 0) return "pan";
  if (recentPan) return "pan";
  const ay = Math.abs(e.deltaY);
  // Mouse wheels send large notches (~100 px; fractional at 125 %/150 % scaling),
  // trackpads send many small deltas. Fractions are not a reliable signal.
  if (ay < 16) return "pan";
  return "zoom";
}
