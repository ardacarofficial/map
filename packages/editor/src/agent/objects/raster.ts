/** Pure pixel helpers for the object tools: stamp art with its real alpha, and a reference resampled to map pixels. */
import type { ReferenceAlignment } from "@smap/agent";
import { cellFlags, cellPaletteIndex, FLIP_D, FLIP_H, FLIP_V, isValidTileId, tileRect, type RgbaImage, type Stamp, type Tileset } from "@smap/core";

/** Source-over into straight-alpha RGBA. */
function over(out: Uint8Array, p: number, r: number, g: number, b: number, a: number): void {
  const sa = a / 255, da = out[p + 3]! / 255, oa = sa + da * (1 - sa);
  if (!oa) return;
  out[p] = Math.round((r * sa + out[p]! * da * (1 - sa)) / oa);
  out[p + 1] = Math.round((g * sa + out[p + 1]! * da * (1 - sa)) / oa);
  out[p + 2] = Math.round((b * sa + out[p + 2]! * da * (1 - sa)) / oa);
  out[p + 3] = Math.round(oa * 255);
}

/** All tile layers of a stamp composited bottom to top on transparency, every cell drawn at tileWidth×tileHeight
 * (nearest), flips applied. Collision layers are not art. Missing artwork is reported, not guessed. */
export function stampRgba(stamp: Stamp, tilesets: readonly Tileset[], pixels: (tilesetId: string) => RgbaImage | undefined, tileWidth: number, tileHeight: number): { image: RgbaImage; missing: string[] } {
  const width = stamp.width * tileWidth, height = stamp.height * tileHeight, out = new Uint8Array(width * height * 4);
  const missing = new Set<string>();
  for (const layer of stamp.layers) {
    if (layer.grid) continue;
    for (let i = 0; i < layer.cells.length; i++) {
      const value = layer.cells[i]!, entry = stamp.palette[cellPaletteIndex(value) - 1];
      if (!entry) continue;
      const tileset = tilesets.find(t => t.id === entry.tilesetId), source = tileset ? pixels(tileset.id) : undefined;
      if (!tileset || !source || !isValidTileId(tileset, entry.tileId)) { missing.add(entry.tilesetId); continue; }
      const r = tileRect(tileset, entry.tileId), flags = cellFlags(value);
      if (r.x + r.width > source.width || r.y + r.height > source.height) { missing.add(entry.tilesetId); continue; }
      const diagonal = !!(flags & FLIP_D), pw = diagonal ? r.height : r.width, ph = diagonal ? r.width : r.height;
      const cx = (i % stamp.width) * tileWidth, cy = Math.floor(i / stamp.width) * tileHeight;
      for (let v = 0; v < tileHeight; v++) for (let u = 0; u < tileWidth; u++) {
        let x = Math.floor(u * pw / tileWidth), y = Math.floor(v * ph / tileHeight);
        if (flags & FLIP_H) x = pw - 1 - x;
        if (flags & FLIP_V) y = ph - 1 - y;
        if (diagonal) [x, y] = [y, x];
        const s = ((r.y + y) * source.width + r.x + x) * 4, a = source.data[s + 3]!;
        if (a) over(out, ((cy + v) * width + cx + u) * 4, source.data[s]!, source.data[s + 1]!, source.data[s + 2]!, a);
      }
    }
  }
  return { image: { width, height, data: out }, missing: [...missing] };
}

/** The aligned picture in map pixels (tileWidth×tileHeight per cell) for cols×rows cells from cell (0,0).
 * Box average over each pixel's footprint when the picture is larger (an integer-scaled render returns its exact
 * source pixels), nearest sample when smaller. Pixels outside the picture are transparent. */
export function resampleToMapPixels(reference: RgbaImage, alignment: ReferenceAlignment, tileWidth: number, tileHeight: number, cols: number, rows: number): RgbaImage {
  const width = cols * tileWidth, height = rows * tileHeight, out = new Uint8Array(width * height * 4);
  const kx = alignment.cellPx / tileWidth, ky = (alignment.cellPxY ?? alignment.cellPx * tileHeight / tileWidth) / tileHeight;
  const spans = (count: number, k: number, offset: number, limit: number) => {
    const from = new Int32Array(count), to = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      if (k >= 1) { from[i] = Math.round(offset + i * k); to[i] = Math.max(from[i]! + 1, Math.round(offset + (i + 1) * k)); }
      else { from[i] = Math.floor(offset + (i + 0.5) * k); to[i] = from[i]! + 1; }
      from[i] = Math.max(0, from[i]!); to[i] = Math.min(limit, to[i]!);
    }
    return { from, to, area: (i: number) => k >= 1 ? Math.max(1, Math.round(offset + (i + 1) * k) - Math.round(offset + i * k)) : 1 };
  };
  const xs = spans(width, kx, alignment.offsetX, reference.width), ys = spans(height, ky, alignment.offsetY, reference.height);
  const d = reference.data, rw = reference.width;
  for (let v = 0; v < height; v++) {
    const y0 = ys.from[v]!, y1 = ys.to[v]!, ay = ys.area(v);
    for (let u = 0; u < width; u++) {
      const x0 = xs.from[u]!, x1 = xs.to[u]!;
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = (y * rw + x) * 4, w = d[p + 3]!;
        r += d[p]! * w; g += d[p + 1]! * w; b += d[p + 2]! * w; a += w;
      }
      if (!a) continue;
      const q = (v * width + u) * 4;
      out[q] = Math.round(r / a); out[q + 1] = Math.round(g / a); out[q + 2] = Math.round(b / a);
      out[q + 3] = Math.round(a / (xs.area(u) * ay)); // pixels outside the picture count as transparent
    }
  }
  return { width, height, data: out };
}
