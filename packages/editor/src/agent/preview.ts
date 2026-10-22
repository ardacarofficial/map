import { AGENT_LIMITS, AgentError, AgentErrorCode, type AgentCallContext, type PreviewImage, type Rect, type RenderPreviewArgs } from "@smap/agent";
import { isGridLayer, isEntityLayer, type MapDocument, type RgbaImage } from "@smap/core";
import { regionCompositeSteps } from "../export/pngComposite";
import { RasterReplay } from "./raster";
import { imageWork } from "./imageWork";

type PreviewOptions = Pick<RenderPreviewArgs, "grid" | "coordinates" | "maxSide" | "layerIds" | "entities">;
type PreviewPixels = RgbaImage & { image: PreviewImage; missing: string[] };
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
  const gutter = options.coordinates ? 40 : 0;
  const maxSide = Math.min(options.maxSide ?? 1536, AGENT_LIMITS.imageSide);
  const nativeWidth = region.width*map.tileWidth, nativeHeight=region.height*map.tileHeight;
  const scale = Math.min(1, (maxSide-gutter)/Math.max(nativeWidth,nativeHeight));
  const contentRect = { x:gutter,y:gutter,width:Math.max(1,Math.floor(nativeWidth*scale)),height:Math.max(1,Math.floor(nativeHeight*scale)) };
  const width=contentRect.width+gutter,height=contentRect.height+gutter;
  if (width*height>AGENT_LIMITS.imagePixels) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Preview image is too large");
  const canvas=new RasterReplay(width,height,contentRect);
  canvas.fill({x:0,y:0,width,height},[27,33,42,255]); canvas.checker(contentRect);
  const originX=region.x*map.tileWidth,originY=region.y*map.tileHeight;
  const missing=new Set<string>();
  for(const op of regionCompositeSteps(doc,region,scale,options.layerIds)){
    if(!op){yield;continue;}
    if(op.kind==="alpha"){canvas.globalAlpha=op.alpha;continue;}
    const pixels=source(op.tilesetId);
    if(!pixels){missing.add(op.tilesetId);yield;continue;}
    const [a,b,c,d,e,f]=op.transform;
    canvas.setTransform(a,b,c,d,e-originX*scale+gutter,f-originY*scale+gutter);
    canvas.drawImage(pixels as unknown as CanvasImageSource,op.sx,op.sy,op.sw,op.sh,0,0,op.dw,op.dh);
    yield;
  }
  canvas.setTransform(1,0,0,1,0,0);canvas.globalAlpha=1;
  let scanned=0;
  const cw=map.tileWidth*scale,ch=map.tileHeight*scale;
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
          const left=Math.floor(gutter+(x-region.x)*cw),top=Math.floor(gutter+(y-region.y)*ch);
          canvas.fill({x:left,y:top,width:Math.min(width-left,Math.ceil(cw)),height:Math.min(height-top,Math.ceil(ch))},value===1?[255,84,104,85]:[92,178,255,85]);
        }
      }
      start=end;
    }
  }

  if(options.grid){
    if(cw>=3)for(let x=0;x<=region.width;x++)canvas.fill({x:gutter+Math.min(contentRect.width-1,Math.round(x*cw)),y:gutter,width:1,height:contentRect.height},[155,175,185,100]);
    if(ch>=3)for(let y=0;y<=region.height;y++)canvas.fill({x:gutter,y:gutter+Math.min(contentRect.height-1,Math.round(y*ch)),width:contentRect.width,height:1},[155,175,185,100]);
  }
  if(options.coordinates){
    const xLabelWidth=8*String(region.x+region.width-1).length;
    const xStep=Math.max(1,Math.ceil((xLabelWidth+8)/cw)),yStep=Math.max(1,Math.ceil(16/ch));
    for(let x=0;x<region.width;x+=xStep)canvas.text(String(region.x+x),gutter+x*cw+1,12);
    for(let y=0;y<region.height;y+=yStep)canvas.text(String(region.y+y),4,gutter+y*ch+1);
  }
  if(options.entities!==false)for(const layer of doc.layers){
    if(!isEntityLayer(layer)||!layer.visible||(options.layerIds&&!options.layerIds.includes(layer.id)))continue;
    for(const entity of layer.entities){if((scanned++&1023)===0)yield;const x=gutter+(entity.x-originX)*scale,y=gutter+(entity.y-originY)*scale;if(x<gutter||y<gutter||x>=width||y>=height)continue;canvas.fill({x:Math.floor(x),y:Math.floor(y),width:3,height:3},[105,201,174,220]);}
  }
  return {width,height,data:canvas.data,missing:[...missing],image:{width,height,scale,pixelOrigin:{x:originX,y:originY},cellSize:{width:cw,height:ch},contentRect,grid:options.grid??false,coordinates:options.coordinates??false}};
}
