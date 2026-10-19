import { canonicalRgba, equalRgba, type Rgba8 } from "./color";
import { mirrorPixels, placedPixelSize, placedToSourcePixel, type PixelMirrorAxes } from "./mirror";
import { assertPixelPoint, pixelLine, pixelRectangle, pixelStrokePoints, type PixelBrushShape, type PixelPoint, type PixelRect } from "./tools";

/** Minimal immutable adapter over one native tile's canonical straight RGBA8. */
export interface RasterView {
  readonly width: number;
  readonly height: number;
  get(x: number, y: number): Rgba8;
}

export interface PixelWrite extends PixelPoint { readonly color: Rgba8 }
export interface PixelWritePlan {
  readonly writes: readonly PixelWrite[];
  /** Source-local tight bounding rectangle; null for no change. */
  readonly dirtyRect: PixelRect | null;
}
export interface TilePixelPlan extends PixelWritePlan { readonly cellX: number; readonly cellY: number }
export interface PlacedRaster {
  readonly raster: RasterView;
  readonly flags?: number;
}

/**
 * Regular world-pixel grid. getTile may return null to clip unavailable cells.
 * Raster's oriented extent must equal tileWidth×tileHeight; adapters handle
 * native-size anchoring/expansion before planning, never implicit resampling.
 */
export interface PixelGrid {
  readonly tileWidth: number;
  readonly tileHeight: number;
  getTile(cellX: number, cellY: number): PlacedRaster | null;
}
export interface PixelStrokeOptions {
  readonly color: Rgba8;
  readonly size?: number;
  readonly shape?: PixelBrushShape;
  readonly erase?: boolean;
  readonly mirror?: PixelMirrorAxes;
}

/** Tight inclusive-pixel bounds. The input need not be ordered. */
export function pixelDirtyRect(points: readonly PixelPoint[]): PixelRect | null {
  if (points.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

interface TileDraft {
  cellX: number;
  cellY: number;
  placed: PlacedRaster | null;
  visited: Uint8Array | null;
  writes: PixelWrite[];
}

/**
 * No data mutation or blending. De-duplicates before reading, skips unchanged
 * pixels, maps D4 once, returns cell y/x then source y/x order. Keep all gesture
 * samples for a single plan; dispatch its writes as one store transaction.
 */
export function planPixelPoints(points: readonly PixelPoint[], grid: PixelGrid, color: Rgba8, mirror?: PixelMirrorAxes): TilePixelPlan[] {
  const w = grid.tileWidth, h = grid.tileHeight;
  placedPixelSize(w, h);
  if (!Number.isSafeInteger(w * h)) throw new RangeError("tile area must be a safe integer");
  const c = canonicalRgba(color), cells = new Map<number, Map<number, TileDraft>>();
  const drafts: TileDraft[] = [];
  let last: TileDraft | undefined;
  for (const p of mirror ? mirrorPixels(points, mirror) : points) {
    assertPixelPoint(p);
    const cellX = Math.floor(p.x / w), cellY = Math.floor(p.y / h);
    let draft = last;
    if (!draft || draft.cellX !== cellX || draft.cellY !== cellY) {
      let row = cells.get(cellY);
      if (!row) { row = new Map(); cells.set(cellY, row); }
      draft = row.get(cellX);
      if (!draft) {
        const placed = grid.getTile(cellX, cellY);
        if (placed) {
          const extent = placedPixelSize(placed.raster.width, placed.raster.height, placed.flags);
          if (extent.width !== w || extent.height !== h) throw new RangeError("oriented raster extent must equal pixel grid tile extent");
        }
        draft = { cellX, cellY, placed, visited: placed ? new Uint8Array(w * h) : null, writes: [] };
        row.set(cellX, draft); drafts.push(draft);
      }
      last = draft;
    }
    if (!draft.placed) continue;
    const x = p.x - cellX * w, y = p.y - cellY * h, index = y * w + x;
    if (draft.visited![index]) continue;
    draft.visited![index] = 1;
    const { raster, flags = 0 } = draft.placed;
    // Inline the identity path; avoid point/dimension allocations per pixel.
    const source = flags ? placedToSourcePixel({ x, y }, raster.width, raster.height, flags) : { x, y };
    if (!equalRgba(raster.get(source.x, source.y), c)) draft.writes.push({ x: source.x, y: source.y, color: c });
  }
  return drafts.filter(d => d.writes.length > 0).sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX).map(d => {
    d.writes.sort((a, b) => a.y - b.y || a.x - b.x);
    return { cellX: d.cellX, cellY: d.cellY, writes: d.writes, dirtyRect: pixelDirtyRect(d.writes) };
  });
}

/** Pencil/eraser over all coalesced samples in one press→release gesture. */
export function planPixelStroke(samples: readonly PixelPoint[], grid: PixelGrid, options: PixelStrokeOptions): TilePixelPlan[] {
  const points = pixelStrokePoints(samples, options.size ?? 1, options.shape ?? "square");
  return planPixelPoints(points, grid, options.erase ? { r: 0, g: 0, b: 0, a: 0 } : options.color, options.mirror);
}

export function planPixelLine(a: PixelPoint, b: PixelPoint, grid: PixelGrid, options: PixelStrokeOptions): TilePixelPlan[] {
  // pixelStrokePoints supplies the same canonical Bresenham as the pencil.
  return planPixelStroke(pixelLine(a, b), grid, options);
}

export function planPixelRectangle(a: PixelPoint, b: PixelPoint, grid: PixelGrid, color: Rgba8, filled = false, mirror?: PixelMirrorAxes): TilePixelPlan[] {
  return planPixelPoints(pixelRectangle(a, b, filled), grid, color, mirror);
}
