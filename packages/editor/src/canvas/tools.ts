/**
 * Pure logic of the pointer tools (fill, rectangle, select, stamp, pick).
 * No Pixi, no DOM: everything here is unit tested.
 */
import {
  EMPTY_CELL,
  cellFlags,
  cellPaletteIndex,
  normalizeRect,
  type CellBounds,
  type CellPoint,
  type PaletteEntry,
  type TileClip,
} from "@smap/core";

import type { CellRegion, ToolId } from "../state/editorStore";

/** Mathematical modulo (result in `[0, n)` also for negative `a`). */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Rectangle spanned by two drag corners (both included), clipped to the map; null if fully outside. */
export function dragRegion(a: CellPoint, b: CellPoint, bounds: CellBounds): CellRegion | null {
  const r = normalizeRect(a.x, a.y, b.x, b.y, bounds);
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}

export function regionContains(region: CellRegion | null, p: CellPoint): boolean {
  return !!region && p.x >= region.x && p.y >= region.y && p.x < region.x + region.width && p.y < region.y + region.height;
}

export function regionsEqual(a: CellRegion | null, b: CellRegion | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// ------------------------------------------------------------------ layers

/** What the tools need to know about a layer. */
export interface LayerInfo {
  readonly id: string;
  readonly visible: boolean;
  readonly locked: boolean;
  /** Grid (terrain / collision) layer: holds values, not tiles. */
  readonly grid: boolean;
  getCell(x: number, y: number): number;
}

/** True when tile tools may write to the layer. */
export function isEditable(layer: LayerInfo | undefined | null): layer is LayerInfo {
  return !!layer && layer.visible && !layer.locked && !layer.grid;
}

/** True when grid tools (values, not tiles) may write to the layer. */
export function isGridEditable(layer: LayerInfo | undefined | null): layer is LayerInfo {
  return !!layer && layer.visible && !layer.locked && layer.grid;
}

/**
 * True when the paint tools (brush, eraser, fill, rectangle) may write to the
 * layer: tiles on a tile layer, values on a grid layer.
 */
export function isPaintable(layer: LayerInfo | undefined | null): layer is LayerInfo {
  return isEditable(layer) || isGridEditable(layer);
}

/**
 * Layer a single-cell pick reads from: the active layer when it is a visible
 * tile layer with a tile at (`x`, `y`), otherwise the top-most visible tile
 * layer with a tile there. `layers` are bottom to top.
 */
export function pickLayer(layers: readonly LayerInfo[], activeId: string | null, x: number, y: number): LayerInfo | null {
  const usable = (l: LayerInfo) => l.visible && !l.grid && l.getCell(x, y) !== EMPTY_CELL;
  const active = layers.find((l) => l.id === activeId);
  if (active && usable(active)) return active;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    if (usable(l)) return l;
  }
  return null;
}

/** What a pick produces. */
export type PickResult =
  | { readonly kind: "tile"; readonly entry: PaletteEntry }
  | { readonly kind: "clip"; readonly layerId: string; readonly region: CellRegion }
  | { readonly kind: "none" };

/**
 * Decides what a right-click / eyedropper pick over `region` yields:
 * - one cell holding an unflipped tile → that tile (`"tile"`),
 * - one flipped cell → a 1×1 clip of the layer it was found on,
 * - an area → a clip of the active layer (`"none"` when the active layer is
 *   missing or the area is empty there).
 */
export function decidePick(
  layers: readonly LayerInfo[],
  activeId: string | null,
  region: CellRegion,
  paletteEntry: (index: number) => PaletteEntry | undefined,
): PickResult {
  if (region.width === 1 && region.height === 1) {
    const layer = pickLayer(layers, activeId, region.x, region.y);
    if (!layer) return { kind: "none" };
    const cell = layer.getCell(region.x, region.y);
    if (cellFlags(cell) !== 0) return { kind: "clip", layerId: layer.id, region };
    const entry = paletteEntry(cellPaletteIndex(cell));
    return entry ? { kind: "tile", entry: { tilesetId: entry.tilesetId, tileId: entry.tileId } } : { kind: "none" };
  }
  const active = layers.find((l) => l.id === activeId);
  if (!active) return { kind: "none" };
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      if (active.getCell(x, y) !== EMPTY_CELL) return { kind: "clip", layerId: active.id, region };
    }
  }
  return { kind: "none" };
}

// ------------------------------------------------------------------ stamps

/**
 * Target layer for each clip layer when stamping:
 * - a one-layer clip goes to the active layer;
 * - a multi-layer clip goes to the layers with the same ids; when none of
 *   them exists, its first layer goes to the active layer.
 * Targets that are hidden, locked, missing or of the other kind (tile vs grid)
 * are left out, so `pasteClip` never throws and never edits them.
 */
export function stampMapping(
  clip: TileClip,
  activeId: string | null,
  lookup: (id: string) => LayerInfo | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const ok = (clipGrid: boolean, target: LayerInfo | undefined) =>
    !!target && target.visible && !target.locked && target.grid === clipGrid;
  const toActive = () => {
    const first = clip.layers[0];
    if (first && activeId !== null && ok(first.grid === true, lookup(activeId))) out[first.layerId] = activeId;
  };
  if (clip.layers.length <= 1) {
    toActive();
    return out;
  }
  let anyExists = false;
  for (const layer of clip.layers) {
    const target = lookup(layer.layerId);
    if (target) anyExists = true;
    if (ok(layer.grid === true, target)) out[layer.layerId] = layer.layerId;
  }
  if (!anyExists) toActive();
  return out;
}

