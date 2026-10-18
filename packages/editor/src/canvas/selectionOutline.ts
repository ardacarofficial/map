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

/** Device-pixel view of a mask. Only these values invalidate rendered geometry. */
export interface SelectionOutlineView {
  x: number; y: number; tileWidth: number; tileHeight: number;
  width: number; height: number; lineWidth: number; resolution: number;
}

/** One textured quad per visible edge; U advances along either axis in eight-pixel ant periods. */
export function selectionBoundaryQuads(edges: readonly Edge[], view: SelectionOutlineView) {
  const { x, y, tileWidth: tw, tileHeight: th, width, height, lineWidth: k, resolution } = view;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const shadows: { x: number; y: number; width: number; height: number }[] = [];
  for (const e of edges) {
    const horizontal = e.y0 === e.y1;
    const ex = x + e.x0 * tw, ey = y + e.y0 * th;
    if (horizontal ? ey < -k || ey > height + k : ex < -k || ex > width + k) continue;
    const x0 = horizontal ? Math.max(-k, ex) : ex, y0 = horizontal ? ey : Math.max(-k, ey);
    const w = horizontal ? Math.min(width + k, x + e.x1 * tw) - x0 : 0;
    const h = horizontal ? 0 : Math.min(height + k, y + e.y1 * th) - y0;
    if (w + h <= 0) continue;
    shadows.push({ x: (x0 - k) / resolution, y: (y0 - k) / resolution, width: (w + 2 * k) / resolution, height: (h + 2 * k) / resolution });
    const p = positions.length / 2;
    positions.push(x0 / resolution, y0 / resolution, (x0 + (w || k)) / resolution, y0 / resolution,
      (x0 + (w || k)) / resolution, (y0 + (h || k)) / resolution, x0 / resolution, (y0 + (h || k)) / resolution);
    const from = (x0 - ex + y0 - ey) / (8 * k), to = from + (w + h) / (8 * k);
    uvs.push(...(horizontal ? [from, 0, to, 0, to, 1, from, 1] : [from, 0, from, 1, to, 1, to, 0]));
    indices.push(p, p + 1, p + 2, p, p + 2, p + 3);
  }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices), shadows };
}
