/**
 * Pure helpers for painting grid (terrain / collision) layers: brush, eraser,
 * rectangle and fill produce `paintTerrain` writes. No Pixi, no DOM.
 */
import { floodFill, type CellBounds, type CellPoint, type CellSource, type GridWrite } from "@smap/core";

import type { CellRegion, ToolId } from "../state/editorStore";

/**
 * Grid value a tool writes: the eraser writes 0, the other paint tools
 * `gridValue`. Null when `gridValue` is not a valid value for the layer
 * (not an integer in `[1, maxValue]`), so nothing is painted.
 */
export function gridPaintValue(tool: ToolId, gridValue: number, maxValue: number): number | null {
  if (tool === "eraser") return 0;
  return Number.isInteger(gridValue) && gridValue >= 1 && gridValue <= maxValue ? gridValue : null;
}

/** Writes for `cells` that are inside the map and do not already hold `value`. */
export function gridWrites(
  cells: readonly CellPoint[],
  value: number,
  bounds: CellBounds,
  getCell: (x: number, y: number) => number,
): GridWrite[] {
  const out: GridWrite[] = [];
  for (const { x, y } of cells) {
    if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) continue;
    if (getCell(x, y) === value) continue;
    out.push({ x, y, value });
  }
  return out;
}

/** Writes setting every cell of `r` that does not already hold `value`. */
export function gridRectWrites(r: CellRegion, value: number, getCell: (x: number, y: number) => number): GridWrite[] {
  const out: GridWrite[] = [];
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      if (getCell(x, y) !== value) out.push({ x, y, value });
    }
  }
  return out;
}

/**
 * Flood fill on grid values: the 4-connected region of cells equal to the
 * value at (`x`, `y`), set to `value`. Empty when that cell already holds
 * `value` or lies outside `bounds`.
 */
export function gridFillWrites(layer: CellSource, x: number, y: number, value: number, bounds: CellBounds): GridWrite[] {
  return floodFill(layer, x, y, value, bounds).map((p) => ({ x: p.x, y: p.y, value }));
}
