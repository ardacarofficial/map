/**
 * Pure math of the minimap and the far-zoom level of detail: thumbnail
 * scale, minimap layout, viewport rectangle, minimap → world mapping and
 * the LOD switch with hysteresis. No Pixi, no DOM: unit tested.
 */
import type { Camera } from "./camera";

/** Largest thumbnail side in px (one texture; an atlas page limit). */
export const THUMB_MAX_PX = 4096;
/** Most thumbnail px per map cell (more is not visible: LOD starts below 4 device px per cell). */
export const THUMB_MAX_CELL_PX = 4;

/**
 * Thumbnail px per map cell: an integer 1…{@link THUMB_MAX_CELL_PX} when the
 * map fits, otherwise a fraction so the longer side is `THUMB_MAX_PX`.
 */
export function thumbnailScale(mapWidth: number, mapHeight: number): number {
  const longest = Math.max(1, mapWidth, mapHeight);
  const s = THUMB_MAX_PX / longest;
  return s >= 1 ? Math.min(THUMB_MAX_CELL_PX, Math.floor(s)) : s;
}

/** Thumbnail pixel span of chunk column/row `c` (`size` = cells per chunk). Edges are rounded so chunks tile without gaps. */
export function chunkSpan(c: number, size: number, scale: number, limitCells: number): { from: number; to: number } {
  const from = Math.round(c * size * scale);
  const to = Math.round(Math.min((c + 1) * size, limitCells) * scale);
  return { from, to };
}

export interface MinimapLayout {
  /** CSS px of the minimap drawing area. */
  readonly width: number;
  readonly height: number;
  /** Minimap CSS px per map px. */
  readonly scale: number;
}

/** Fits a `mapW`×`mapH` px map into `maxW`×`maxH` CSS px keeping the aspect (at least 1 px each way). */
export function minimapLayout(mapW: number, mapH: number, maxW: number, maxH: number): MinimapLayout {
  if (mapW <= 0 || mapH <= 0) return { width: 0, height: 0, scale: 0 };
  const scale = Math.min(maxW / mapW, maxH / mapH);
  return { width: Math.max(1, Math.round(mapW * scale)), height: Math.max(1, Math.round(mapH * scale)), scale };
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The part of the map on screen, in minimap CSS px (clipped to the minimap;
 * zero-sized when the view is off the map).
 */
export function viewportRect(cam: Camera, viewW: number, viewH: number, layout: MinimapLayout): Rect {
  const s = layout.scale;
  const x0 = Math.max(0, Math.min(layout.width, (-cam.x / cam.zoom) * s));
  const y0 = Math.max(0, Math.min(layout.height, (-cam.y / cam.zoom) * s));
  const x1 = Math.max(0, Math.min(layout.width, ((viewW - cam.x) / cam.zoom) * s));
  const y1 = Math.max(0, Math.min(layout.height, ((viewH - cam.y) / cam.zoom) * s));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Map px under minimap point (`mx`, `my`) (CSS px), clamped to the map. */
export function minimapToWorld(mx: number, my: number, layout: MinimapLayout, mapW: number, mapH: number): { x: number; y: number } {
  if (layout.scale <= 0) return { x: 0, y: 0 };
  return {
    x: Math.max(0, Math.min(mapW, mx / layout.scale)),
    y: Math.max(0, Math.min(mapH, my / layout.scale)),
  };
}

/** Camera that shows map px (`wx`, `wy`) at the centre of a `viewW`×`viewH` view. */
export function cameraCenteredOn(wx: number, wy: number, zoom: number, viewW: number, viewH: number): Camera {
  return { x: viewW / 2 - wx * zoom, y: viewH / 2 - wy * zoom, zoom };
}

/**
 * Far-zoom LOD turns on when a cell is narrower than this many device px.
 * 4 = {@link THUMB_MAX_CELL_PX}: for maps up to 1024 cells the thumbnail has
 * as many px per cell as the screen at the switch, so it is seamless. (Lower
 * would never trigger for 32 px tiles at 100 % scaling: the zoom stops at
 * 0.1 = 3.2 px per cell.)
 */
export const LOD_ENTER_CELL_DEVICE_PX = 4;
/** ...and off again only once it is at least this wide (no flicker at the threshold). */
export const LOD_EXIT_CELL_DEVICE_PX = 5;

/** Next LOD state given the current one and the cell size in device px. */
export function nextLod(active: boolean, cellDevicePx: number): boolean {
  return active ? cellDevicePx < LOD_EXIT_CELL_DEVICE_PX : cellDevicePx < LOD_ENTER_CELL_DEVICE_PX;
}
