import { createPixelAtlasSource, markPixelAtlasDirty } from "./pixelUpload";
/**
 * GPU atlas for one tileset: copies every tile from the decoded image into
 * extruded slots (see `atlas.ts`) on ≤ 4096 px pages, uploaded with nearest
 * filtering and no mipmaps.
 */
import { MAX_EDITED_TILES, tileCount, tileRect, type PixelRect, type PixelDirtyRect, type Tileset } from "@smap/core";
import { CanvasSource, Rectangle, Texture } from "pixi.js";

import { layoutAtlas, dirtyTileBlits, tileBlits, tileUV, type AtlasLayout, type TileUV } from "./atlas";
import { releaseTexture } from "./releaseTexture";

/** Edited CPU pages can be supplied one tile at a time, without assembling a sheet. */
export type AtlasImage = CanvasImageSource | ((tileId: number) => CanvasImageSource | undefined);
export class TilesetAtlas {
  readonly tilesetId: string;
  readonly layout: AtlasLayout;
  /** One texture per page. */
  readonly pages: Texture[];
  #previewCanvas: HTMLCanvasElement | undefined;
  readonly #canvases: HTMLCanvasElement[] = [];
  readonly #tileTextures = new Map<number, Texture>();

  constructor(tileset: Tileset, image: AtlasImage) {
    this.tilesetId = tileset.id;
    this.layout = tileset.edited
      ? layoutAtlas(MAX_EDITED_TILES, tileset.tileWidth, tileset.tileHeight, 2, Math.min(4096, Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(tileset.tileWidth, tileset.tileHeight) + 4)))))
      : layoutAtlas(tileCount(tileset), tileset.tileWidth, tileset.tileHeight);
    const usedPages = tileset.edited ? this.layout.slots[tileset.edited.nextTileId - 1]!.page + 1 : this.layout.pages.length;
    const canvases = this.layout.pages.slice(0, usedPages).map((size) => {
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      return canvas;
    });
    this.#canvases.push(...canvases);
    const contexts = canvases.map((c) => {
      const ctx = c.getContext("2d", tileset.edited ? { willReadFrequently: true } : undefined);
      if (!ctx) throw new Error("2D canvas context unavailable");
      ctx.imageSmoothingEnabled = false;
      return ctx;
    });
    const { pad } = this.layout;
    this.layout.slots.forEach((slot, tileId) => {
      if (tileId >= (tileset.edited?.nextTileId ?? tileCount(tileset))) return;
      const source = typeof image === 'function' ? image(tileId) : image;
      if (!source) return;
      const r = typeof image === 'function' ? { x: 0, y: 0, width: tileset.tileWidth, height: tileset.tileHeight } : tileRect(tileset, tileId);
      const ctx = contexts[slot.page]!;
      for (const b of tileBlits(r.x, r.y, r.width, r.height, slot.x, slot.y, pad)) {
        ctx.drawImage(source, b.sx, b.sy, b.sw, b.sh, b.dx, b.dy, b.dw, b.dh);
      }
    });
    this.pages = canvases.map(
      (resource) =>
        new Texture({
          source: tileset.edited ? createPixelAtlasSource(resource) : new CanvasSource({
            resource,
            scaleMode: "nearest",
            autoGenerateMipmaps: false,
            antialias: false,
          }),
        }),
    );
  }

  /** Stable slot UVs; only touched tiles and their extrusion are redrawn.
   * Edited CanvasSources use pixelUpload.ts for exact dirty GPU subrectangles.
   * Retained canvases are also the context-restoration source of truth.
   */
  updateTiles(rects: readonly PixelDirtyRect[], tileset: Tileset, image: AtlasImage): number {
    const dirty = new Set<number>();
    const byTile = new Map<number, PixelRect>();
    for (const r of rects) { const old = byTile.get(r.tileId); const x = Math.min(old?.x ?? r.x, r.x), y = Math.min(old?.y ?? r.y, r.y); byTile.set(r.tileId, { x, y, width: Math.max(old ? old.x + old.width : 0, r.x + r.width) - x, height: Math.max(old ? old.y + old.height : 0, r.y + r.height) - y }); }
    for (const [tileId, rect] of byTile) {
      const slot = this.layout.slots[tileId]; if (!slot) continue;
      while (this.#canvases.length <= slot.page) {
        const size = this.layout.pages[this.#canvases.length]!;
        const resource = document.createElement("canvas"); resource.width = size.width; resource.height = size.height;
        this.#canvases.push(resource);
        this.pages.push(new Texture({ source: createPixelAtlasSource(resource) }));
      }
      const ctx = this.#canvases[slot.page]!.getContext("2d", { willReadFrequently: true })!;
      const { tileW: w, tileH: h, pad } = this.layout;
      ctx.imageSmoothingEnabled = false;
      if (tileId < (tileset.edited?.nextTileId ?? tileCount(tileset))) {
        const source = typeof image === 'function' ? image(tileId) : image;
        if (!source) continue;
        const r = typeof image === 'function' ? { x: 0, y: 0 } : tileRect(tileset, tileId);
        for (const b of dirtyTileBlits(r.x, r.y, w, h, slot.x, slot.y, pad, rect)) { ctx.clearRect(b.dx, b.dy, b.dw, b.dh); ctx.drawImage(source, b.sx, b.sy, b.sw, b.sh, b.dx, b.dy, b.dw, b.dh); markPixelAtlasDirty(this.pages[slot.page]!.source, { x: b.dx, y: b.dy, width: b.dw, height: b.dh }); }
      } else { ctx.clearRect(slot.x - pad, slot.y - pad, w + 2 * pad, h + 2 * pad); markPixelAtlasDirty(this.pages[slot.page]!.source, { x: slot.x - pad, y: slot.y - pad, width: w + 2 * pad, height: h + 2 * pad }); }
      dirty.add(slot.page);
    }
    let pageBytesTouched = 0;
    for (const page of dirty) { this.pages[page]!.source.update(); const c = this.#canvases[page]!; pageBytesTouched += c.width * c.height * 4; }
    return pageBytesTouched;
  }

  /** Live preview of one uniquely owned edited slot, without touching chunk geometry. */
  previewTile(tileId: number, pixels: Uint8Array, dirty?: PixelRect): number {
    const slot = this.layout.slots[tileId]; if (!slot || !this.#canvases[slot.page]) return 0;
    const { tileW: w, tileH: h, pad } = this.layout;
    const tile = this.#previewCanvas ??= document.createElement("canvas");
    if (tile.width !== w) tile.width = w; if (tile.height !== h) tile.height = h;
    tile.getContext("2d", { willReadFrequently: true })!.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
    const ctx = this.#canvases[slot.page]!.getContext("2d", { willReadFrequently: true })!;
    for (const b of dirtyTileBlits(0, 0, w, h, slot.x, slot.y, pad, dirty ?? { x: 0, y: 0, width: w, height: h })) { ctx.clearRect(b.dx, b.dy, b.dw, b.dh); ctx.drawImage(tile, b.sx, b.sy, b.sw, b.sh, b.dx, b.dy, b.dw, b.dh); markPixelAtlasDirty(this.pages[slot.page]!.source, { x: b.dx, y: b.dy, width: b.dw, height: b.dh }); }
    this.pages[slot.page]!.source.update();
    const page = this.#canvases[slot.page]!; return page.width * page.height * 4;
  }

  uv(tileId: number): TileUV | undefined {
    return tileUV(this.layout, tileId);
  }

  /** Texture of a single tile (for the brush preview). Cached; destroyed with the atlas. */
  tileTexture(tileId: number): Texture | undefined {
    let tex = this.#tileTextures.get(tileId);
    if (tex) return tex;
    const slot = this.layout.slots[tileId];
    if (!slot) return undefined;
    tex = new Texture({
      source: this.pages[slot.page]!.source,
      frame: new Rectangle(slot.x, slot.y, this.layout.tileW, this.layout.tileH),
    });
    this.#tileTextures.set(tileId, tex);
    return tex;
  }

  destroy(): void {
    for (const t of this.#tileTextures.values()) t.destroy(false);
    this.#tileTextures.clear();
    for (const p of this.pages) releaseTexture(p);
  }
}
