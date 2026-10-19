/** Rasterizes core's fixed slot ABI. Source pixels are immutable; no canvas resampling or blending. */
import { nineSliceBlits, orientPoint, type NineSliceInnerCorner, type Stamp, type Tileset } from "@smap/core";
import { deferredTilesetImage, getTilesetImage, type TilesetImage } from "../../state/tilesetImages";
import { tilesetPixels } from "../../state/tilesetPixels";
export { pngHash } from "../../state/pngHash";
import { profileAwait, profileSpan, type BrushProfile } from "../../state/smartBrushProfile";

export interface PixelImage { readonly width: number; readonly height: number; readonly data: Uint8Array | Uint8ClampedArray; readonly originX?: number; readonly originY?: number }
export function rasterizeSmartStamp(stamp: Stamp, layerId: string, target: Tileset, sources: ReadonlyMap<string, { tileset: Tileset; pixels: PixelImage }>, inner?: NineSliceInnerCorner): PixelImage {
  const width = target.columns * target.tileWidth, height = target.rows * target.tileHeight;
  const data = new Uint8ClampedArray(width * height * 4);
  const words = new Uint32Array(data.buffer);
  for (const b of nineSliceBlits(stamp, layerId, target.tileWidth, target.tileHeight, inner)) {
    const source = sources.get(b.tile.tilesetId);
    if (!source) throw new Error(`Missing source image: ${b.tile.tilesetId}`);
    const { tileset: t, pixels: p } = source;
    const ox = t.margin + (b.tile.tileId % t.columns) * (t.tileWidth + t.spacing) - (p.originX ?? 0);
    const oy = t.margin + Math.floor(b.tile.tileId / t.columns) * (t.tileHeight + t.spacing) - (p.originY ?? 0);
    if (ox < 0 || oy < 0 || ox + t.tileWidth > p.width || oy + t.tileHeight > p.height) throw new Error(`Source image grid does not fit: ${t.imagePath}`);
    const r = b.sourceRect, d = b.destinationRect;
    if (p.data.byteOffset % 4 === 0) {
      // Copy RGBA words, with orientation represented by two strides. No per-pixel objects.
      const input = new Uint32Array(p.data.buffer, p.data.byteOffset, p.data.byteLength / 4);
      const a = orientPoint({ x: 0, y: 0 }, r.width, r.height, b.flags);
      const x = orientPoint({ x: 1, y: 0 }, r.width, r.height, b.flags), y = orientPoint({ x: 0, y: 1 }, r.width, r.height, b.flags);
      const dx = (x.y - a.y) * width + x.x - a.x, dy = (y.y - a.y) * width + y.x - a.x;
      const start = (Math.floor(b.slot / target.columns) * target.tileHeight + d.y + a.y) * width + (b.slot % target.columns) * target.tileWidth + d.x + a.x;
      for (let row = 0; row < r.height; row++) {
        const source = (oy + r.y + row) * p.width + ox + r.x, destination = start + row * dy;
        if (dx === 1) words.set(input.subarray(source, source + r.width), destination);
        else for (let col = 0; col < r.width; col++) words[destination + col * dx] = input[source + col]!;
      }
      continue;
    }
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
      const q = orientPoint({ x, y }, r.width, r.height, b.flags);
      const dx = (b.slot % target.columns) * target.tileWidth + d.x + q.x;
      const dy = Math.floor(b.slot / target.columns) * target.tileHeight + d.y + q.y;
      const start = ((oy + r.y + y) * p.width + ox + r.x + x) * 4;
      data.set(p.data.subarray(start, start + 4), (dy * width + dx) * 4);
    }
  }
  return { width, height, data };
}
export function bakeSmartStamp(stamp: Stamp, layerId: string, target: Tileset, tilesets: readonly Tileset[], profile?: BrushProfile): TilesetImage | Promise<TilesetImage> {
  const sources = new Map<string, { tileset: Tileset; pixels: PixelImage }>();
  const bounds = new Map<string, { x: number; y: number; right: number; bottom: number }>();
  for (const b of nineSliceBlits(stamp, layerId, target.tileWidth, target.tileHeight, target.generated?.innerCorner)) {
    const tileset = tilesets.find(t => t.id === b.tile.tilesetId);
    if (!tileset) throw new Error(`Missing source image: ${b.tile.tilesetId}`);
    const x = tileset.margin + b.tile.tileId % tileset.columns * (tileset.tileWidth + tileset.spacing);
    const y = tileset.margin + Math.floor(b.tile.tileId / tileset.columns) * (tileset.tileHeight + tileset.spacing);
    const old = bounds.get(tileset.id);
    bounds.set(tileset.id, { x: Math.min(old?.x ?? x, x), y: Math.min(old?.y ?? y, y), right: Math.max(old?.right ?? 0, x + tileset.tileWidth), bottom: Math.max(old?.bottom ?? 0, y + tileset.tileHeight) });
  }
  for (const [id, rect] of bounds) {
    const tileset = tilesets.find(t => t.id === id), image = getTilesetImage(id);
    if (!tileset || !image) throw new Error(`Missing source image: ${tileset?.imagePath ?? id}`);
    sources.set(id, { tileset, pixels: profileSpan(profile, "bake.sourcePixels", () => tilesetPixels(image.bitmap, { x: rect.x, y: rect.y, width: rect.right - rect.x, height: rect.bottom - rect.y })) });
  }
  const p = profileSpan(profile, "bake.assemblies", () => rasterizeSmartStamp(stamp, layerId, target, sources, target.generated?.innerCorner));
  const pixels = new ImageData(new Uint8ClampedArray(p.data), p.width, p.height);
  const preview = new OffscreenCanvas(p.width, p.height), ctx = preview.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.putImageData(pixels, 0, 0);
  const bitmap = profileSpan(profile, "bitmap.decode", () => preview.transferToImageBitmap());
  return deferredTilesetImage(target.id, bitmap, async () => {
    // Use the original HTML canvas encoder and input pixels, only when PNG bytes are requested.
    const canvas = document.createElement("canvas"); canvas.width = p.width; canvas.height = p.height;
    const encoder = canvas.getContext("2d"); if (!encoder) throw new Error("Canvas unavailable");
    encoder.putImageData(pixels, 0, 0);
    const blob = await profileAwait(profile, "png.encode", () => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG encoding failed")), "image/png")));
    return new Uint8Array(await blob.arrayBuffer());
  });
}
