/** One revision-bound region shared by the hover preview and click. */
import { EMPTY_CELL, floodFillRuns, type Cell, type CellWrite, type CellPoint, type CellSource, type FillRun, type MapStore } from "@smap/core";

import { runMaskImage, runMembershipMask, type CellMaskImage } from "./cellMask";

export interface FillRegionPlan {
  readonly layer: CellSource;
  readonly revision: number;
  readonly width: number;
  readonly height: number;
  readonly runs: readonly FillRun[];
  /** Same traversal order as a fresh fill at this click, using only cached runs. */
  runsAt(cell: CellPoint): readonly FillRun[];
  readonly mask: Uint8Array;
  readonly image: CellMaskImage | null;
}

// Weak ownership avoids retaining closed documents. Revisions cover in-place chunk
// edits, undo/redo and structure changes; dimensions also protect map resizing.
const regions = new WeakMap<MapStore, FillRegionPlan>();

export function fillRegionPlan(store: MapStore, layer: CellSource, cell: CellPoint): FillRegionPlan {
  const { width, height } = store.document.map;
  const cached = regions.get(store);
  if (cached && cached.layer === layer && cached.revision === store.revision && cached.width === width && cached.height === height &&
    Number.isInteger(cell.x) && Number.isInteger(cell.y) && cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height && cached.mask[cell.y * width + cell.x] === 1) return cached;
  const runs = floodFillRuns(layer, cell.x, cell.y, -1, { width, height });
  let image: CellMaskImage | null | undefined;
  let rows: Map<number, number[]> | undefined;
  const plan: FillRegionPlan = {
    layer, revision: store.revision, width, height, runs,
    mask: runMembershipMask(runs, width, height),
    runsAt(start) {
      if (!Number.isInteger(start.x) || !Number.isInteger(start.y)) return [];
      const first = runs[0];
      if (first && first.y === start.y && start.x >= first.left && start.x <= first.right) return runs;
      return orderRuns(runs, start, rows ??= indexRows(runs));
    },
    // Clicks need only the runs; allocate the RGBA image only for preview.
    get image() { return image === undefined ? (image = runMaskImage(runs)) : image; },
  };
  regions.set(store, plan);
  return plan;
}

/** Random paint accepts an iterable; do not materialize a second cell array. */
export function* runPoints(runs: readonly FillRun[]): Iterable<CellPoint> {
  for (const r of runs) for (let x = r.left; x <= r.right; x++) yield { x, y: r.y };
}


function indexRows(runs: readonly FillRun[]): Map<number, number[]> {
  const rows = new Map<number, number[]>();
  runs.forEach((r, i) => {
    const row = rows.get(r.y) ?? [];
    row.push(i);
    rows.set(r.y, row);
  });
  for (const row of rows.values()) row.sort((a, b) => runs[a]!.left - runs[b]!.left);
  return rows;
}

/**
 * Each maximal run is a graph node. Neighbour-row overlaps are its edges.
 * Seed above then below, left to right, exactly as core's scanline traversal.
 * The graph walk touches runs, never individual cells; this also preserves
 * random candidate/palette and patch order when hover and click origins differ.
 */
function orderRuns(runs: readonly FillRun[], start: CellPoint, rows: Map<number, number[]>): FillRun[] {
  const visited = new Uint8Array(runs.length);
  const stack: number[] = [];
  const ordered: FillRun[] = [];
  const seed = (y: number, left: number, right: number) => {
    const row = rows.get(y);
    if (!row) return;
    let lo = 0;
    let hi = row.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (runs[row[mid]!]!.right < left) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < row.length; i++) {
      const index = row[i]!;
      if (runs[index]!.left > right) break;
      if (visited[index] === 0) stack.push(index);
    }
  };
  seed(start.y, start.x, start.x);
  while (stack.length > 0) {
    const index = stack.pop()!;
    if (visited[index]) continue;
    visited[index] = 1;
    const run = runs[index]!;
    ordered.push(run);
    seed(run.y - 1, run.left, run.right);
    seed(run.y + 1, run.left, run.right);
  }
  return ordered;
}


/**
 * Final writes from a same-valued region. Palette resolution may append entries,
 * but does not change region cells; compare its original value once. The store
 * still validates the complete write array and records every before/after patch.
 */
export function fillRunWrites(runs: readonly FillRun[], before: Cell, at: (x: number, y: number) => Cell): CellWrite[] {
  const cells = new Array<CellWrite>(runs.reduce((n, r) => n + r.right - r.left + 1, 0));
  let count = 0;
  for (const r of runs) {
    for (let x = r.left; x <= r.right; x++) {
      const cell = at(x, r.y);
      if (cell === EMPTY_CELL || cell === before) continue;
      cells[count++] = { x, y: r.y, cell };
    }
  }
  cells.length = count;
  return cells;
}
