/**
 * Pure atlas layout with edge extrusion.
 *
 * Every tile is copied into the atlas with `pad` pixels of its own border
 * repeated around it ("extrusion"). Even with nearest filtering, sampling at
 * a quad edge can round onto the neighbouring texel when zoomed or panned by
 * fractional amounts; with extrusion that neighbour is the same colour, so
 * no seams appear between tiles.
 */

export interface AtlasTileSlot {
  /** Atlas page index. */
  readonly page: number;
  /** Top-left of the tile's content (excluding padding) on its page. */
  readonly x: number;
  readonly y: number;
}

export interface AtlasPageSize {
  readonly width: number;
  readonly height: number;
}

export interface AtlasLayout {
  readonly tileW: number;
  readonly tileH: number;
  readonly pad: number;
  /** Tiles per atlas row. */
  readonly columns: number;
  readonly pages: readonly AtlasPageSize[];
  /** Slot per tile id. */
  readonly slots: readonly AtlasTileSlot[];
}

/** Atlas pages never exceed this size (CLAUDE.md: 4096 or 8192). */
export const MAX_ATLAS_PAGE = 4096;
/** Extrusion in pixels on each side of a tile. */
export const ATLAS_PAD = 2;

/**
 * Lays out `tileCount` tiles of `tileW`×`tileH` on pages of at most
 * `maxPage`×`maxPage`, each slot `(tileW + 2*pad)`×`(tileH + 2*pad)`.
 *
 * @throws RangeError when a single padded tile does not fit on a page.
 */
export function layoutAtlas(
  tileCount: number,
  tileW: number,
  tileH: number,
  pad = ATLAS_PAD,
  maxPage = MAX_ATLAS_PAGE,
): AtlasLayout {
  const slotW = tileW + pad * 2;
  const slotH = tileH + pad * 2;
  if (slotW > maxPage || slotH > maxPage) {
    throw new RangeError(`Tile ${tileW}x${tileH} (+${pad}px padding) does not fit an atlas page of ${maxPage}px`);
  }
  const count = Math.max(0, Math.floor(tileCount));
  const columns = Math.max(1, Math.min(count, Math.floor(maxPage / slotW)));
  const rowsPerPage = Math.floor(maxPage / slotH);
  const perPage = columns * rowsPerPage;
  const slots: AtlasTileSlot[] = [];
  const pages: AtlasPageSize[] = [];
  for (let id = 0; id < count; id++) {
    const page = Math.floor(id / perPage);
    const local = id - page * perPage;
    const col = local % columns;
    const row = Math.floor(local / columns);
    slots.push({ page, x: col * slotW + pad, y: row * slotH + pad });
  }
  const pageCount = Math.ceil(count / perPage);
  for (let p = 0; p < pageCount; p++) {
    const tilesOnPage = Math.min(perPage, count - p * perPage);
    const rows = Math.ceil(tilesOnPage / columns);
    pages.push({ width: columns * slotW, height: rows * slotH });
  }
  return { tileW, tileH, pad, columns, pages, slots };
}

/** One `drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh)` call. */
export interface Blit {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/**
 * Blits that copy the tile at (`sx`, `sy`) in the source image to content
 * position (`dx`, `dy`) and extrude its 1-pixel border `pad` pixels outward
 * (4 edges stretched, 4 corners filled with the corner pixel). Requires
 * image smoothing off, so stretching a 1-pixel strip repeats it exactly.
 */
export function tileBlits(sx: number, sy: number, w: number, h: number, dx: number, dy: number, pad: number): Blit[] {
  const blits: Blit[] = [{ sx, sy, sw: w, sh: h, dx, dy, dw: w, dh: h }];
  if (pad <= 0) return blits;
  const r = sx + w - 1;
  const b = sy + h - 1;
  // edges
  blits.push({ sx, sy, sw: w, sh: 1, dx, dy: dy - pad, dw: w, dh: pad }); // top
  blits.push({ sx, sy: b, sw: w, sh: 1, dx, dy: dy + h, dw: w, dh: pad }); // bottom
  blits.push({ sx, sy, sw: 1, sh: h, dx: dx - pad, dy, dw: pad, dh: h }); // left
  blits.push({ sx: r, sy, sw: 1, sh: h, dx: dx + w, dy, dw: pad, dh: h }); // right
  // corners
  blits.push({ sx, sy, sw: 1, sh: 1, dx: dx - pad, dy: dy - pad, dw: pad, dh: pad });
  blits.push({ sx: r, sy, sw: 1, sh: 1, dx: dx + w, dy: dy - pad, dw: pad, dh: pad });
  blits.push({ sx, sy: b, sw: 1, sh: 1, dx: dx - pad, dy: dy + h, dw: pad, dh: pad });
  blits.push({ sx: r, sy: b, sw: 1, sh: 1, dx: dx + w, dy: dy + h, dw: pad, dh: pad });
  return blits;
}

/** Normalized UV rectangle of a tile on its page. */
export interface TileUV {
  readonly page: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** UVs of `tileId`, exactly on the content edges (padding stays outside). `undefined` for unknown ids. */
export function tileUV(layout: AtlasLayout, tileId: number): TileUV | undefined {
  const slot = layout.slots[tileId];
  if (!slot) return undefined;
  const page = layout.pages[slot.page]!;
  return {
    page: slot.page,
    u0: slot.x / page.width,
    v0: slot.y / page.height,
    u1: (slot.x + layout.tileW) / page.width,
    v1: (slot.y + layout.tileH) / page.height,
  };
}

/** Intersect each extrusion blit in source space, preserving stretched edge pixels. */
export function dirtyTileBlits(sx: number, sy: number, w: number, h: number, dx: number, dy: number, pad: number, dirty: { x: number; y: number; width: number; height: number }): Blit[] {
  const out: Blit[] = [];
  for (const b of tileBlits(sx, sy, w, h, dx, dy, pad)) {
    const x = Math.max(b.sx, sx + dirty.x), y = Math.max(b.sy, sy + dirty.y);
    const width = Math.min(b.sx + b.sw, sx + dirty.x + dirty.width) - x;
    const height = Math.min(b.sy + b.sh, sy + dirty.y + dirty.height) - y;
    if (width <= 0 || height <= 0) continue;
    const scaleX = b.dw / b.sw, scaleY = b.dh / b.sh;
    out.push({ sx: x, sy: y, sw: width, sh: height, dx: b.dx + (x - b.sx) * scaleX, dy: b.dy + (y - b.sy) * scaleY, dw: width * scaleX, dh: height * scaleY });
  }
  return out;
}
