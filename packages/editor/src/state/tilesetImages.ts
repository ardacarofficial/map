import { tilesetPixels } from "./tilesetPixels";
import type { PixelDirtyRect, Tileset } from "@smap/core";
import { pngHash } from "./pngHash";
import type { PngBytes } from "../io/fileData";
/**
 * Registry of decoded tileset images, keyed by tileset id. Filled by the UI
 * when a PNG is dropped or a project is opened; read by the canvas to build
 * textures. Kept outside React/zustand state because images are large and
 * not serializable.
 */

export type TilesetBitmap = ImageBitmap | (HTMLCanvasElement & { close(): void });

export interface TilesetImage {
  tilesetId: string;
  bitmap: TilesetBitmap;
  /** Original PNG bytes, or undefined until a generated image is saved/exported. */
  bytes: Uint8Array | undefined;
}

const bitmapClosers = new WeakMap<TilesetImage, () => void>();
const encoders = new WeakMap<TilesetImage, () => Promise<Uint8Array>>();
const encoding = new WeakMap<TilesetImage, Promise<Uint8Array>>();
export function deferredTilesetImage(tilesetId: string, bitmap: TilesetBitmap | (() => TilesetBitmap), encode: () => Promise<Uint8Array>): TilesetImage {
  let materialized: TilesetBitmap | undefined = typeof bitmap === 'function' ? undefined : bitmap;
  const image: TilesetImage = { tilesetId, get bitmap() { return materialized ??= (bitmap as () => TilesetBitmap)(); }, bytes: undefined };
  bitmapClosers.set(image, () => { materialized?.close(); });
  encoders.set(image, encode); return image;
}
export function tilesetImageBytes(image: TilesetImage): Promise<Uint8Array> {
  if (image.bytes) return Promise.resolve(image.bytes);
  const hit = encoding.get(image); if (hit) return hit;
  const encode = encoders.get(image);
  if (!encode) return Promise.reject(new Error(`Missing PNG encoder: ${image.tilesetId}`));
  const pending = Promise.resolve().then(encode).then(bytes => { image.bytes = bytes; encoders.delete(image); return bytes; });
  encoding.set(image, pending);
  void pending.finally(() => { if (encoding.get(image) === pending) encoding.delete(image); }).catch(() => {});
  return pending;
}
/** The deferred supplier captures this revision, even if a newer image replaces the registry entry. */
export function tilesetPngSource(id: string): PngBytes | undefined {
  const image = getTilesetImage(id); return image ? image.bytes ?? (() => tilesetImageBytes(image)) : undefined;
}

/** World lifetime is independent of the active map/store. */
let worldVersion = 0;
export function tilesetWorldVersion(): number { return worldVersion; }
export interface SourceVersion { readonly content: string; readonly grid: string }
const contentVersions = new WeakMap<TilesetImage, string>();
const leases = new WeakMap<TilesetImage, number>();
const retired = new WeakSet<TilesetImage>();
const closed = new WeakSet<TilesetImage>();
function closeImage(image: TilesetImage): void {
  if (closed.has(image) || leases.get(image)) return;
  closed.add(image);
  const close = bitmapClosers.get(image);
  if (close) close(); else if ("close" in image.bitmap) image.bitmap.close();
}
export function retainTilesetImage(image: TilesetImage): () => void {
  leases.set(image, (leases.get(image) ?? 0) + 1);
  let released=false;
  return () => { if(released)return;released=true;leases.set(image, (leases.get(image) ?? 1)-1);if(retired.has(image))closeImage(image); };
}
/** Once per decoded snapshot; invisible RGB is excluded from premultiplied content. */
export function imageContentVersion(image: TilesetImage): string {
  const hit=contentVersions.get(image);if(hit)return hit;
  let bytes=image.bytes ?? new Uint8Array(), geometry="encoded";
  if (image.bitmap.width && image.bitmap.height && typeof document !== "undefined" && typeof document.createElement === "function") {
    const {width,height}=image.bitmap,pixels=tilesetPixels(image.bitmap,{x:0,y:0,width,height});
    bytes=new Uint8Array(pixels.data.length);
    for(let i=0;i<bytes.length;i+=4){const a=pixels.data[i+3]!;for(let c=0;c<3;c++)bytes[i+c]=Math.round(pixels.data[i+c]!*a/255);bytes[i+3]=a;}
    geometry=`${width}x${height}`;
  }
  let a=2166136261,b=0x9e3779b9;
  for(const v of bytes){a=Math.imul(a^v,16777619)>>>0;b=Math.imul(b^v,2246822519)>>>0;}
  const version=`${geometry}:${bytes.length}:${a.toString(16)}:${b.toString(16)}`;contentVersions.set(image,version);return version;
}
export function tilesetSourceVersion(tileset: Tileset, image: TilesetImage): SourceVersion {
 return {content:imageContentVersion(image),grid:JSON.stringify([tileset.tileWidth,tileset.tileHeight,tileset.margin,tileset.spacing,tileset.columns,tileset.rows])};
}
export function sourceVersionMatches(id:string, version:SourceVersion, tileset:Tileset|undefined): boolean {
 const image=getTilesetImage(id);if(!image||!tileset)return false;
 const current=tilesetSourceVersion(tileset,image);return current.content===version.content&&current.grid===version.grid;
}

type Listener = (tilesetId: string, pixelRects?: readonly PixelDirtyRect[]) => void;

const images = new Map<string, TilesetImage>();
const listeners = new Set<Listener>();

export function getTilesetImage(tilesetId: string): TilesetImage | undefined {
  return images.get(tilesetId);
}

export function allTilesetImages(): IterableIterator<TilesetImage> {
  return images.values();
}

export function setTilesetImage(image: TilesetImage, pixelRects?: readonly PixelDirtyRect[]): void {
  const previous=images.get(image.tilesetId);
  if(previous === image)return;
  if (!pixelRects) imageContentVersion(image);
  if(previous){retired.add(previous);closeImage(previous);}
  images.set(image.tilesetId, image);
  // Start provenance hashing alongside image publication, before a user picks a smart source.
  if (image.bytes) void pngHash(image.bytes).catch(() => {});
  for (const l of listeners) l(image.tilesetId, pixelRects);
}

export function clearTilesetImages(): void {
  worldVersion++;
  for (const img of images.values()) { retired.add(img); closeImage(img); }
  images.clear();
}

/** Called whenever a tileset image is added or replaced. */
export function onTilesetImage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Tells image listeners (canvas atlases, thumbnails) to rebuild `tilesetId`
 * although its image did not change: its grid (tile size, margin, spacing)
 * did, so the tiles are cut from other pixels.
 */
export function notifyTilesetImage(tilesetId: string): void {
  if (!images.has(tilesetId)) return;
  for (const l of listeners) l(tilesetId);
}

/** Releases a staged asset when an atomic bake fails. */
export function removeTilesetImage(id: string): void { const image=images.get(id);if(image){retired.add(image);closeImage(image);}images.delete(id);for(const l of listeners)l(id); }