/** Index of the clip layer whose cells a pattern tool (fill, rectangle) uses on `activeId`. */
export function patternLayerIndex(clip: TileClip, mapping: Record<string, string>, activeId: string | null): number {
  const i = clip.layers.findIndex((l) => !l.grid && mapping[l.layerId] === activeId);
  if (i >= 0) return i;
  return clip.layers.findIndex((l) => !l.grid);
}

/**
 * Clip-local cell that tiles position (`x`, `y`) when the clip is repeated
 * with its top-left at (`ax`, `ay`) (and every multiple of its size from there).
 */
export function patternCell(clip: TileClip, layerIndex: number, x: number, y: number, ax = 0, ay = 0): number {
  const layer = clip.layers[layerIndex];
  if (!layer) return EMPTY_CELL;
  return layer.cells[mod(y - ay, clip.height) * clip.width + mod(x - ax, clip.width)] ?? EMPTY_CELL;
}

/**
 * Stamp origins a drag passes over: each cell snaps to the grid of stamp-size
 * steps from `start`. Origins already in `placed` are skipped and new ones are
 * added to it, so each grid slot is stamped once per stroke.
 */
export function stampOrigins(
  start: CellPoint,
  cells: readonly CellPoint[],
  width: number,
  height: number,
  placed: Set<string>,
): CellPoint[] {
  const out: CellPoint[] = [];
  for (const c of cells) {
    const o = snapToStampGrid(start, c, width, height);
    const key = `${o.x},${o.y}`;
    if (placed.has(key)) continue;
    placed.add(key);
    out.push(o);
  }
  return out;
}

/** Origin of the stamp-grid slot (anchored at `start`) that contains `c`. */
export function snapToStampGrid(start: CellPoint, c: CellPoint, width: number, height: number): CellPoint {
  return {
    x: start.x + Math.floor((c.x - start.x) / width) * width,
    y: start.y + Math.floor((c.y - start.y) / height) * height,
  };
}

/** A tile to draw in a preview: clip/map position plus what to draw. */
export interface PreviewCell {
  readonly x: number;
  readonly y: number;
  readonly entry: PaletteEntry;
  /** FLIP_* bits. */
  readonly flags: number;
}

/**
 * Preview tiles of the clip layers that `mapping` places, relative to the
 * clip's top-left, bottom layer first.
 */
export function stampPreviewCells(clip: TileClip, mapping: Record<string, string>): PreviewCell[] {
  const out: PreviewCell[] = [];
  for (const layer of clip.layers) {
    if (layer.grid || mapping[layer.layerId] === undefined) continue;
    for (let i = 0; i < layer.cells.length; i++) {
      const cell = layer.cells[i]!;
      if (cell === EMPTY_CELL) continue;
      const entry = clip.palette[cellPaletteIndex(cell) - 1];
      if (!entry) continue;
      out.push({ x: i % clip.width, y: Math.floor(i / clip.width), entry, flags: cellFlags(cell) });
    }
  }
  return out;
}

/**
 * Preview tiles for a rectangle filled with a pattern (clip tiled from
 * `anchor`, or one tile), clipped to `visible` and capped at `limit` cells.
 * Returns null when the clipped area is above the cap (draw an outline only).
 */
export function rectPreviewCells(
  region: CellRegion,
  visible: CellRegion,
  limit: number,
  cellAt: (x: number, y: number) => { entry: PaletteEntry; flags: number } | null,
): PreviewCell[] | null {
  const x0 = Math.max(region.x, visible.x);
  const y0 = Math.max(region.y, visible.y);
  const x1 = Math.min(region.x + region.width, visible.x + visible.width);
  const y1 = Math.min(region.y + region.height, visible.y + visible.height);
  if (x1 <= x0 || y1 <= y0) return [];
  if ((x1 - x0) * (y1 - y0) > limit) return null;
  const out: PreviewCell[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = cellAt(x, y);
      if (c) out.push({ x, y, entry: c.entry, flags: c.flags });
    }
  }
  return out;
}

// ------------------------------------------------------------------ cursor

export interface CursorInput {
  readonly tool: ToolId;
  readonly panning: boolean;
  readonly spaceDown: boolean;
  readonly hasMap: boolean;
  /** Pointer over a map cell. */
  readonly overMap: boolean;
  /** Active layer can be painted with the current tool (see {@link isPaintable}). */
  readonly editable: boolean;
}

/** Tools that write to the active layer. */
export function isEditTool(tool: ToolId): boolean {
  return tool === "brush" || tool === "eraser" || tool === "fill" || tool === "rect";
}

/** CSS cursor for the canvas. */
export function cursorFor(s: CursorInput): string {
  if (s.panning) return "grabbing";
  if (s.spaceDown) return "grab";
  if (!s.hasMap) return "default";
  if (s.overMap && isEditTool(s.tool) && !s.editable) return "not-allowed";
  if (s.tool === "eyedropper") return EYEDROPPER_CURSOR;
  if (s.tool === "fill") return "cell";
  return "crosshair";
}

/** A small eyedropper drawn as an SVG cursor (hotspot at the tip), crosshair fallback. */
export const EYEDROPPER_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">' +
      '<path d="M2 18l1-4 8.5-8.5 3 3L6 17z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M11 4l2-2a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-2 2z" fill="#000" stroke="#fff" stroke-width="1"/>' +
      "</svg>",
  )}") 2 18, crosshair`;
