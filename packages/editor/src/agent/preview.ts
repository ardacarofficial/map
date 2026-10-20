import { AGENT_LIMITS, AgentError, AgentErrorCode, type PreviewImage, type Rect, type RenderPreviewArgs } from "@smap/agent";
import { isGridLayer, isEntityLayer, type MapDocument, type RgbaImage } from "@smap/core";
import { regionCompositeOps, type CanvasOp } from "../export/pngComposite";
import { replayOps } from "../export/pngRender";
import { RasterReplay } from "./raster";

export function renderPreviewPixels(doc: MapDocument, region: Rect, options: Pick<RenderPreviewArgs, "grid" | "coordinates" | "maxSide" | "layerIds" | "entities">, source: (id: string) => RgbaImage | undefined): RgbaImage & { image: PreviewImage; missing: string[] } {
  const map = doc.map;
  if (region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 || region.x+region.width>map.width || region.y+region.height>map.height) throw new AgentError(AgentErrorCode.OUT_OF_BOUNDS, "Preview region outside map");
  const gutter = options.coordinates ? 24 : 0;
  const maxSide = Math.min(options.maxSide ?? 1536, AGENT_LIMITS.imageSide);
  const nativeWidth = region.width*map.tileWidth, nativeHeight=region.height*map.tileHeight;
  const scale = Math.min(1, (maxSide-gutter)/Math.max(nativeWidth,nativeHeight));
  const contentRect = { x:gutter,y:gutter,width:Math.max(1,Math.floor(nativeWidth*scale)),height:Math.max(1,Math.floor(nativeHeight*scale)) };
  const width=contentRect.width+gutter,height=contentRect.height+gutter;
  if (width*height>AGENT_LIMITS.imagePixels) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Preview image is too large");
  const canvas=new RasterReplay(width,height,contentRect);
  canvas.fill({x:0,y:0,width,height},[27,33,42,255]); canvas.checker(contentRect);
  const originX=region.x*map.tileWidth,originY=region.y*map.tileHeight;
  function* offsetOps():Generator<CanvasOp>{
    for(const op of regionCompositeOps(doc,region,scale,options.layerIds)){
      if(op.kind==="alpha"){yield op;continue;}
      const [a,b,c,d,e,f]=op.transform;
      yield {...op,transform:[a,b,c,d,e-originX*scale+gutter,f-originY*scale+gutter]};
    }
  }
  const missing=new Set<string>();
  replayOps(canvas,offsetOps(),id=>{const pixels=source(id);if(!pixels)missing.add(id);return pixels as unknown as CanvasImageSource|undefined;});
  const cw=map.tileWidth*scale,ch=map.tileHeight*scale;
  // Collision is an explicit diagnostic overlay, never inferred from tile artwork.
  if(options.layerIds)for(const layer of doc.layers){
    if(!isGridLayer(layer)||!layer.visible||!options.layerIds.includes(layer.id))continue;
    for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++){
      const value=layer.getCell(region.x+x,region.y+y);if(!value)continue;
      const left=Math.floor(gutter+x*cw),top=Math.floor(gutter+y*ch);
      canvas.fill({x:left,y:top,width:Math.min(width-left,Math.ceil(cw)),height:Math.min(height-top,Math.ceil(ch))},value===1?[255,84,104,85]:[92,178,255,85]);
    }
  }

  if(options.grid){
    if(cw>=3)for(let x=0;x<=region.width;x++)canvas.fill({x:gutter+Math.min(contentRect.width-1,Math.round(x*cw)),y:gutter,width:1,height:contentRect.height},[155,175,185,100]);
    if(ch>=3)for(let y=0;y<=region.height;y++)canvas.fill({x:gutter,y:gutter+Math.min(contentRect.height-1,Math.round(y*ch)),width:contentRect.width,height:1},[155,175,185,100]);
  }
  if(options.coordinates){
    const xStep=Math.max(1,Math.ceil(24/cw)),yStep=Math.max(1,Math.ceil(10/ch));
    for(let x=0;x<region.width;x+=xStep)canvas.text(String(region.x+x),gutter+x*cw+1,8);
    for(let y=0;y<region.height;y+=yStep)canvas.text(String(region.y+y),2,gutter+y*ch+1);
  }
  if(options.entities!==false)for(const layer of doc.layers){
    if(!isEntityLayer(layer)||!layer.visible||(options.layerIds&&!options.layerIds.includes(layer.id)))continue;
    for(const entity of layer.entities){const x=gutter+(entity.x-originX)*scale,y=gutter+(entity.y-originY)*scale;if(x<gutter||y<gutter||x>=width||y>=height)continue;canvas.fill({x:Math.floor(x),y:Math.floor(y),width:3,height:3},[105,201,174,220]);}
  }
  return {width,height,data:canvas.data,missing:[...missing],image:{width,height,scale,pixelOrigin:{x:originX,y:originY},cellSize:{width:cw,height:ch},contentRect,grid:options.grid??false,coordinates:options.coordinates??false}};
}
