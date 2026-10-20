/**
 * One low-resolution picture of the whole map (all visible tile layers),
 * kept in a 2D canvas. The minimap draws it, and the canvas renders the map
 * from the very same picture when zoomed far out (CLAUDE.md v0.5: "uzak
 * zoom'da aynı küçük resim kullanılır").
 *
 * Updated incrementally: store events mark chunks dirty, {@link update}
 * recomposites them (from k×k box-filtered tile blocks) within a time
 * budget. Layer list / visibility / opacity changes, resizes and new tileset
 * images rebuild everything (rare).
 */
import {
  CHUNK_SIZE,
  isTileLayer,
  parseChunkKey,
  tileCount,
  tileRect,
  type ChunkKey,
  type MapStore,
  type StoreChangeEvent,
} from "@smap/core";

import { RECENT_THUMB_PX, thumbnailSnapshots } from "./thumbnailSnapshotBridge";
import { chunkSpan, thumbnailScale } from "./minimapMath";
import { compositeChunk, tileThumb, type ChunkLayerInput, type Pixels } from "./thumbnailRaster";

export type ThumbImageLookup = (tilesetId: string) => (CanvasImageSource & { width: number; height: number }) | undefined;

/** Overview px rectangle (x1 / y1 exclusive). */
export interface ThumbRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class MapThumbnail {
  readonly canvas = document.createElement("canvas");
  readonly #ctx: CanvasRenderingContext2D;
  readonly #store: MapStore;
  readonly #images: ThumbImageLookup;
  readonly #onChange: () => void;
  readonly #maxPx: number | undefined;
  readonly #unsubscribe: () => void;
  /** Thumbnail px per cell. */
  #scale = 1;
  /** Tile block size (px per cell of the composited chunks). */
  #k = 1;
  #queue = new Set<ChunkKey>();
  #clearAll = true;
  /** Tileset pixels (read once per image). */
  readonly #tilesetPixels = new Map<string, Pixels | null>();
  /** Palette index → k×k block (`null` = not drawable). */
  #blocks: (Uint8ClampedArray | null)[] = [];
  #scratch: HTMLCanvasElement | null = null;
  /** Reused chunk image (one per k). */
  #image: ImageData | null = null;
  /** A bounded CPU projection of the overview, updated in the same chunk slices.
   * Keeps the historical per-chunk scaling/filtering of recent pictures. */
  readonly #recent = document.createElement("canvas");
  readonly #recentCtx = this.#recent.getContext("2d", { willReadFrequently: true });
  #recentScale = 1;
  #overviewK = 1;
  #overviewBlocks: (Uint8ClampedArray | null)[] = [];
  #overviewImage: ImageData | null = null;
  #unpublish: (() => void) | null = null;
  #missingImages = false;
  /**
   * CPU copy of the picture at 1 px per {@link #overviewCells}² cells (≤ 1024 px a
   * side, straight alpha), filled from the same chunk composites. The minimap
   * scales this down. Its canonical tile blocks use the recent-picture scale
   * (1…4), so translucent layer composition matches the saved pictures rather
   * than averaging the more detailed LOD composition. Reading back or rescaling
   * the GPU canvas (up to 4096² px)
   * after every brush stroke kept the GPU busy and delayed frames.
   */
  #overview: Pixels = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  /** Cells per overview px (fractional on tiny maps to preserve tile detail). */
  #overviewCells = 1;
  /** Overview px redrawn since the last {@link takeDirty} (`"all"`: everything). */
  #dirty: ThumbRect | "all" | null = "all";
  /** Bumps whenever pixels change. */
  version = 0;
  /** Bumps when the canvas is resized (textures must be recreated). */
  sizeVersion = 0;

  /** `maxPx`: longest side of the picture (default `THUMB_MAX_PX`; the world view uses smaller ones). */
  constructor(store: MapStore, images: ThumbImageLookup, onChange: () => void, maxPx?: number) {
    this.#store = store;
    this.#maxPx = maxPx;
    this.#images = images;
    this.#onChange = onChange;
    // GPU-backed (the far-zoom LOD texture copies it every slice). Nothing reads it back:
    // the minimap uses the CPU overview below.
    const ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.#ctx = ctx;
    this.#resize();
    this.#rebuildAll();
    this.#unsubscribe = store.subscribe((e) => this.#handle(e));
  }

  /** Thumbnail px per map cell. */
  get scale(): number {
    return this.#scale;
  }

  /** True while chunks wait to be redrawn. */
  get pending(): boolean {
    return this.#clearAll || this.#queue.size > 0;
  }

