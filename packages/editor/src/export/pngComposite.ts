/**
 * PNG export, the pure half: turns core's draw list into a flat list of 2D
 * canvas operations (alpha changes and transformed image draws), and guards
 * the output size. `pngRender.ts` replays the list on a real canvas.
 */
import { cellPaletteIndex, FLIP_D, FLIP_H, FLIP_V, isTileLayer, isValidTileId, tileRect, type DrawList, type MapDocument } from "@smap/core";

/** Export scale factors offered in the dialog. */
export const PNG_SCALES = [1, 2, 4] as const;
export type PngScale = (typeof PNG_SCALES)[number];

/** Largest side Chromium allows for a canvas (and most image viewers open). */
export const PNG_MAX_SIDE = 16384;
/** Largest pixel count we try to allocate (256 MP ≈ 1 GiB of RGBA). */
export const PNG_MAX_PIXELS = 256 * 1024 * 1024;

/** `ctx.setTransform(a, b, c, d, e, f)` arguments. */
export type Transform = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export type CanvasOp =
  | { readonly kind: "alpha"; readonly alpha: number }
  | {
      readonly kind: "draw";
      readonly tilesetId: string;
      /** Source rectangle in the tileset image. */
      readonly sx: number;
      readonly sy: number;
      readonly sw: number;
      readonly sh: number;
      /** Maps tile-local space (0..dw, 0..dh) to the output image (scale and flips included). */
      readonly transform: Transform;
      /** Size drawn in tile-local space (the source tile's size, unscaled; see {@link tileTransform}). */
      readonly dw: number;
      readonly dh: number;
    };

/**
 * Transform that places a tile at `(x, y)` in map pixels, scaled by `scale`,
 * in one of the eight orientations (Tiled's rule, see core's `DrawItem`):
 * `flipD` first swaps the tile's x and y, then `flipH` / `flipV` mirror it
 * inside its own `width × height` destination rectangle (already transposed
 * when `flipD`). A mirror maps the tile's left edge to the rectangle's right
 * edge (negative scale plus an offset of the full width), so the tile stays
 * in its cell.
 *
 * Tile-local space is the source tile's: `(0..height, 0..width)` when
 * `flipD`, `(0..width, 0..height)` otherwise.
 */
export function tileTransform(
  x: number,
  y: number,
  width: number,
  height: number,
  flipH: boolean,
  flipV: boolean,
  scale: number,
  flipD = false,
): Transform {
  const sx = flipH ? -scale : scale;
  const sy = flipV ? -scale : scale;
  const e = (flipH ? x + width : x) * scale;
  const f = (flipV ? y + height : y) * scale;
  // x' = a·u + c·v + e, y' = b·u + d·v + f; the transpose swaps which of u, v feeds x'.
  return flipD ? [0, sy, sx, 0, e, f] : [sx, 0, 0, sy, e, f];
}

/** Canvas operations for `list` at `scale`, bottom layer first. Empty layers emit nothing. */
export function compositeOps(list: DrawList, scale: number): CanvasOp[] {
  const ops: CanvasOp[] = [];
  let alpha = 1;
  for (const layer of list.layers) {
    if (layer.items.length === 0) continue;
    if (layer.opacity !== alpha) {
      ops.push({ kind: "alpha", alpha: layer.opacity });
      alpha = layer.opacity;
    }
    for (const item of layer.items) {
      const { src, dest } = item;
      ops.push({
        kind: "draw",
        tilesetId: item.tileset.id,
        sx: src.x,
        sy: src.y,
        sw: src.width,
        sh: src.height,
        transform: tileTransform(dest.x, dest.y, dest.width, dest.height, item.flipH, item.flipV, scale, item.flipD),
        dw: item.flipD ? dest.height : dest.width,
        dh: item.flipD ? dest.width : dest.height,
      });
    }
  }
  return ops;
}

/** Output size in pixels of a `width × height` map image at `scale`. */
export function pngSize(width: number, height: number, scale: number): { width: number; height: number } {
  return { width: width * scale, height: height * scale };
}

/** Whether a `width × height` image at `scale` fits the canvas limits. */
export function pngFits(width: number, height: number, scale: number): boolean {
  const size = pngSize(width, height, scale);
  return (
    size.width > 0 &&
    size.height > 0 &&
    size.width <= PNG_MAX_SIDE &&
    size.height <= PNG_MAX_SIDE &&
    size.width * size.height <= PNG_MAX_PIXELS
  );
}

