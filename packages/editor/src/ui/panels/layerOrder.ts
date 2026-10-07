/**
 * Index math for the layers panel. The panel lists layers top layer first
 * ("display" order); core stores them bottom first.
 */

/** Display index ↔ core index (the mapping is its own inverse). */
export function displayToCore(displayIndex: number, count: number): number {
  return count - 1 - displayIndex;
}

/** Where a row dragged by `deltaY` pixels from display index `from` lands. */
export function dropIndex(from: number, deltaY: number, rowHeight: number, count: number): number {
  if (count <= 0) return 0;
  const to = from + Math.round(deltaY / rowHeight);
  return Math.min(count - 1, Math.max(0, to));
}

/**
 * How far (px) row `index` slides while row `from` is dragged over `to`:
 * rows between make room by one row height in the opposite direction.
 */
export function rowShift(index: number, from: number, to: number, rowHeight: number): number {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -rowHeight;
  if (from > to && index >= to && index < from) return rowHeight;
  return 0;
}