  /** A tileset image (re)arrived: its blocks are rebuilt and the whole picture redrawn. */
  imageChanged(tilesetId: string): void {
    this.#tilesetPixels.delete(tilesetId);
    this.#blocks = [];
    this.#overviewBlocks = [];
    this.#missingImages = false;
    this.#rebuildAll();
  }

  /**
   * Redraws dirty chunks for at most `budgetMs`. Returns true when pixels
   * changed (upload the texture / redraw the minimap).
   */
  update(budgetMs: number): boolean {
    if (!this.pending) return false;
    const t0 = performance.now();
    if (this.#clearAll) {
      this.#clearAll = false;
      this.#dirty = "all";
      this.#ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.#overview.data.fill(0);
      this.#recentCtx?.clearRect(0, 0, this.#recent.width, this.#recent.height);
    }
    for (const key of this.#queue) {
      this.#queue.delete(key);
      this.#drawChunk(key);
      if (performance.now() - t0 > budgetMs) break;
    }
    this.version++;
    if (!this.pending && this.#unpublish) thumbnailSnapshots.changed();
    return true;
  }

  /** The CPU overview of the picture (see {@link takeDirty}). */
  get overview(): Pixels {
    return this.#overview;
  }

  /** Register only the active canvas; disposal cannot unregister a newer canvas. */
  publishSnapshot(project: object, level: string): void {
    this.#unpublish?.();
    this.#unpublish = thumbnailSnapshots.register({
      state: () => ({ project, level, revision: this.#store.revision, version: this.version, pending: this.pending || this.#missingImages }),
      snapshot: () => this.snapshot(),
    });
  }

  /** Own at most 192² pixels per requested snapshot; never read the GPU LOD canvas. */
  snapshot(): Pixels | undefined {
    if (this.pending || this.#missingImages || !this.#recentCtx) return undefined;
    const image = this.#recentCtx.getImageData(0, 0, this.#recent.width, this.#recent.height);
    return { data: image.data, width: image.width, height: image.height };
  }

  /**
   * The part of {@link overview} redrawn since the last call (`"all"` after a
   * full rebuild or resize, null when nothing changed). For a consumer that
   * keeps a scaled copy (the minimap) and refreshes only what changed.
   */
  takeDirty(): ThumbRect | "all" | null {
    const d = this.#dirty;
    this.#dirty = null;
    return d;
  }

  #markDirty(x0: number, y0: number, x1: number, y1: number): void {
    const d = this.#dirty;
    if (d === "all") return;
    if (!d) this.#dirty = { x0, y0, x1, y1 };
    else {
      d.x0 = Math.min(d.x0, x0);
      d.y0 = Math.min(d.y0, y0);
      d.x1 = Math.max(d.x1, x1);
      d.y1 = Math.max(d.y1, y1);
    }
  }

  destroy(): void {
    this.#unpublish?.();
    this.#unpublish = null;
    this.#unsubscribe();
    this.#queue.clear();
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.#recent.width = 0;
    this.#recent.height = 0;
  }

  // ------------------------------------------------------------------ internals

  #handle(e: StoreChangeEvent): void {
    const doc = this.#store.document;
    if (e.structure.includes("map")) this.#resize();
    if (e.structure.includes("layers") || e.structure.includes("map") || e.structure.includes("tilesets")) {
      this.#rebuildAll();
      return;
    }
    let changed = false;
    for (const { layerId, chunks } of e.cells) {
      if (!isTileLayer(doc.getLayer(layerId))) continue;
      for (const k of chunks) this.#queue.add(k);
      changed = changed || chunks.length > 0;
    }
    if (changed) this.#onChange();
  }

