/**
 * Pure logic of the pointer tools (fill, rectangle, select, stamp, pick).
 * No Pixi, no DOM: everything here is unit tested.
 */
import {
  EMPTY_CELL,
  selectionContains,
  clipSelection,
  cellFlags,
  cellPaletteIndex,
  normalizeRect,
  rectangleBand,
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
  return selectionContains(region, p.x, p.y);
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
 * Layer a single-cell pick reads from: the topmost visible non-empty tile
 * layer, or only the active layer when scope is active. `layers` are bottom to top.
 */
export function pickLayer(layers: readonly LayerInfo[], activeId: string | null, x: number, y: number, scope: "active" | "all" = "all"): LayerInfo | null {
  const usable = (l: LayerInfo) => l.visible && !l.grid && l.getCell(x, y) !== EMPTY_CELL;
  const active = layers.find((l) => l.id === activeId);
  if (scope === "active") return active && usable(active) ? active : null;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    if (usable(l)) return l;
  }
  return null;
}

/** What a pick produces. */
export type PickResult =
  | { readonly kind: "tile"; readonly layerId: string; readonly entry: PaletteEntry }
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
  scope: "active" | "all" = "all",
): PickResult {
  if (region.width === 1 && region.height === 1) {
    const layer = pickLayer(layers, activeId, region.x, region.y, scope);
    if (!layer) return { kind: "none" };
    const cell = layer.getCell(region.x, region.y);
    if (cellFlags(cell) !== 0) return { kind: "clip", layerId: layer.id, region };
    const entry = paletteEntry(cellPaletteIndex(cell));
    return entry ? { kind: "tile", layerId: layer.id, entry: { tilesetId: entry.tilesetId, tileId: entry.tileId } } : { kind: "none" };
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
  thickness = 0,
): PreviewCell[] | null {
  const x0 = Math.max(region.x, visible.x);
  const y0 = Math.max(region.y, visible.y);
  const x1 = Math.min(region.x + region.width, visible.x + visible.width);
  const y1 = Math.min(region.y + region.height, visible.y + visible.height);
  if (x1 <= x0 || y1 <= y0) return [];
  if (thickness === 0 && (x1 - x0) * (y1 - y0) > limit) return null;
  const out: PreviewCell[] = [];
  for (const { x, y } of rectangleBand(region, thickness, visible)) {
    const c = cellAt(x, y);
    if (c) out.push({ x, y, entry: c.entry, flags: c.flags });
  }
  return out;
}

// ------------------------------------------------------------------ blocked actions, right click

/**
 * Why a left press on the map cannot do anything (the canvas says so instead
 * of failing silently). `"noBrush"`: brush / fill / rectangle on a tile layer
 * with nothing to paint (no tile, stamp or random set chosen).
 */
export type BlockedReason = "locked" | "hidden" | "wrongKind" | "noBrush";

/** What {@link blockedReason} needs to know about the active layer. */
export interface LayerState {
  readonly kind: "tile" | "grid" | "entity";
  readonly visible: boolean;
  readonly locked: boolean;
}

/**
 * Why a left press with `tool` on the active `layer` does nothing, or null
 * when it can act (or when there is nothing to explain, e.g. no layer).
 *
 * - Paint tools (brush, eraser, fill, rectangle) need a visible, unlocked
 *   tile or grid layer. A saved library
 *   stamp (`savedStampBrush`) maps its own layers and is never blocked.
 * - The entity tool needs a visible entity layer. A locked entity layer is
 *   left to the entity action (its own toast; clicking still selects).
 * - `"move"` (dragging the selection with the select tool) needs a visible,
 *   unlocked layer of any kind.
 */
export function blockedReason(tool: ToolId | "move", layer: LayerState | null, savedStampBrush = false): BlockedReason | null {
  if (!layer) return null;
  if (tool === "move") {
    if (layer.locked) return "locked";
    return layer.visible ? null : "hidden";
  }
  if (tool === "entity") {
    if (layer.kind !== "entity") return "wrongKind";
    return layer.visible ? null : "hidden";
  }
  if (!isEditTool(tool) || (tool === "brush" && savedStampBrush)) return null;
  if (layer.kind === "entity") return "wrongKind";
  if (layer.locked) return "locked";
  if (!layer.visible) return "hidden";
  return null;
}

/**
 * What a right press does:
 * - `"pick"`: take tiles from the map (single cell / dragged area);
 * - `"eraseRect"`: eraser tool — erase the dragged rectangle (one cell on a
 *   click) and stay in the eraser (Tiled habit);
 * - `"entityMenu"`: entity layer, pressed on an entity: ask for its context menu;
 * - `"selectionMenu"`: select tool, pressed inside the selection: its context
 *   menu on release without a drag (a drag picks the area instead);
 * - `"none"`: entity layer elsewhere (no tiles to pick there), or the hand tool.
 */
export type RightPress = "pick" | "eraseRect" | "entityMenu" | "selectionMenu" | "none";

export function rightPressAction(input: {
  readonly layer: LayerState["kind"] | null;
  readonly tool: ToolId;
  readonly inRegion: boolean;
  readonly entityHit: boolean;
}): RightPress {
  if (input.tool === "hand") return "none";
  if (input.layer === "entity") return input.entityHit ? "entityMenu" : "none";
  if (input.tool === "select" && input.inRegion) return "selectionMenu";
  if (input.tool === "eraser") return "eraseRect";
  return "pick";
}

/** What a right press turns into on release: a dragged menu press picks (selection) or does nothing (entity). */
export function rightReleaseAction(press: RightPress, moved: boolean): RightPress {
  if (!moved) return press;
  if (press === "selectionMenu") return "pick";
  if (press === "entityMenu") return "none";
  return press;
}

/**
 * True when a pick of `region` on a grid layer finds nothing to take: one
 * cell holding no value (the tiles under it are not picked; drag for an area).
 */
export function isEmptyGridPick(region: CellRegion, gridValueAt: (x: number, y: number) => number): boolean {
  return region.width === 1 && region.height === 1 && gridValueAt(region.x, region.y) === 0;
}

// ------------------------------------------------------------------ selection move

/** Region moved by (`dx`, `dy`) and clipped to the map, or null when nothing of it is left on the map. */
export function movedRegion(region: CellRegion, dx: number, dy: number, bounds: CellBounds): CellRegion | null {
  return clipSelection({ ...region, x: region.x + dx, y: region.y + dy }, bounds);
}

/**
 * Offset of a selection drag grabbed at cell `grab` with the pointer now at
 * `cell`, limited so the moved region stays on the map (moving never drops
 * content over the edge). A region already sticking out cannot move further out.
 */
export function moveOffset(region: CellRegion, grab: CellPoint, cell: CellPoint, bounds: CellBounds): CellPoint {
  const clamp = (d: number, lo: number, hi: number) => Math.min(Math.max(d, Math.min(lo, 0)), Math.max(hi, 0));
  return {
    x: clamp(cell.x - grab.x, -region.x, bounds.width - region.x - region.width),
    y: clamp(cell.y - grab.y, -region.y, bounds.height - region.y - region.height),
  };
}

/** Arrow key → nudge offset (Shift: 10 cells), or null for other keys. */
export function nudgeOffset(key: string, shift: boolean): CellPoint | null {
  const n = shift ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
      return { x: -n, y: 0 };
    case "ArrowRight":
      return { x: n, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -n };
    case "ArrowDown":
      return { x: 0, y: n };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ marching ants

/**
 * Dashes along a closed outline of length `perimeter`: `[start, end)` spans
 * of `dash` on / `gap` off, shifted forward by `phase` (marching ants).
 */
export function dashSpans(perimeter: number, dash: number, gap: number, phase: number): [number, number][] {
  const out: [number, number][] = [];
  const period = dash + gap;
  if (perimeter <= 0 || dash <= 0 || period <= 0) return out;
  const shift = mod(phase, period);
  for (let start = shift - period; start < perimeter; start += period) {
    const a = Math.max(0, start);
    const b = Math.min(perimeter, start + dash);
    if (b > a) out.push([a, b]);
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
  /**
   * Entity tools on an entity layer: pointer over an entity (`"over"`),
   * dragging one (`"drag"`), or the entity tool cannot place here
   * (`"blocked"`: no entity layer active, layer locked, no type chosen).
   */
  readonly entity?: "over" | "drag" | "blocked" | null;
  /** Select tool: pointer over the selection (drag moves it), or its content is being moved. */
  readonly region?: "over" | "moving" | null;
}

/** Tools that write to the active layer. */
export function isEditTool(tool: ToolId): boolean {
  return tool === "brush" || tool === "eraser" || tool === "fill" || tool === "rect";
}

/**
 * Tool for a newly active layer: tile tools (brush, eraser, fill,
 * rectangle) become the entity tool on an entity layer; the entity tool
 * becomes the last tile tool used (`lastTileTool`, default brush)
 * elsewhere; select, eyedropper and hand stay.
 */
export function toolForLayer(tool: ToolId, entityLayer: boolean, lastTileTool: ToolId = "brush"): ToolId {
  if (entityLayer) return isEditTool(tool) ? "entity" : tool;
  return tool === "entity" ? (isEditTool(lastTileTool) ? lastTileTool : "brush") : tool;
}

/** Tools the canvas remembers across layer changes and eyedropper picks. */
export interface ToolMemory {
  /** Last tile tool (brush, eraser, fill, rectangle) used: comes back after an entity layer. */
  readonly lastTileTool: ToolId;
  /** Tool active right before the eyedropper was chosen (null: none yet). */
  readonly beforeEyedropper: ToolId | null;
}

export const INITIAL_TOOL_MEMORY: ToolMemory = { lastTileTool: "brush", beforeEyedropper: null };

/** Memory after the tool changed from `prev` to `tool`. Returns `memory` itself when nothing changes. */
export function nextToolMemory(memory: ToolMemory, prev: ToolId, tool: ToolId): ToolMemory {
  if (prev === tool) return memory;
  let next = memory;
  if (isEditTool(tool) && memory.lastTileTool !== tool) next = { ...next, lastTileTool: tool };
  if (tool === "eyedropper" && next.beforeEyedropper !== prev) next = { ...next, beforeEyedropper: prev };
  return next;
}

/**
 * Tool to switch to after a pick, or null to stay:
 * - a pick of the temporary (Alt) eyedropper stays — releasing Alt brings
 *   the previous tool back (`spring` is read at the press, so releasing Alt
 *   before the mouse does not change the outcome);
 * - the eyedropper tool returns to the paint tool used before it (brush,
 *   fill or rectangle place the picked tiles), else the brush;
 * - the select tool switches to the brush (it cannot place tiles);
 * - every other tool stays (fill and rectangle use the picked tiles too).
 */
export function toolAfterPick(tool: ToolId, beforeEyedropper: ToolId | null, spring: boolean): ToolId | null {
  if (spring) return null;
  if (tool === "eyedropper") {
    return beforeEyedropper === "fill" || beforeEyedropper === "rect" ? beforeEyedropper : "brush";
  }
  if (tool === "select") return "brush";
  return null;
}

/**
 * True when a left press with `tool` has nothing to paint: brush / fill /
 * rectangle on a tile layer without a usable tile, stamp or random set.
 * (Grid layers paint their value; the eraser needs nothing.)
 */
export function missingBrush(
  tool: ToolId,
  brush: { readonly grid: boolean; readonly stamp: boolean; readonly tile: boolean; readonly random: boolean },
): boolean {
  if (tool !== "brush" && tool !== "fill" && tool !== "rect") return false;
  if (brush.grid) return false;
  return !brush.stamp && !brush.tile && !brush.random;
}

/** Tools whose footprint size (`[` `]`, size readout) means something. */
export function usesBrushSize(tool: ToolId): boolean {
  return tool === "brush" || tool === "eraser";
}

/**
 * True when a key for command `id` must do nothing right now: tool, brush
 * size and brush orientation keys while a gesture is running (a stroke keeps
 * its tool to the end), and the brush size keys for tools without a
 * footprint.
 */
export function suppressedCommandKey(id: string, tool: ToolId, gestureActive: boolean): boolean {
  const brushKey = id.startsWith("tool.") || id.startsWith("brush.") || BRUSH_ORIENTATION.has(id);
  if (gestureActive && brushKey) return true;
  if ((id === "brush.smaller" || id === "brush.larger") && !usesBrushSize(tool)) return true;
  return false;
}

const BRUSH_ORIENTATION = new Set(["edit.flipX", "edit.flipY", "edit.rotateCW", "edit.rotateCCW"]);

/** CSS cursor for the canvas. */
export function cursorFor(s: CursorInput): string {
  if (s.panning) return "grabbing";
  if (s.spaceDown || s.tool === "hand") return "grab";
  if (!s.hasMap) return "default";
  if (s.region === "moving") return "grabbing";
  if (s.region === "over") return "move";
  if (s.entity === "drag") return "grabbing";
  if (s.entity === "over") return "move";
  if (s.overMap && s.entity === "blocked") return "not-allowed";
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
