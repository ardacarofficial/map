import { AGENT_LIMITS, AgentError, AgentErrorCode, type AgentCallContext, type PreviewImage, type Rect, type RenderPreviewArgs } from "@smap/agent";
import { isGridLayer, isEntityLayer, type MapDocument, type RgbaImage } from "@smap/core";
import { regionCompositeSteps } from "../export/pngComposite";
import { RasterReplay, textWidth } from "./raster";
import { imageWork } from "./imageWork";

/** Cells changed by the pending edit (indices into the region, row-major) or rectangles to outline. */
export interface PreviewHighlight { cells?: ReadonlySet<number>; rects?: readonly Rect[] }
type PreviewOptions = Pick<RenderPreviewArgs, "grid" | "coordinates" | "maxSide" | "layerIds" | "entities" | "zoom"> & { highlight?: PreviewHighlight; entityNames?: ReadonlyMap<string, string> };
type PreviewPixels = RgbaImage & { image: PreviewImage; missing: string[] };
export const MAJOR_GRID = 8;
const GUTTER_COLOR = [27, 33, 42, 255] as const;
const GRID_COLOR = [155, 175, 185, 90] as const;
const MAJOR_COLOR = [228, 236, 242, 150] as const;
const HIGHLIGHT_COLOR = [231, 183, 95, 255] as const;
const ENTITY_COLOR = [105, 201, 174, 255] as const;

export interface PreviewLayout { scale: number; cw: number; ch: number; left: number; top: number; contentRect: Rect; width: number; height: number }
/** Whole pixels per cell whenever possible: zoom 1–8 enlarges, big regions shrink to the largest whole cell size. */
export function previewLayout(region: Rect, tileWidth: number, tileHeight: number, options: { coordinates?: boolean; maxSide?: number; zoom?: number }): PreviewLayout {
  const digits = String(Math.max(region.x + region.width - 1, region.y + region.height - 1)).length;
  const left = options.coordinates ? 8 * digits + 8 : 0, top = options.coordinates ? 16 : 0;
  const maxSide = Math.min(options.maxSide ?? 1536, AGENT_LIMITS.imageSide - Math.max(left, top));
  const nativeWidth = region.width * tileWidth, nativeHeight = region.height * tileHeight;
  let scale = Math.max(1, Math.min(8, Math.floor(options.zoom ?? 1)));
  while (scale > 1 && Math.max(nativeWidth, nativeHeight) * scale > maxSide) scale--;
  if (Math.max(nativeWidth, nativeHeight) * scale > maxSide) {
    // Shrink to the largest whole cell size; only sub-pixel cells fall back to a fractional scale.
    const square = tileWidth === tileHeight;
    const cell = square ? Math.floor(Math.min(maxSide / region.width, maxSide / region.height)) : 0;
    scale = cell >= 1 ? cell / tileWidth : maxSide / Math.max(nativeWidth, nativeHeight);
  }
  const cw = tileWidth * scale, ch = tileHeight * scale;
  const contentRect = { x: left, y: top, width: Math.max(1, Math.floor(nativeWidth * scale)), height: Math.max(1, Math.floor(nativeHeight * scale)) };
  return { scale, cw, ch, left, top, contentRect, width: contentRect.width + left, height: contentRect.height + top };
}

