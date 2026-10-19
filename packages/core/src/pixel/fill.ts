import { canonicalRgba, equalRgba, type Rgba8 } from "./color";
import { placedPixelSize, placedToSourcePixel } from "./mirror";
import { pixelDirtyRect, type PixelGrid, type PixelWrite, type PixelWritePlan, type RasterView, type TilePixelPlan } from "./planner";
import { assertPixelPoint, type PixelPoint } from "./tools";

export type PixelFillMode = "contiguous" | "global";

/** Exact RGBA, 4-neighbour contiguous or all matches, strictly one tile raster. */
export function planPixelFill(raster: RasterView, seed: PixelPoint, color: Rgba8, mode: PixelFillMode = "contiguous"): PixelWritePlan {
  const { width, height } = raster;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0 || !Number.isSafeInteger(width * height)) throw new RangeError("invalid raster dimensions");
  assertPixelPoint(seed);
  const writes: PixelWrite[] = [];
  if (seed.x < 0 || seed.y < 0 || seed.x >= width || seed.y >= height) return { writes, dirtyRect: null };
  const target = raster.get(seed.x, seed.y), c = canonicalRgba(color);
  if (equalRgba(target, c)) return { writes, dirtyRect: null };
  if (mode === "global") {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (equalRgba(raster.get(x, y), target)) writes.push({ x, y, color: c });
    }
  } else {
    // Mark on enqueue: each pixel is examined at most once and queue is bounded
    // by tile area. Numeric indices avoid four point allocations per pixel.
    const visited = new Uint8Array(width * height), queue: number[] = [];
    const enqueue = (x: number, y: number) => {
      const index = y * width + x;
      if (visited[index]) return;
      visited[index] = 1;
      if (equalRgba(raster.get(x, y), target)) queue.push(index);
    };
    enqueue(seed.x, seed.y);
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head]!, x = index % width, y = Math.floor(index / width);
      writes.push({ x, y, color: c });
      if (x > 0) enqueue(x - 1, y);
      if (x + 1 < width) enqueue(x + 1, y);
      if (y > 0) enqueue(x, y - 1);
      if (y + 1 < height) enqueue(x, y + 1);
    }
    writes.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  return { writes, dirtyRect: pixelDirtyRect(writes) };
}

/** World-coordinate fill: resolve the owner cell, invert its flags, fill only it. */
export function planPixelFillAt(seed: PixelPoint, grid: PixelGrid, color: Rgba8, mode: PixelFillMode = "contiguous"): TilePixelPlan[] {
  assertPixelPoint(seed);
  const { tileWidth: w, tileHeight: h } = grid;
  placedPixelSize(w, h);
  const cellX = Math.floor(seed.x / w), cellY = Math.floor(seed.y / h);
  const placed = grid.getTile(cellX, cellY);
  if (!placed) return [];
  const { raster, flags = 0 } = placed, extent = placedPixelSize(raster.width, raster.height, flags);
  if (extent.width !== w || extent.height !== h) throw new RangeError("oriented raster extent must equal pixel grid tile extent");
  const local = placedToSourcePixel({ x: seed.x - cellX * w, y: seed.y - cellY * h }, raster.width, raster.height, flags);
  const plan = planPixelFill(raster, local, color, mode);
  return plan.writes.length ? [{ cellX, cellY, ...plan }] : [];
}
