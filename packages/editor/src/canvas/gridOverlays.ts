/**
 * World-space overlays of grid layers:
 * - terrain tint: the painted cells of the active terrain layer, faintly in
 *   the accent colour (the derived tile layer shows the real look);
 * - collision: derived collision (solid tiles + collision-layer exceptions).
 *
 * Each is one 32×32-pixel texture per chunk (one pixel per cell) drawn as a
 * nearest-filtered sprite scaled to the chunk: one draw call per chunk,
 * crisp at every zoom. Rasters are built lazily for visible chunks only and
 * cached; store changes mark the affected chunks stale (see `gridRaster.ts`).
 */
import {
  CHUNK_AREA,
  CHUNK_SHIFT,
  CHUNK_SIZE,
  chunkKey,
  isGridLayer,
  solidPaletteMask,
  type GridLayer,
  type MapStore,
  type StoreChangeEvent,
} from "@smap/core";
import { CanvasSource, Container, Sprite, Texture } from "pixi.js";

import type { CellRegion } from "../state/editorStore";
import {
  COLL_FORCED_PASSABLE,
  COLL_FORCED_SOLID,
  COLL_NONE,
  COLL_SOLID,
  ChunkCache,
  collisionChunkRaster,
  collisionInvalidation,
  layerInvalidation,
  paintedChunkRaster,
  rasterImage,
  rgba,
  type CodeColors,
} from "./gridRaster";

/** Colours the overlays need (from `CANVAS_COLORS` / theme tokens). */
export interface GridOverlayColors {
  readonly terrainTint: number;
  readonly terrainTintAlpha: number;
  readonly collisionSolid: number;
  readonly collisionSolidAlpha: number;
  readonly collisionPassable: number;
  readonly collisionPassableAlpha: number;
}

/** What to show this frame. */
export interface GridOverlayState {
  /** Cells on screen. */
  readonly visible: CellRegion;
  readonly showCollision: boolean;
  /** Terrain layer to tint (the active one), or null. */
  readonly terrainLayer: GridLayer | null;
}

interface ChunkImage {
  readonly raster: Uint8Array;
  /** Null while the raster is fully transparent. */
  view: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: Texture; sprite: Sprite } | null;
}

/** One overlay: a container of per-chunk sprites plus its raster cache. */
class ChunkOverlay {
  readonly root = new Container();
  readonly cache = new ChunkCache<ChunkImage>();
  #colors: CodeColors;

  constructor(colors: CodeColors, visible = false) {
    this.#colors = colors;
    this.root.visible = visible;
  }

  setColors(colors: CodeColors): void {
    this.#colors = colors;
    this.cache.invalidate({ all: true, keys: [] });
  }

  /** Ensures the visible chunks are current and hides the others. */
  update(range: ChunkRange, tileW: number, tileH: number, raster: (cx: number, cy: number, out: Uint8Array) => Uint8Array): void {
    const shown = new Set<ChunkImage>();
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        const img = this.cache.get(chunkKey(cx, cy), (prev) => this.#build(prev, cx, cy, tileW, tileH, raster));
        if (img.view) shown.add(img);
      }
    }
    for (const img of this.cache.values()) if (img.view) img.view.sprite.visible = shown.has(img);
  }

  /** Raster of a chunk if it is cached and current (cells around the view). */
  current(cx: number, cy: number): Uint8Array | undefined {
    const key = chunkKey(cx, cy);
    return this.cache.isStale(key) ? undefined : this.cache.peek(key)?.raster;
  }

  clear(): void {
    this.cache.clear(disposeImage);
  }

  destroy(): void {
    this.clear();
    this.root.destroy({ children: true });
  }

  #build(
    prev: ChunkImage | undefined,
    cx: number,
    cy: number,
    tileW: number,
    tileH: number,
    raster: (cx: number, cy: number, out: Uint8Array) => Uint8Array,
  ): ChunkImage {
    const img: ChunkImage = prev ?? { raster: new Uint8Array(CHUNK_AREA), view: null };
    raster(cx, cy, img.raster);
    const pixels = rasterImage(img.raster, this.#colors);
    if (!pixels) {
      disposeImage(img);
      return img;
    }
    if (!img.view) {
      const canvas = document.createElement("canvas");
      canvas.width = CHUNK_SIZE;
      canvas.height = CHUNK_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return img;
      const texture = new Texture({
        source: new CanvasSource({ resource: canvas, scaleMode: "nearest", autoGenerateMipmaps: false, antialias: false }),
      });
      const sprite = new Sprite(texture);
      sprite.position.set(cx * CHUNK_SIZE * tileW, cy * CHUNK_SIZE * tileH);
      sprite.width = CHUNK_SIZE * tileW;
      sprite.height = CHUNK_SIZE * tileH;
      this.root.addChild(sprite);
      img.view = { canvas, ctx, texture, sprite };
    }
    img.view.ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), CHUNK_SIZE, CHUNK_SIZE), 0, 0);
    img.view.texture.source.update();
    return img;
  }
}

