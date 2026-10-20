import { decodeSourcePng } from './sourcePng';
import { decodeEditedPng } from "./editedPng";
/** Raster → immutable canvas/PNG snapshots. Encoding is deferred until save/export.
 * Old content-addressed files are deliberately retained: backups and undo can refer to them.
 */
import { encodeRgbaPng, tileRect, type MapStore, type PixelDirtyRect, type RasterImage, type Tileset } from '@smap/core';
import { allTilesetImages, deferredTilesetImage, getTilesetImage, onTilesetImage, setTilesetImage, type TilesetImage } from '../state/tilesetImages';
import { tilesetPixels } from '../state/tilesetPixels';
import type { PixelSource } from '../canvas/pixelEditing';

const decodedSources = new WeakMap<object, ReturnType<typeof decodeSourcePng> | null>();
/** Decode only on image load/watch publication, never on a pointer sample. */
function warmSourceImage(image: TilesetImage | undefined): void {
  if (!image || decodedSources.has(image)) return;
  try { decodedSources.set(image, image.bytes ? decodeSourcePng(image.bytes) : null); }
  catch { decodedSources.set(image, null); }
}
for (const image of allTilesetImages()) warmSourceImage(image);
onTilesetImage(id => warmSourceImage(getTilesetImage(id)));
const sourceCache = new WeakMap<object, Map<string, RasterImage>>();
export const readPixelSource: PixelSource = (tileset, tileId) => {
  const image = getTilesetImage(tileset.id); if (!image) return undefined;
  let tiles = sourceCache.get(image); if (!tiles) { tiles = new Map(); sourceCache.set(image, tiles); }
  const key = `${tileset.tileWidth}:${tileset.tileHeight}:${tileset.margin}:${tileset.spacing}:${tileset.columns}:${tileId}`;
  const cached = tiles.get(key); if (cached) return cached;
  const rect = tileRect(tileset, tileId);
  const decoded = decodedSources.get(image);
  let data: Uint8Array;
  if (decoded && rect.x + rect.width <= decoded.width && rect.y + rect.height <= decoded.height) {
    data = new Uint8Array(rect.width * rect.height * 4);
    for (let y=0;y<rect.height;y++) { const p=((rect.y+y)*decoded.width+rect.x)*4; data.set(decoded.data.subarray(p,p+rect.width*4),y*rect.width*4); }
  } else data = new Uint8Array(tilesetPixels(image.bitmap, rect).data);
  for (let p = 0; p < data.length; p += 4) if (!data[p + 3]) data.fill(0, p, p + 3);
  const raster = { width: rect.width, height: rect.height, data, revision: 0 };
  tiles.set(key, raster); return raster;
};
export function loadEditedRaster(store: MapStore, tileset: Tileset, bytes: Uint8Array): void {
  if (!tileset.edited) return;
  const width = tileset.columns * tileset.tileWidth, height = tileset.rows * tileset.tileHeight;
  const pixels = decodeEditedPng(bytes);
  if (pixels.width !== width || pixels.height !== height) throw new Error(`Invalid edited PNG dimensions: ${tileset.imagePath}`);
  store.dispatch({ type: 'loadRasterAsset', asset: { assetId: tileset.id, tileWidth: tileset.tileWidth, tileHeight: tileset.tileHeight, columns: tileset.columns, rows: tileset.rows, data: new Uint8Array(pixels.data) } });
}
/** Publish synchronously before canvas subscribers run; this also handles undo/redo/rollback. */
export function installPixelAssets(store: MapStore): () => void {
  return store.subscribe(event => {
    if (!event.pixelRects.length || typeof document === 'undefined') return;
    const byAsset = new Map<string, PixelDirtyRect[]>();
    for (const rect of event.pixelRects) { const list = byAsset.get(rect.assetId) ?? []; list.push(rect); byAsset.set(rect.assetId, list); }
    for (const [id, rects] of byAsset) {
      if (!store.document.getTileset(id)?.edited) continue;
      const raster = store.rasterAssets.getAsset(id); if (!raster) continue;
      const canvas = document.createElement('canvas'); canvas.width = raster.width; canvas.height = raster.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) continue;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
      setTilesetImage(deferredTilesetImage(id, Object.assign(canvas, { close() {} }), async () => encodeRgbaPng(raster.width, raster.height, raster.data)), rects);
    }
  });
}
