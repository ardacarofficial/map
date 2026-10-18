/**
 * Registry of decoded tileset images, keyed by tileset id. Filled by the UI
 * when a PNG is dropped or a project is opened; read by the canvas to build
 * textures. Kept outside React/zustand state because images are large and
 * not serializable.
 */

export interface TilesetImage {
  tilesetId: string;
  bitmap: ImageBitmap;
  /** Original PNG bytes, needed to write `tilesets/<file>.png` on save. */
  bytes: Uint8Array;
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
