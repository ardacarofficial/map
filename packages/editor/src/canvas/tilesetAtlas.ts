/**
 * GPU atlas for one tileset: copies every tile from the decoded image into
 * extruded slots (see `atlas.ts`) on ≤ 4096 px pages, uploaded with nearest
 * filtering and no mipmaps.
 */
import { tileCount, tileRect, type Tileset } from "@smap/core";
import { CanvasSource, Rectangle, Texture } from "pixi.js";

import { layoutAtlas, tileBlits, tileUV, type AtlasLayout, type TileUV } from "./atlas";
import { releaseTexture } from "./releaseTexture";

export class TilesetAtlas {
  readonly tilesetId: string;
  readonly layout: AtlasLayout;
  /** One texture per page. */
  readonly pages: Texture[];
  readonly #tileTextures = new Map<number, Texture>();

  constructor(tileset: Tileset, image: CanvasImageSource) {
    this.tilesetId = tileset.id;
    this.layout = layoutAtlas(tileCount(tileset), tileset.tileWidth, tileset.tileHeight);
    const canvases = this.layout.pages.map((size) => {
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      return canvas;
    });
    const contexts = canvases.map((c) => {
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("2D canvas context unavailable");
      ctx.imageSmoothingEnabled = false;
      return ctx;
    });
    const { pad } = this.layout;
    this.layout.slots.forEach((slot, tileId) => {
      const r = tileRect(tileset, tileId);
      const ctx = contexts[slot.page]!;
      for (const b of tileBlits(r.x, r.y, r.width, r.height, slot.x, slot.y, pad)) {
        ctx.drawImage(image, b.sx, b.sy, b.sw, b.sh, b.dx, b.dy, b.dw, b.dh);
      }
    });
    this.pages = canvases.map(
      (resource) =>
        new Texture({
          source: new CanvasSource({
            resource,
            scaleMode: "nearest",
            autoGenerateMipmaps: false,
            antialias: false,
          }),
        }),
    );
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