  #resize(): void {
    const map = this.#store.document.map;
    this.#scale = thumbnailScale(map.width, map.height, this.#maxPx);
    this.#k = this.#scale >= 1 ? this.#scale : 1;
    this.#blocks = [];
    this.#overviewBlocks = [];
    this.#recentScale = thumbnailScale(map.width, map.height, RECENT_THUMB_PX);
    this.#overviewK = Math.max(1, this.#recentScale);
    this.#recent.width = Math.max(1, Math.ceil(map.width * this.#recentScale));
    this.#recent.height = Math.max(1, Math.ceil(map.height * this.#recentScale));
    this.canvas.width = Math.max(1, Math.ceil(map.width * this.#scale));
    this.canvas.height = Math.max(1, Math.ceil(map.height * this.#scale));
    const longest = Math.max(map.width, map.height);
    this.#overviewCells = longest <= 1024 ? 1 / this.#overviewK : longest <= 2048 ? 2 : 4;
    const ow = Math.ceil(map.width / this.#overviewCells);
    const oh = Math.ceil(map.height / this.#overviewCells);
    this.#overview = { data: new Uint8ClampedArray(ow * oh * 4), width: ow, height: oh };
    this.#dirty = "all";
    this.sizeVersion++;
  }

  #rebuildAll(): void {
    this.#clearAll = true;
    this.#missingImages = false;
    this.#blocks = [];
    this.#overviewBlocks = [];
    this.#queue.clear();
    for (const layer of this.#store.document.layers) {
      if (!isTileLayer(layer)) continue;
      for (const c of layer.chunks()) this.#queue.add(c.key);
    }
    this.#onChange();
  }

  #drawChunk(key: ChunkKey): void {
    const doc = this.#store.document;
    const map = doc.map;
    const { cx, cy } = parseChunkKey(key);
    if (cx < 0 || cy < 0 || cx * CHUNK_SIZE >= map.width || cy * CHUNK_SIZE >= map.height) return;
    const inputs: ChunkLayerInput[] = [];
    let any = false;
    for (const layer of doc.layers) {
      if (!isTileLayer(layer) || !layer.visible || layer.opacity <= 0) continue;
      const data = layer.getChunkByKey(key)?.data;
      if (data) any = true;
      inputs.push({ data, opacity: layer.opacity });
    }
    const xs = chunkSpan(cx, CHUNK_SIZE, this.#scale, map.width);
    const ys = chunkSpan(cy, CHUNK_SIZE, this.#scale, map.height);
    const ctx = this.#ctx;
    if (!any) {
      ctx.clearRect(xs.from, ys.from, xs.to - xs.from, ys.to - ys.from);
      this.#writeOverview(cx, cy, null, 0);
      this.#writeRecent(cx, cy, null);
      return;
    }
    const k = this.#k;
    const side = CHUNK_SIZE * k;
    if (this.#image?.width !== side) this.#image = new ImageData(side, side);
    const image = this.#image;
    compositeChunk(inputs, k, (i) => this.#block(i), image.data);
    // One canonical CPU composition serves both minimap overview and recents.
    // Reuse the LOD chunk when scales coincide; otherwise compose at the old
    // recent scale. Averaging k=4 after alpha blending is not pixel equivalent.
    const ok = this.#overviewK;
    let overviewImage = image;
    if (ok !== k) {
      const os = CHUNK_SIZE * ok;
      if (this.#overviewImage?.width !== os) this.#overviewImage = new ImageData(os, os);
      overviewImage = this.#overviewImage;
      compositeChunk(inputs, ok, (i) => this.#block(i, true), overviewImage.data);
    }
    this.#writeOverview(cx, cy, overviewImage.data, ok);
    this.#writeRecent(cx, cy, overviewImage);
    if (this.#scale >= 1) {
      // Integer scale: chunk edges are exact; putImageData clips at the canvas edge.
      ctx.putImageData(image, cx * side, cy * side);
      return;
    }
    // Huge maps: composite at 1 px per cell, then scale down into the chunk's span.
    const scratch = (this.#scratch ??= document.createElement("canvas"));
    scratch.width = side;
    scratch.height = side;
    scratch.getContext("2d")!.putImageData(image, 0, 0);
    const cellsW = Math.min(CHUNK_SIZE, map.width - cx * CHUNK_SIZE);
    const cellsH = Math.min(CHUNK_SIZE, map.height - cy * CHUNK_SIZE);
    ctx.clearRect(xs.from, ys.from, xs.to - xs.from, ys.to - ys.from);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(scratch, 0, 0, cellsW * k, cellsH * k, xs.from, ys.from, xs.to - xs.from, ys.to - ys.from);
  }

  /** Identical chunk bounds, filtering and transparent clear as the old 192px renderer. */
  #writeRecent(cx: number, cy: number, image: ImageData | null): void {
    const ctx = this.#recentCtx;
    if (!ctx) return;
    const map = this.#store.document.map;
    const scale = this.#recentScale;
    const xs = chunkSpan(cx, CHUNK_SIZE, scale, map.width);
    const ys = chunkSpan(cy, CHUNK_SIZE, scale, map.height);
    ctx.clearRect(xs.from, ys.from, xs.to - xs.from, ys.to - ys.from);
    if (!image) return;
    if (scale >= 1) {
      ctx.putImageData(image, cx * image.width, cy * image.height);
      return;
    }
    const scratch = (this.#scratch ??= document.createElement("canvas"));
    scratch.width = image.width;
    scratch.height = image.height;
    scratch.getContext("2d")!.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(scratch, 0, 0, Math.min(CHUNK_SIZE, map.width - cx * CHUNK_SIZE), Math.min(CHUNK_SIZE, map.height - cy * CHUNK_SIZE),
      xs.from, ys.from, xs.to - xs.from, ys.to - ys.from);
  }

  /** Box-filters a chunk composite (`k` px per cell; null = empty chunk) into the overview. */
  #writeOverview(cx: number, cy: number, px: Uint8ClampedArray | null, k: number): void {
    const ov = this.#overview;
    const c = this.#overviewCells;
    const per = CHUNK_SIZE / c;
    const ox0 = cx * per;
    const oy0 = cy * per;
    const ox1 = Math.min(ov.width, ox0 + per);
    const oy1 = Math.min(ov.height, oy0 + per);
    if (ox1 <= ox0 || oy1 <= oy0) return;
    this.#markDirty(ox0, oy0, ox1, oy1);
    const out = ov.data;
    if (!px) {
      for (let y = oy0; y < oy1; y++) out.fill(0, (y * ov.width + ox0) * 4, (y * ov.width + ox1) * 4);
      return;
    }
    const side = CHUNK_SIZE * k;
    const block = c * k;
    const n = block * block;
    if (block === 1) {
      // The usual canonical overview: copy exact straight-alpha rows, no filter.
      for (let y = oy0; y < oy1; y++) {
        const start = (y - oy0) * side * 4;
        out.set(px.subarray(start, start + (ox1 - ox0) * 4), (y * ov.width + ox0) * 4);
      }
      return;
    }
    for (let y = oy0; y < oy1; y++) {
      for (let x = ox0; x < ox1; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        const sx = (x - ox0) * block;
        const sy = (y - oy0) * block;
        for (let yy = 0; yy < block; yy++) {
          let i = ((sy + yy) * side + sx) * 4;
          for (let xx = 0; xx < block; xx++, i += 4) {
            const pa = px[i + 3]!;
            if (pa === 0) continue;
            r += px[i]! * pa;
            g += px[i + 1]! * pa;
            b += px[i + 2]! * pa;
            a += pa;
          }
        }
        const o = (y * ov.width + x) * 4;
        if (a === 0) {
          out[o + 3] = 0;
          continue;
        }
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
        out[o + 3] = a / n;
      }
    }
  }

  #block(paletteIndex: number, overview = false): Uint8ClampedArray | undefined {
    const blocks = overview ? this.#overviewBlocks : this.#blocks;
    const cached = blocks[paletteIndex];
    if (cached !== undefined) return cached ?? undefined;
    const doc = this.#store.document;
    const entry = doc.palette.get(paletteIndex);
    let block: Uint8ClampedArray | null = null;
    const tileset = entry ? doc.getTileset(entry.tilesetId) : undefined;
    if (entry && tileset && entry.tileId >= 0 && entry.tileId < tileCount(tileset)) {
      const tile = tileset.edited ? this.#store.rasterAssets.getTile(entry.tilesetId, entry.tileId) : undefined;
      if (tile) block = tileThumb({ ...tile, data: new Uint8ClampedArray(tile.data) }, { x: 0, y: 0, width: tile.width, height: tile.height }, overview ? this.#overviewK : this.#k);
      else {
        const pixels = this.#pixels(entry.tilesetId);
        if (pixels) block = tileThumb(pixels, tileRect(tileset, entry.tileId), overview ? this.#overviewK : this.#k);
      }
    }
    // A tileset whose image has not arrived yet is not cached as "not drawable".
    if (block || !entry || this.#tilesetPixels.has(entry.tilesetId)) blocks[paletteIndex] = block;
    return block ?? undefined;
  }

  #pixels(tilesetId: string): Pixels | null {
    if (this.#tilesetPixels.has(tilesetId)) {
      const pixels = this.#tilesetPixels.get(tilesetId) ?? null;
      if (!pixels) this.#missingImages = true;
      return pixels;
    }
    const image = this.#images(tilesetId);
    if (!image) {
      this.#missingImages = true;
      return null;
    }
    let pixels: Pixels | null = null;
    try {
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height);
        pixels = { data: data.data, width: data.width, height: data.height };
      }
    } catch (error) {
      console.error(`[canvas] thumbnail: cannot read tileset "${tilesetId}"`, error);
    }
    if (!pixels) this.#missingImages = true;
    this.#tilesetPixels.set(tilesetId, pixels);
    return pixels;
  }
}
