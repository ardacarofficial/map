import { brushFootprint, MAX_BRUSH_SIZE, type BrushShape } from "../geometry";

export interface PixelPoint { readonly x: number; readonly y: number }
export interface PixelRect extends PixelPoint { readonly width: number; readonly height: number }
export type PixelBrushShape = BrushShape;
export const MAX_PIXEL_BRUSH_SIZE = MAX_BRUSH_SIZE;

/** Pixel centres are integers; pointer adapters must floor world positions first. */
export function assertPixelPoint(p: PixelPoint): void {
  if (!Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y)) throw new RangeError("pixel coordinates must be safe integers");
}

/** Both endpoints included; canonical tie breaking makes reversal exact. */
export function pixelLine(a: PixelPoint, b: PixelPoint): PixelPoint[] {
  assertPixelPoint(a); assertPixelPoint(b);
  const reverse = a.x > b.x || (a.x === b.x && a.y > b.y);
  const start = reverse ? b : a, end = reverse ? a : b;
  let { x, y } = start;
  const dx = Math.abs(end.x - x), dy = -Math.abs(end.y - y);
  const sx = x < end.x ? 1 : -1, sy = y < end.y ? 1 : -1;
  let error = dx + dy;
  const points: PixelPoint[] = [];
  for (;;) {
    points.push({ x, y });
    if (x === end.x && y === end.y) return reverse ? points.reverse() : points;
    const e2 = 2 * error;
    if (e2 >= dy) { error += dy; x += sx; }
    if (e2 <= dx) { error += dx; y += sy; }
  }
}

/** Same tip convention as Tile mode: even tips extend one extra pixel top/left. */
export function pixelFootprint(size: number, shape: PixelBrushShape = "square"): PixelPoint[] {
  if (!Number.isInteger(size) || size < 1 || size > MAX_PIXEL_BRUSH_SIZE) throw new RangeError(`pixel size must be an integer in [1,${MAX_PIXEL_BRUSH_SIZE}]`);
  return brushFootprint(size, shape);
}

/** Inclusive corners, normalized row-major order, outline width one pixel. */
export function pixelRectangle(a: PixelPoint, b: PixelPoint, filled = false): PixelPoint[] {
  assertPixelPoint(a); assertPixelPoint(b);
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const points: PixelPoint[] = [];
  for (let y = y0; y <= y1; y++) {
    if (filled || y === y0 || y === y1) {
      for (let x = x0; x <= x1; x++) points.push({ x, y });
    } else {
      points.push({ x: x0, y });
      if (x1 !== x0) points.push({ x: x1, y });
    }
  }
  return points;
}

interface Span { lo: number; hi: number }

/**
 * Bridges coalesced samples, then unions footprint row spans. Work scales with
 * tip rows plus unique output pixels, avoiding size² duplicate work per sample.
 * Returns deterministic row-major order, deduplicated across the whole stroke.
 */
export function pixelStrokePoints(samples: readonly PixelPoint[], size = 1, shape: PixelBrushShape = "square"): PixelPoint[] {
  const footprint = pixelFootprint(size, shape);
  const tipRows = new Map<number, Span>();
  for (const p of footprint) {
    const span = tipRows.get(p.y);
    if (span) span.hi = p.x;
    else tipRows.set(p.y, { lo: p.x, hi: p.x });
  }
  const rows = new Map<number, Span[]>();
  const addCentre = (p: PixelPoint) => {
    for (const [dy, tip] of tipRows) {
      const y = p.y + dy, lo = p.x + tip.lo, hi = p.x + tip.hi;
      const spans = rows.get(y);
      if (spans) {
        // Most pointer paths append adjacent spans: merge without allocating.
        const last = spans[spans.length - 1]!;
        if (lo <= last.hi + 1 && hi >= last.lo - 1) { last.lo = Math.min(last.lo, lo); last.hi = Math.max(last.hi, hi); }
        else spans.push({ lo, hi });
      } else rows.set(y, [{ lo, hi }]);
    }
  };
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!;
    assertPixelPoint(p);
    if (i === 0) addCentre(p);
    else {
      const line = pixelLine(samples[i - 1]!, p);
      for (let j = 1; j < line.length; j++) addCentre(line[j]!);
    }
  }
  const points: PixelPoint[] = [];
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const spans = rows.get(y)!.sort((a, b) => a.lo - b.lo);
    let end = -Infinity;
    for (const span of spans) {
      for (let x = Math.max(span.lo, end + 1); x <= span.hi; x++) points.push({ x, y });
      end = Math.max(end, span.hi);
    }
  }
  return points;
}