/** Cell grid, major lines every 8 map cells, gutter coordinates and labels at major intersections. */
export function drawPreviewOverlays(canvas: RasterReplay, layout: PreviewLayout, region: Rect, options: { grid?: boolean; coordinates?: boolean }): void {
  const { cw, ch, left, top, contentRect } = layout;
  const vertical = (x: number, color: readonly number[]) => canvas.fill({ x: left + Math.min(contentRect.width - 1, Math.round(x * cw)), y: top, width: 1, height: contentRect.height }, color);
  const horizontal = (y: number, color: readonly number[]) => canvas.fill({ x: left, y: top + Math.min(contentRect.height - 1, Math.round(y * ch)), width: contentRect.width, height: 1 }, color);
  if (options.grid) {
    if (cw >= 3) for (let x = 0; x <= region.width; x++) if ((region.x + x) % MAJOR_GRID) vertical(x, GRID_COLOR);
    if (ch >= 3) for (let y = 0; y <= region.height; y++) if ((region.y + y) % MAJOR_GRID) horizontal(y, GRID_COLOR);
    if (cw * MAJOR_GRID >= 6) for (let x = 0; x <= region.width; x++) if (!((region.x + x) % MAJOR_GRID)) vertical(x, MAJOR_COLOR);
    if (ch * MAJOR_GRID >= 6) for (let y = 0; y <= region.height; y++) if (!((region.y + y) % MAJOR_GRID)) horizontal(y, MAJOR_COLOR);
  }
  if (!options.coordinates) return;
  const xLabelWidth = 8 * String(region.x + region.width - 1).length;
  const xStep = Math.max(1, Math.ceil((xLabelWidth + 8) / cw)), yStep = Math.max(1, Math.ceil(16 / ch));
  for (let x = 0; x < region.width; x += xStep) canvas.text(String(region.x + x), left + x * cw + 1, 3);
  for (let y = 0; y < region.height; y += yStep) canvas.text(String(region.y + y), 4, top + y * ch + 1);
  // Repeat coordinates inside big views so far cells need no gutter lookup.
  if (options.grid && (region.width > 2 * MAJOR_GRID || region.height > 2 * MAJOR_GRID) && cw * MAJOR_GRID >= 48) {
    const scale = cw >= 12 ? 2 : 1;
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const mx = region.x + x, my = region.y + y;
      if (mx % MAJOR_GRID || my % MAJOR_GRID || (x === 0 && y === 0)) continue;
      const value = `${mx},${my}`, px = left + Math.round(x * cw) + 1, py = top + Math.round(y * ch) + 1;
      if (px + textWidth(value, scale) + 2 * scale < left + contentRect.width && py + 7 * scale < top + contentRect.height) canvas.label(value, px, py, scale);
    }
  }
}

