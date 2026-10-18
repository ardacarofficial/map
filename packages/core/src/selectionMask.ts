/** Pure, transient selection geometry. Masks never enter the map/clip format. */
import { floodFillRuns, type CellSource } from "./fill";
import type { CellBounds, CellRect } from "./geometry";

export interface SelectionRect extends CellRect {
  /** Omitted for a rectangle; otherwise width × height, row-major, 1 = selected. */
  readonly mask?: Uint8Array;
}

export function selectionContains(r: SelectionRect | null, x: number, y: number): boolean {
  return !!r && x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height &&
    (!r.mask || r.mask[(y - r.y) * r.width + x - r.x] === 1);
}

/** Equal Uint32 cells: palette identity AND all three flip bits, including empty. */
export function connectedSelection(source: CellSource, x: number, y: number, bounds: CellBounds): SelectionRect | null {
  // -1 cannot equal a Uint32 cell; reuse fill's chunk-aware scanline traversal.
  const runs = floodFillRuns(source, x, y, -1, bounds);
  if (!runs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of runs) { x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right); y0 = Math.min(y0, r.y); y1 = Math.max(y1, r.y); }
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  const mask = new Uint8Array(width * height);
  for (const r of runs) mask.fill(1, (r.y - y0) * width + r.left - x0, (r.y - y0) * width + r.right - x0 + 1);
  return { x: x0, y: y0, width, height, mask };
}

/** Clip geometry and crop its mask together; null if no selected cell survives. */
export function clipSelection(r: SelectionRect, bounds: CellBounds): SelectionRect | null {
  const x = Math.max(0, r.x), y = Math.max(0, r.y);
  const width = Math.min(bounds.width, r.x + r.width) - x, height = Math.min(bounds.height, r.y + r.height) - y;
  if (width <= 0 || height <= 0) return null;
  if (x === r.x && y === r.y && width === r.width && height === r.height) return !r.mask || r.mask.some(v => v === 1) ? r : null;
  if (!r.mask) return { x, y, width, height };
  const mask = new Uint8Array(width * height);
  for (let cy = 0; cy < height; cy++) mask.set(r.mask.subarray((y + cy - r.y) * r.width + x - r.x, (y + cy - r.y) * r.width + x - r.x + width), cy * width);
  return mask.some(v => v === 1) ? { x, y, width, height, mask } : null;
}

export function combineSelections(a: SelectionRect | null, b: SelectionRect | null, mode: "add" | "subtract"): SelectionRect | null {
  if (!a) return mode === "add" ? b : null;
  if (!b) return a;
  const x0 = mode === "add" ? Math.min(a.x, b.x) : a.x, y0 = mode === "add" ? Math.min(a.y, b.y) : a.y;
  const x1 = mode === "add" ? Math.max(a.x + a.width, b.x + b.width) : a.x + a.width;
  const y1 = mode === "add" ? Math.max(a.y + a.height, b.y + b.height) : a.y + a.height;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const width = x1 - x0, mask = new Uint8Array(width * (y1 - y0));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const av = selectionContains(a, x, y), bv = selectionContains(b, x, y);
    if (mode === "add" ? av || bv : av && !bv) { mask[(y - y0) * width + x - x0] = 1; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  if (right < left) return null;
  const trimmed = new Uint8Array((right - left + 1) * (bottom - top + 1));
  for (let y = top; y <= bottom; y++) trimmed.set(mask.subarray((y - y0) * width + left - x0, (y - y0) * width + right - x0 + 1), (y - top) * (right - left + 1));
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1, mask: trimmed };
}

export function transformSelection(r: SelectionRect, transform: "cw" | "ccw" | "x" | "y"): SelectionRect {
  const rotate = transform === "cw" || transform === "ccw";
  const width = rotate ? r.height : r.width, height = rotate ? r.width : r.height;
  const target = { x: r.x + (rotate ? Math.trunc((r.width - r.height) / 2) : 0), y: r.y + (rotate ? Math.trunc((r.height - r.width) / 2) : 0), width, height };
  if (!r.mask) return target;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    const tx = transform === "cw" ? r.height - 1 - y : transform === "ccw" ? y : transform === "x" ? r.width - 1 - x : x;
    const ty = transform === "cw" ? x : transform === "ccw" ? r.width - 1 - x : transform === "y" ? r.height - 1 - y : y;
    mask[ty * width + tx] = r.mask[y * r.width + x]!;
  }
  return { ...target, mask };
}

/** Content predicate for inspector/command enablement; never builds a clipboard. */
export function selectionHasContent(source: CellSource, r: SelectionRect): boolean {
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    if (selectionContains(r, x, y) && source.getCell(x, y) !== 0) return true;
  }
  return false;
}
