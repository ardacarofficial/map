import { pngHash } from "./pngHash";
import type { PngBytes } from "../io/fileData";
/**
 * Registry of decoded tileset images, keyed by tileset id. Filled by the UI
 * when a PNG is dropped or a project is opened; read by the canvas to build
 * textures. Kept outside React/zustand state because images are large and
 * not serializable.
 */

export interface TilesetImage {
  tilesetId: string;
  bitmap: ImageBitmap;
  /** Original PNG bytes, or undefined until a generated image is saved/exported. */
  bytes: Uint8Array | undefined;
}

const encoders = new WeakMap<TilesetImage, () => Promise<Uint8Array>>();
const encoding = new WeakMap<TilesetImage, Promise<Uint8Array>>();
export function deferredTilesetImage(tilesetId: string, bitmap: ImageBitmap, encode: () => Promise<Uint8Array>): TilesetImage {
  const image: TilesetImage = { tilesetId, bitmap, bytes: undefined };
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

type Listener = (tilesetId: string) => void;

const images = new Map<string, TilesetImage>();
const listeners = new Set<Listener>();

export function getTilesetImage(tilesetId: string): TilesetImage | undefined {
  return images.get(tilesetId);
}

export function allTilesetImages(): IterableIterator<TilesetImage> {
  return images.values();
}

export function setTilesetImage(image: TilesetImage): void {
  images.get(image.tilesetId)?.bitmap.close();
  images.set(image.tilesetId, image);
  // Start provenance hashing alongside image publication, before a user picks a smart source.
  if (image.bytes) void pngHash(image.bytes).catch(() => {});
  for (const l of listeners) l(image.tilesetId);
}

export function clearTilesetImages(): void {
  for (const img of images.values()) img.bitmap.close();
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
export function removeTilesetImage(id: string): void { images.get(id)?.bitmap.close(); images.delete(id); }