/** The largest offered scale that fits (`null` when even 1× is too big). */
export function largestFittingScale(width: number, height: number): PngScale | null {
  for (let i = PNG_SCALES.length - 1; i >= 0; i--) {
    const scale = PNG_SCALES[i]!;
    if (pngFits(width, height, scale)) return scale;
  }
  return null;
}

/** Ids of tilesets the ops draw from (to check that every image is loaded). */
export function opsTilesets(ops: readonly CanvasOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) if (op.kind === "draw") ids.add(op.tilesetId);
  return ids;
}

/** Region replay without a full-map cell/item/operation array. Oversized art can
 * originate left of or below the crop. Chunk rows are merged in row-major order,
 * preserving the normal exporter order even where oversized sprites overlap. */
export function* regionCompositeOps(doc: MapDocument, region: { x:number; y:number; width:number; height:number }, scale: number, layerIds?: readonly string[]): Generator<CanvasOp> {
  for(const op of regionCompositeSteps(doc,region,scale,layerIds))if(op)yield op;
}

/** Cooperative traversal also reports bounded scan progress through empty or
 * invalid stored cells. Normal exporters can ignore those progress markers. */
export function* regionCompositeSteps(doc: MapDocument, region: { x:number; y:number; width:number; height:number }, scale: number, layerIds?: readonly string[]): Generator<CanvasOp|undefined> {
  const map=doc.map,left=region.x*map.tileWidth,top=region.y*map.tileHeight;
  const right=(region.x+region.width)*map.tileWidth,bottom=(region.y+region.height)*map.tileHeight;
  const reach=doc.tilesets.reduce((n,t)=>Math.max(n,t.tileWidth,t.tileHeight),0);
  const xMin=Math.max(0,region.x-Math.ceil(reach/map.tileWidth)),xMax=Math.min(map.width,region.x+region.width);
  const yMin=Math.max(0,region.y),yMax=Math.min(map.height,region.y+region.height+Math.ceil(reach/map.tileHeight));
  let scanned=0;
  for(const layer of doc.layers){
    yield undefined;
    if(!isTileLayer(layer)||!layer.visible||layer.opacity<=0||(layerIds&&!layerIds.includes(layer.id)))continue;
    const chunks=[...layer.chunks()].filter(c=>c.cx*32<xMax&&(c.cx+1)*32>xMin&&c.cy*32<yMax&&(c.cy+1)*32>yMin).sort((a,b)=>a.cy-b.cy||a.cx-b.cx);
    yield {kind:"alpha",alpha:layer.opacity};
    for(let start=0;start<chunks.length;){
      let end=start+1;while(end<chunks.length&&chunks[end]!.cy===chunks[start]!.cy)end++;
      const cy=chunks[start]!.cy;
      for(let row=0;row<32;row++){
        const y=cy*32+row;if(y<yMin||y>=yMax)continue;
        for(let c=start;c<end;c++){
          const chunk=chunks[c]!;
          for(let col=0;col<32;col++){
            if((scanned++&1023)===0)yield undefined;
            const x=chunk.cx*32+col;if(x<xMin||x>=xMax)continue;
            const cell=chunk.data[row*32+col]!;if(!cell)continue;
            const entry=doc.palette.get(cellPaletteIndex(cell));if(!entry)continue;
            const tileset=doc.getTileset(entry.tilesetId);if(!tileset||!isValidTileId(tileset,entry.tileId))continue;
            const diagonal=(cell&FLIP_D)!==0,w=diagonal?tileset.tileHeight:tileset.tileWidth,h=diagonal?tileset.tileWidth:tileset.tileHeight;
            const dx=x*map.tileWidth,dy=(y+1)*map.tileHeight-h;
            if(dx>=right||dy>=bottom||dx+w<=left||dy+h<=top)continue;
            const src=tileRect(tileset,entry.tileId);
            yield {kind:"draw",tilesetId:tileset.id,sx:src.x,sy:src.y,sw:src.width,sh:src.height,
              transform:tileTransform(dx,dy,w,h,(cell&FLIP_H)!==0,(cell&FLIP_V)!==0,scale,diagonal),dw:diagonal?h:w,dh:diagonal?w:h};
          }
        }
      }
      start=end;
    }
  }
}
