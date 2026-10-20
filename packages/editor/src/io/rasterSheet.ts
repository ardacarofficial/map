import type { PixelDirtyRect, RasterAssets } from '@smap/core';
import type { TilesetBitmap, TilesetImage } from '../state/tilesetImages';

interface Target { ref: WeakRef<HTMLCanvasElement>; pending: Set<number> }
/** Retained view surfaces. File suppliers still capture immutable raster snapshots. */
export class RasterSheet {
  readonly #targets = new Set<Target>();
  readonly #targetStates = new WeakMap<HTMLCanvasElement, Target>();
  readonly #empty = new Set<number>();
  readonly #alphaDirty = new Set<number>();
  #capacity = 0;
  #bitmap: TilesetBitmap | undefined;
  #snapshot!: RasterAssets;
  readonly #id: string;
  constructor(id: string) { this.#id = id; }
  update(snapshot: RasterAssets, rects: readonly PixelDirtyRect[]): void {
    this.#snapshot = snapshot;
    for (const rect of rects) this.#alphaDirty.add(rect.tileId);
    for (const target of this.#targets) {
      if (!target.ref.deref()) { this.#targets.delete(target); continue; }
      for (const rect of rects) target.pending.add(rect.tileId);
    }
  }
  emptyTiles(): ReadonlySet<number> {
    const info = this.#snapshot.info(this.#id);
    if (info) {
      const capacity = info.columns * info.rows;
      for (let id = this.#capacity; id < capacity; id++) this.#empty.add(id);
      for (let id = capacity; id < this.#capacity; id++) this.#empty.delete(id);
      this.#capacity = capacity;
      for (const id of this.#alphaDirty) {
        if (id >= capacity) { this.#empty.delete(id); continue; }
        const tile = this.#snapshot.getTile(this.#id, id);
        if (!tile || !tile.data.some((v, i) => (i & 3) === 3 && v !== 0)) this.#empty.add(id); else this.#empty.delete(id);
      }
      this.#alphaDirty.clear();
    }
    // A new O(1) view identity lets React notice alpha changes without copying
    // every empty slot or reading back an entire canvas.
    const entries = this.#empty;
    return { get size() { return entries.size; }, has: id => entries.has(id), forEach: cb => entries.forEach(v => cb(v, v, entries)), entries: () => entries.entries(), keys: () => entries.keys(), values: () => entries.values(), [Symbol.iterator]: () => entries.values() };
  }
  bitmap(): TilesetBitmap {
    this.#bitmap ??= Object.assign(document.createElement('canvas'), { close() {} });
    this.draw(this.#bitmap as HTMLCanvasElement);
    return this.#bitmap;
  }
  draw(canvas: HTMLCanvasElement): void {
    const info = this.#snapshot.info(this.#id); if (!info) return;
    const { tileWidth: tw, tileHeight: th, columns, rows, tileCount } = info;
    let target = this.#targetStates.get(canvas);
    if (!target) { target = { ref: new WeakRef(canvas), pending: new Set() }; this.#targets.add(target); this.#targetStates.set(canvas, target); }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    if (canvas.width !== tw * columns || canvas.height !== th * rows) {
      // Growth/shrink keeps the existing surface on the canvas/GPU side. Never
      // reconstruct old tile pages merely because an append crossed a row.
      let retained: HTMLCanvasElement | undefined;
      if (canvas.dataset.rasterReady) {
        retained = document.createElement('canvas'); retained.width = canvas.width; retained.height = canvas.height;
        retained.getContext('2d')?.drawImage(canvas, 0, 0);
      }
      canvas.width = tw * columns; canvas.height = th * rows;
      if (retained) ctx.drawImage(retained, 0, 0);
      else for (let id = 0; id < tileCount; id++) target.pending.add(id);
    } else if (!target.pending.size && !canvas.dataset.rasterReady) {
      for (let id = 0; id < tileCount; id++) target.pending.add(id);
    }
    for (const id of target.pending) {
      const tile = this.#snapshot.getTile(this.#id, id), x = (id % columns) * tw, y = Math.floor(id / columns) * th;
      if (tile) ctx.putImageData(new ImageData(new Uint8ClampedArray(tile.data), tw, th), x, y);
      else ctx.clearRect(x, y, tw, th);
    }
    target.pending.clear(); canvas.dataset.rasterReady = 'true';
  }
}
const sheets = new WeakMap<TilesetImage, RasterSheet>();
export function attachRasterSheet(image: TilesetImage, sheet: RasterSheet): void { sheets.set(image, sheet); }
export function drawRasterSheet(image: TilesetImage, canvas: HTMLCanvasElement): boolean {
  const sheet = sheets.get(image); if (!sheet) return false;
  sheet.draw(canvas); return true;
}

export function rasterEmptyTiles(image: TilesetImage | undefined): ReadonlySet<number> | undefined { return image ? sheets.get(image)?.emptyTiles() : undefined; }
