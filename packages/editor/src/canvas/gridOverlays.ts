import {
  CHUNK_AREA,
  CHUNK_SHIFT,
  CHUNK_SIZE,
  chunkKey,
  isGridLayer,
  type MapStore,
  type StoreChangeEvent,
} from "@smap/core";
import { CanvasSource, Container, Sprite, Texture } from "pixi.js";

import type { CellRegion } from "../state/editorStore";
import {
  COLL_FORCED_PASSABLE,
  COLL_FORCED_SOLID,
  COLL_NONE,
  ChunkCache,
  collisionChunkRaster,
  collisionInvalidation,
  PATTERN_SCALE,
  patternImage,
  type CodePattern,
} from "./gridRaster";
import { releaseTexture } from "./releaseTexture";

/** Colours the overlays need (from `CANVAS_COLORS` / theme tokens). */
export interface GridOverlayColors {
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

}

interface ChunkImage {
  readonly raster: Uint8Array;
  /** Null while the raster is fully transparent. */
  view: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: Texture; sprite: Sprite } | null;
}

/** Turns a chunk's code raster into RGBA pixels (`scale` px per cell), or null when fully transparent. */
type ImageFn = (raster: Uint8Array, cx: number, cy: number) => Uint8ClampedArray | null;

/** One overlay: a container of per-chunk sprites plus its raster cache. */
class ChunkOverlay {
  readonly root = new Container();
  readonly cache = new ChunkCache<ChunkImage>();
  #image: ImageFn;
  readonly #scale: number;

  /** `scale`: texture pixels per cell (1 = flat colours; more for patterns). */
  constructor(image: ImageFn, scale = 1, visible = false) {
    this.#image = image;
    this.#scale = scale;
    this.root.visible = visible;
  }

  setImage(image: ImageFn): void {
    this.#image = image;
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
    const pixels = this.#image(img.raster, cx, cy);
    if (!pixels) {
      disposeImage(img);
      return img;
    }
    const side = CHUNK_SIZE * this.#scale;
    if (!img.view) {
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d");
      if (!ctx) return img;
      // Patterns: crisp when magnified, mipmapped when far out (no moiré); flat colours: nearest.
      const patterned = this.#scale > 1;
      const texture = new Texture({
        source: new CanvasSource({
          resource: canvas,
          scaleMode: "nearest",
          ...(patterned ? { minFilter: "linear" as const, mipmapFilter: "linear" as const } : {}),
          autoGenerateMipmaps: patterned,
          antialias: false,
        }),
      });
      const sprite = new Sprite(texture);
      sprite.position.set(cx * CHUNK_SIZE * tileW, cy * CHUNK_SIZE * tileH);
      sprite.width = CHUNK_SIZE * tileW;
      sprite.height = CHUNK_SIZE * tileH;
      this.root.addChild(sprite);
      img.view = { canvas, ctx, texture, sprite };
    }
    img.view.ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), side, side), 0, 0);
    img.view.texture.source.update();
    return img;
  }
}

function disposeImage(img: ChunkImage): void {
  if (!img.view) return;
  img.view.sprite.destroy();
  releaseTexture(img.view.texture);
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
  readonly #collision: ChunkOverlay;
  readonly #unsubscribe: () => void;
  readonly #onChange: () => void;

  constructor(store: MapStore, colors: GridOverlayColors, onChange: () => void) {
    this.#store = store;
    this.#onChange = onChange;
    this.#collision = new ChunkOverlay(collisionImage(colors), PATTERN_SCALE);
    this.root.addChild(this.#collision.root);
    this.#unsubscribe = store.subscribe((e) => this.#handle(e));
  }

  setColors(colors: GridOverlayColors): void {
    this.#collision.setImage(collisionImage(colors));
  }

  /** Brings the visible chunks up to date. Call once per frame before rendering. */
  update(s: GridOverlayState): void {
    const { tileWidth: tw, tileHeight: th } = this.#store.document.map;
    const range = chunkRange(s.visible);

    this.#collision.root.visible = s.showCollision;
    if (s.showCollision) {
      const doc = this.#store.document;
      this.#collision.update(range, tw, th, (cx, cy, out) => {
        return collisionChunkRaster(doc, cx, cy, out);
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
    this.#collision.destroy();
    this.root.destroy({ children: true });
  }

  #handle(e: StoreChangeEvent): void {
    const doc = this.#store.document;
    const coll = collisionInvalidation(e, (id) => {
      const l = doc.getLayer(id);
      return isGridLayer(l);
    });
    if (coll.all || coll.keys.length > 0) this.#collision.cache.invalidate(coll);
    if (coll.all || coll.keys.length > 0) this.#onChange();
  }
}

/**
 * Collision overlay patterns: solid = diagonal hatch, forced solid (a
 * collision layer) = cross hatch, forced passable = dots in the passable
 * colour. The crisp edge outline is drawn by the overlay renderer.
 */
export function collisionPatterns(c: GridOverlayColors): (CodePattern | null)[] {
  const out: (CodePattern | null)[] = [];
  out[COLL_NONE] = null;
  out[COLL_FORCED_SOLID] = { color: c.collisionSolid, fillAlpha: c.collisionSolidAlpha * 0.8, markAlpha: Math.min(1, c.collisionSolidAlpha * 2.8), kind: "x" };
  out[COLL_FORCED_PASSABLE] = { color: c.collisionPassable, fillAlpha: c.collisionPassableAlpha * 0.4, markAlpha: Math.min(1, c.collisionPassableAlpha * 2), kind: "dots" };
  return out;
}

function collisionImage(c: GridOverlayColors): ImageFn {
  const patterns = collisionPatterns(c);
  return (raster, cx, cy) => patternImage(raster, patterns, cx, cy);
}
