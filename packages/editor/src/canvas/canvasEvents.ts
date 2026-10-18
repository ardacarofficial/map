/**
 * Events the map canvas reports to the UI through its handle (pick feedback,
 * per-stroke summaries for undo toasts). Pure payload builders, unit tested.
 */
import type { PaletteEntry, TileClip } from "@smap/core";

import type { CellRegion, TileSelection } from "../state/editorStore";
import type { BlockedReason, PickResult } from "./tools";

export type { BlockedReason } from "./tools";

export interface BlockedAction {
  readonly reason: BlockedReason;
  readonly layerId: string;
}

/**
 * A right click asks for a context menu. Tile clicks also retain their pick. `x` / `y`
 * are client (page) coordinates of the click, for positioning the menu.
 * - `"tile"`: clicked tile identity and the brush before the pick;
 * - `"entity"`: on entity `entityId` of the active entity layer (it is
 *   already selected);
 * - `"selection"`: select tool, inside the selection, without a drag.
 */
export type CanvasContextRequest =
  | { readonly kind: "tile"; readonly tile: PaletteEntry; readonly brush: PaletteEntry | null; readonly x: number; readonly y: number }
  | { readonly kind: "entity"; readonly entityId: string; readonly x: number; readonly y: number }
  | { readonly kind: "selection"; readonly x: number; readonly y: number };

/**
 * Something was picked from the map (right click / right drag / eyedropper):
 * one tile, an area or flipped cell as a clip, or a grid layer value.
 * `region` is the picked map area (cells).
 */
export type CanvasPickEvent =
  | { readonly kind: "tile"; readonly tilesetId: string; readonly tileId: number; readonly region: CellRegion }
  | { readonly kind: "clip"; readonly clip: TileClip; readonly region: CellRegion }
  | { readonly kind: "grid"; readonly value: number; readonly region: CellRegion };

/** Tools whose edit is one undo step reported by `onStrokeCommitted`. */
export type StrokeTool = "brush" | "eraser" | "fill" | "rect" | "stamp";

/** One finished edit gesture: the tool and how many cells it changed (> 0). */
export interface StrokeSummary {
  readonly tool: StrokeTool;
  readonly cells: number;
}

/**
 * Pick event for a {@link PickResult} (`clip`: the copied clip of a `"clip"`
 * result). Null when nothing was picked.
 */
export function pickEvent(result: PickResult, clip: TileClip | null, region: CellRegion): CanvasPickEvent | null {
  const r = { x: region.x, y: region.y, width: region.width, height: region.height };
  if (result.kind === "tile") return { kind: "tile", tilesetId: result.entry.tilesetId, tileId: result.entry.tileId, region: r };
  if (result.kind === "clip" && clip) return { kind: "clip", clip, region: r };
  return null;
}

export function gridPickEvent(value: number, region: CellRegion): CanvasPickEvent {
  return { kind: "grid", value, region: { x: region.x, y: region.y, width: region.width, height: region.height } };
}

/** The tile a pick adds to the recent-tiles strip, or null (areas, grid values). */
export function recentTileOf(event: CanvasPickEvent): TileSelection | null {
  return event.kind === "tile" ? { tilesetId: event.tilesetId, tileId: event.tileId } : null;
}

/** Summary to report for a finished edit, or null when it changed nothing. */
export function strokeSummary(tool: StrokeTool, cells: number): StrokeSummary | null {
  return cells > 0 ? { tool, cells } : null;
}
