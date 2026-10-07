/**
 * Pure math of the world map view (v1.2): level boxes, drag + snap, hit
 * testing, frame-all bounds, portal link endpoints and arrowheads, and the
 * adaptive background grid. No Pixi, no DOM: unit tested.
 *
 * World units are map pixels (y down), the same units as
 * `ProjectLevel.world` and the camera's world space.
 */
import type { Point } from "./camera";
import type { Rect } from "./minimapMath";

/** A level on the world map: top-left at its world position, size in map px. */
export interface WorldLevelBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Screen distance (CSS px) a press must travel before it becomes a drag (otherwise it is a click). */
export const DRAG_THRESHOLD_PX = 4;

/** True once a press at `down` moved to `now` (CSS px) far enough to count as a drag. */
export function exceedsDragThreshold(down: Point, now: Point, threshold = DRAG_THRESHOLD_PX): boolean {
  const dx = now.x - down.x;
  const dy = now.y - down.y;
  return dx * dx + dy * dy > threshold * threshold;
}

/**
 * Snaps a world position: each coordinate to the nearest multiple of
 * `snapX` / `snapY` (e.g. the tile size); `snap = false` (Alt held) rounds
 * to whole pixels only. Non-positive snap sizes fall back to whole pixels.
 */
export function snapWorldPosition(p: Point, snapX: number, snapY: number, snap = true): Point {
  const round = (v: number, s: number) => (snap && s > 0 ? Math.round(v / s) * s : Math.round(v)) + 0;
  return { x: round(p.x, snapX), y: round(p.y, snapY) };
}

/**
 * Position of a level being dragged: its position at the press (`origin`)
 * moved by the pointer's world delta since the press, then snapped.
 */
export function dragLevelPosition(
  origin: Point,
  pressWorld: Point,
  pointerWorld: Point,
  snapX: number,
  snapY: number,
  snap = true,
): Point {
  return snapWorldPosition({ x: origin.x + pointerWorld.x - pressWorld.x, y: origin.y + pointerWorld.y - pressWorld.y }, snapX, snapY, snap);
}

/**
 * Top-most level (last in draw order) under world point `p`. The label
 * strip above each box (`labelHeight` world px, as wide as the box) counts
 * as part of the level, so clicking the name works too.
 */
export function hitTestLevels(boxes: readonly WorldLevelBox[], p: Point, labelHeight = 0): WorldLevelBox | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y - labelHeight && p.y < b.y + b.height) return b;
  }
  return null;
}

/** Bounding rectangle of all boxes, or null when there are none. */
export function worldBounds(boxes: readonly WorldLevelBox[]): Rect | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/** One portal link, in level-local coordinates (resolved against the boxes every frame). */
export interface LocalLink {
  readonly fromLevelId: string;
  /** Portal centre in the source level (map px). */
  readonly from: Point;
  readonly toLevelId: string;
  /** Target point in the target level (map px), or null = the target level's centre. */
  readonly to: Point | null;
}

/** World endpoints of a link, or null when a level is not on the map. */
export function linkEndpoints(link: LocalLink, boxes: ReadonlyMap<string, WorldLevelBox>): { from: Point; to: Point } | null {
  const a = boxes.get(link.fromLevelId);
  const b = boxes.get(link.toLevelId);
  if (!a || !b) return null;
  const from = { x: a.x + link.from.x, y: a.y + link.from.y };
  const to = link.to ? { x: b.x + link.to.x, y: b.y + link.to.y } : { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return { from, to };
}

/**
 * Arrowhead triangle at `to` pointing away from `from` (same space as the
 * inputs): tip, left corner, right corner. Null for a zero-length segment.
 */
export function arrowHead(from: Point, to: Point, length: number, halfWidth: number): [Point, Point, Point] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  const bx = to.x - ux * length;
  const by = to.y - uy * length;
  return [
    { x: to.x, y: to.y },
    { x: bx - uy * halfWidth, y: by + ux * halfWidth },
    { x: bx + uy * halfWidth, y: by - ux * halfWidth },
  ];
}

/**
 * Spacing (world px) of the background grid: the snap size doubled until a
 * cell is at least `minScreenPx` CSS px on screen, so the grid never turns
 * into noise when zoomed out.
 */
export function gridSpacing(snap: number, zoom: number, minScreenPx = 16): number {
  let s = snap > 0 ? snap : 32;
  if (!(zoom > 0)) return s;
  while (s * zoom < minScreenPx) s *= 2;
  return s;
}

/**
 * Truncates `text` with "…" so that `measure(result) <= maxWidth`. Returns
 * `""` when not even "…" fits.
 */
export function ellipsize(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  if (measure("…") > maxWidth) return "";
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  // Largest n with measure(chars[0..n] + "…") <= maxWidth.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(chars.slice(0, mid).join("").trimEnd() + "…") <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("").trimEnd() + "…";
}