export function renderPreviewPixels(doc: MapDocument, region: Rect, options: PreviewOptions, source: (id: string) => RgbaImage | undefined): PreviewPixels {
  const steps=renderPreviewSteps(doc,region,options,source);
  for(;;){
    const step=steps.next();
    if(step.done)return step.value;
  }
}
export async function renderPreviewPixelsAsync(doc: MapDocument, region: Rect, options: PreviewOptions, source: (id: string) => RgbaImage | undefined, call: AgentCallContext): Promise<PreviewPixels> {
  const checkpoint=imageWork(call),steps=renderPreviewSteps(doc,region,options,source);
  for(;;){
    const pause=checkpoint();if(pause)await pause;
    const step=steps.next();
    if(step.done){
      const tail=checkpoint();if(tail)await tail;
      return step.value;
    }
  }
}
function* renderPreviewSteps(doc: MapDocument, region: Rect, options: PreviewOptions, source: (id: string) => RgbaImage | undefined): Generator<void,PreviewPixels> {
  const map = doc.map;
  if (region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 || region.x+region.width>map.width || region.y+region.height>map.height) throw new AgentError(AgentErrorCode.OUT_OF_BOUNDS, "Preview region outside map");
  const layout = previewLayout(region, map.tileWidth, map.tileHeight, options);
  const { scale, contentRect, width, height, cw, ch, left, top } = layout;
  if (width*height>AGENT_LIMITS.imagePixels) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Preview image is too large");
  const canvas=new RasterReplay(width,height,contentRect);
  canvas.fill({x:0,y:0,width,height},GUTTER_COLOR); canvas.checker(contentRect);
  const originX=region.x*map.tileWidth,originY=region.y*map.tileHeight;
  const missing=new Set<string>();
  for(const op of regionCompositeSteps(doc,region,scale,options.layerIds)){
    if(!op){yield;continue;}
    if(op.kind==="alpha"){canvas.globalAlpha=op.alpha;continue;}
    const pixels=source(op.tilesetId);
    if(!pixels){missing.add(op.tilesetId);yield;continue;}
    const [a,b,c,d,e,f]=op.transform;
    canvas.setTransform(a,b,c,d,e-originX*scale+left,f-originY*scale+top);
    canvas.drawImage(pixels as unknown as CanvasImageSource,op.sx,op.sy,op.sw,op.sh,0,0,op.dw,op.dh);
    yield;
  }
  canvas.setTransform(1,0,0,1,0,0);canvas.globalAlpha=1;
  let scanned=0;
  // Collision is an explicit diagnostic overlay, never inferred from tile artwork.
  if(options.layerIds)for(const layer of doc.layers){
    if(!isGridLayer(layer)||!layer.visible||!options.layerIds.includes(layer.id))continue;
    const right=region.x+region.width,bottom=region.y+region.height;
    const chunks=[...layer.chunks()].filter(c=>c.cx*32<right&&(c.cx+1)*32>region.x&&c.cy*32<bottom&&(c.cy+1)*32>region.y).sort((a,b)=>a.cy-b.cy||a.cx-b.cx);
    // Keep row-major blending when multiple subpixel cells cover the same pixel.
    for(let start=0;start<chunks.length;){
      let end=start+1;while(end<chunks.length&&chunks[end]!.cy===chunks[start]!.cy)end++;
      for(let row=0;row<32;row++){
        const y=chunks[start]!.cy*32+row;if(y<region.y||y>=bottom)continue;
        for(let c=start;c<end;c++)for(let col=0;col<32;col++){
          if((scanned++&1023)===0)yield;
          const chunk=chunks[c]!,x=chunk.cx*32+col;if(x<region.x||x>=right)continue;
          const value=chunk.data[row*32+col]!;if(!value)continue;
          const cellLeft=Math.floor(left+(x-region.x)*cw),cellTop=Math.floor(top+(y-region.y)*ch);
          canvas.fill({x:cellLeft,y:cellTop,width:Math.min(width-cellLeft,Math.ceil(cw)),height:Math.min(height-cellTop,Math.ceil(ch))},value===1?[255,84,104,85]:[92,178,255,85]);
        }
      }
      start=end;
    }
  }
  drawPreviewOverlays(canvas, layout, region, options);
  const highlight = options.highlight;
  if (highlight?.cells?.size) for (const index of highlight.cells) {
    if ((scanned++ & 1023) === 0) yield;
    const x = index % region.width, y = Math.floor(index / region.width);
    const cell = { x: left + Math.floor(x * cw), y: top + Math.floor(y * ch), width: Math.max(1, Math.ceil(cw)), height: Math.max(1, Math.ceil(ch)) };
    canvas.fill(cell, [231, 183, 95, 60]);
    if (cw >= 6) canvas.outline(cell, HIGHLIGHT_COLOR, cw >= 24 ? 2 : 1);
  }
  for (const rect of highlight?.rects ?? []) {
    const x0 = Math.max(rect.x, region.x), y0 = Math.max(rect.y, region.y), x1 = Math.min(rect.x + rect.width, region.x + region.width), y1 = Math.min(rect.y + rect.height, region.y + region.height);
    if (x1 <= x0 || y1 <= y0) continue;
    canvas.outline({ x: left + Math.floor((x0 - region.x) * cw), y: top + Math.floor((y0 - region.y) * ch), width: Math.max(2, Math.round((x1 - x0) * cw)), height: Math.max(2, Math.round((y1 - y0) * ch)) }, HIGHLIGHT_COLOR, 2);
  }
  if(options.entities!==false)for(const layer of doc.layers){
    if(!isEntityLayer(layer)||!layer.visible||(options.layerIds&&!options.layerIds.includes(layer.id)))continue;
    for(const entity of layer.entities){
      if((scanned++&1023)===0)yield;
      const cx=Math.floor(entity.x/map.tileWidth),cy=Math.floor(entity.y/map.tileHeight);
      if(cx<region.x||cy<region.y||cx>=region.x+region.width||cy>=region.y+region.height)continue;
      const cell={x:left+Math.floor((cx-region.x)*cw),y:top+Math.floor((cy-region.y)*ch),width:Math.max(3,Math.ceil(cw)),height:Math.max(3,Math.ceil(ch))};
      if(cw<6){canvas.fill(cell,ENTITY_COLOR);continue;}
      canvas.outline(cell,ENTITY_COLOR,cw>=24?2:1);
      const name=(options.entityNames?.get(entity.typeId)??entity.typeId).slice(0,Math.max(1,Math.floor((cw-2)/8)));
      if(cw>=12&&name)canvas.label(name,cell.x+1,cell.y+1,cw>=24?2:1);
    }
  }
  return {width,height,data:canvas.data,missing:[...missing],image:{width,height,scale,pixelOrigin:{x:originX,y:originY},cellSize:{width:cw,height:ch},contentRect,grid:options.grid??false,coordinates:options.coordinates??false}};
}
