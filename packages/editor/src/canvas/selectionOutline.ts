import type { SelectionRect } from "@smap/core";
interface Edge { x0: number; y0: number; x1: number; y1: number }
interface Outline { runs: { x: number; y: number; width: number }[]; edges: Edge[] }
const cache = new WeakMap<Uint8Array, Outline>();
/** Relative geometry cached per immutable mask; camera movement never rescans cells. */
export function selectionOutline(r: SelectionRect): Outline {
  const previous = r.mask && cache.get(r.mask);
  if (previous) return previous;
  const selected = (x: number, y: number) => x >= 0 && y >= 0 && x < r.width && y < r.height && (!r.mask || r.mask[y * r.width + x] === 1);
  const runs: Outline["runs"] = [], edges: Edge[] = [];
  for (let y = 0; y < r.height; y++) {
    let start = -1;
    for (let x = 0; x <= r.width; x++) {
      const on = selected(x, y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) { runs.push({ x: start, y, width: x - start }); start = -1; }
    }
  }
  // Boundary XOR includes enclosed holes. Merge collinear edges before drawing.
  for (let y = 0; y <= r.height; y++) {
    let start = -1;
    for (let x = 0; x <= r.width; x++) {
      const on = x < r.width && selected(x, y - 1) !== selected(x, y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) { edges.push({ x0: start, y0: y, x1: x, y1: y }); start = -1; }
    }
  }
  for (let x = 0; x <= r.width; x++) {
    let start = -1;
    for (let y = 0; y <= r.height; y++) {
      const on = y < r.height && selected(x - 1, y) !== selected(x, y);
      if (on && start < 0) start = y;
      if (!on && start >= 0) { edges.push({ x0: x, y0: start, x1: x, y1: y }); start = -1; }
    }
  }
  const result = { runs, edges };
  if (r.mask) cache.set(r.mask, result);
  return result;
}
