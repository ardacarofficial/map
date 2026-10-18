/** Rasterizes core's fixed slot ABI. Source pixels are immutable; no canvas resampling or blending. */
import { nineSliceBlits, orientPoint, type NineSliceInnerCorner, type Stamp, type Tileset } from "@smap/core";
import { getTilesetImage, type TilesetImage } from "../../state/tilesetImages";

export interface PixelImage { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }
export function rasterizeSmartStamp(stamp: Stamp, layerId: string, target: Tileset, sources: ReadonlyMap<string, { tileset: Tileset; pixels: PixelImage }>, inner?: NineSliceInnerCorner): PixelImage {
  const width = target.columns * target.tileWidth, height = target.rows * target.tileHeight;
  const data = new Uint8ClampedArray(width * height * 4);
  for (const b of nineSliceBlits(stamp, layerId, target.tileWidth, target.tileHeight, inner)) {
    const source = sources.get(b.tile.tilesetId);
    if (!source) throw new Error(`Missing source image: ${b.tile.tilesetId}`);
    const { tileset: t, pixels: p } = source;
    const ox = t.margin + (b.tile.tileId % t.columns) * (t.tileWidth + t.spacing);
    const oy = t.margin + Math.floor(b.tile.tileId / t.columns) * (t.tileHeight + t.spacing);
    if (ox + t.tileWidth > p.width || oy + t.tileHeight > p.height) throw new Error(`Source image grid does not fit: ${t.imagePath}`);
    const r = b.sourceRect, d = b.destinationRect;
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
export function imagePixels(bitmap: ImageBitmap): PixelImage {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
export async function pngHash(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function bakeSmartStamp(stamp: Stamp, layerId: string, target: Tileset, tilesets: readonly Tileset[]): Promise<TilesetImage> {
  const sources = new Map<string, { tileset: Tileset; pixels: PixelImage }>();
  for (const b of nineSliceBlits(stamp, layerId, target.tileWidth, target.tileHeight, target.generated?.innerCorner)) {
    if (sources.has(b.tile.tilesetId)) continue;
    const tileset = tilesets.find(t => t.id === b.tile.tilesetId), image = getTilesetImage(b.tile.tilesetId);
    if (!tileset || !image) throw new Error(`Missing source image: ${tileset?.imagePath ?? b.tile.tilesetId}`);
    sources.set(tileset.id, { tileset, pixels: imagePixels(image.bitmap) });
  }
  const p = rasterizeSmartStamp(stamp, layerId, target, sources, target.generated?.innerCorner);
  const canvas = document.createElement("canvas"); canvas.width = p.width; canvas.height = p.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG encoding failed")), "image/png"));
  return { tilesetId: target.id, bytes: new Uint8Array(await blob.arrayBuffer()), bitmap: await createImageBitmap(blob) };
}