function disposeImage(img: ChunkImage): void {
  if (!img.view) return;
  img.view.sprite.destroy();
  img.view.texture.destroy(true);
  img.view = null;
}

interface ChunkRange {
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
}

/** Chunks covering `r` grown by one cell (outlines need the neighbours). */
function chunkRange(r: CellRegion): ChunkRange {
  return {
    cx0: (r.x - 1) >> CHUNK_SHIFT,
    cy0: (r.y - 1) >> CHUNK_SHIFT,
    cx1: (r.x + r.width) >> CHUNK_SHIFT,
    cy1: (r.y + r.height) >> CHUNK_SHIFT,
  };
}

export class GridOverlays {
  /** World-space root (above the layers, below the tool previews). */
  readonly root = new Container();
  readonly #store: MapStore;
  readonly #terrain: ChunkOverlay;
  readonly #collision: ChunkOverlay;
  #terrainLayer: GridLayer | null = null;
  #solid: Uint8Array | null = null;
  readonly #unsubscribe: () => void;
  readonly #onChange: () => void;

  constructor(store: MapStore, colors: GridOverlayColors, onChange: () => void) {
    this.#store = store;
    this.#onChange = onChange;
    this.#terrain = new ChunkOverlay(terrainColors(colors));
    this.#collision = new ChunkOverlay(collisionColors(colors));
    this.root.addChild(this.#terrain.root, this.#collision.root);
    this.#unsubscribe = store.subscribe((e) => this.#handle(e));
  }

  setColors(colors: GridOverlayColors): void {
    this.#terrain.setColors(terrainColors(colors));
    this.#collision.setColors(collisionColors(colors));
  }

  /** Brings the visible chunks up to date. Call once per frame before rendering. */
  update(s: GridOverlayState): void {
    const { tileWidth: tw, tileHeight: th } = this.#store.document.map;
    const range = chunkRange(s.visible);

    const terrain = s.terrainLayer && s.terrainLayer.visible ? s.terrainLayer : null;
    if (terrain !== this.#terrainLayer) {
      this.#terrain.clear();
      this.#terrainLayer = terrain;
    }
    this.#terrain.root.visible = terrain !== null;
    if (terrain) this.#terrain.update(range, tw, th, (cx, cy, out) => paintedChunkRaster(terrain.getChunk(cx, cy)?.data, out));

    this.#collision.root.visible = s.showCollision;
    if (s.showCollision) {
      const doc = this.#store.document;
      this.#collision.update(range, tw, th, (cx, cy, out) => {
        this.#solid ??= solidPaletteMask(doc);
        return collisionChunkRaster(doc, cx, cy, this.#solid, out);
      });
    }
  }

  /** Collision code of a cell from the cache (`COLL_NONE` when not built). */
  collisionCode(x: number, y: number): number {
    const r = this.#collision.current(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    return r ? r[((y & 31) << CHUNK_SHIFT) | (x & 31)]! : COLL_NONE;
  }

  destroy(): void {
    this.#unsubscribe();
    this.#terrain.destroy();
    this.#collision.destroy();
    this.root.destroy({ children: true });
  }

  #handle(e: StoreChangeEvent): void {
    const doc = this.#store.document;
    const coll = collisionInvalidation(e, (id) => {
      const l = doc.getLayer(id);
      return isGridLayer(l) && l.role === "terrain";
    });
    if (coll.all || coll.keys.length > 0) this.#collision.cache.invalidate(coll);
    if (e.structure.length > 0) this.#solid = null; // tilesets (solid flags) or palette grew
    if (this.#terrainLayer) {
      const t = layerInvalidation(e, this.#terrainLayer.id);
      if (t.all || t.keys.length > 0) this.#terrain.cache.invalidate(t);
    }
    if (coll.all || coll.keys.length > 0) this.#onChange();
  }
}

function terrainColors(c: GridOverlayColors): CodeColors {
  return [null, rgba(c.terrainTint, c.terrainTintAlpha)];
}

function collisionColors(c: GridOverlayColors): CodeColors {
  const out: (readonly [number, number, number, number] | null)[] = [];
  out[COLL_NONE] = null;
  out[COLL_SOLID] = rgba(c.collisionSolid, c.collisionSolidAlpha);
  out[COLL_FORCED_SOLID] = rgba(c.collisionSolid, Math.min(1, c.collisionSolidAlpha * 1.5));
  out[COLL_FORCED_PASSABLE] = rgba(c.collisionPassable, c.collisionPassableAlpha);
  return out;
}
