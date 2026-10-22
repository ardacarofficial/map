import { encode } from "fast-png";
import { AGENT_LIMITS, AgentError, AgentErrorCode, type AgentCallContext, type AgentImagePort, type AgentSignal, type AgentWorldPort, type CatalogImage } from "@smap/agent";
import { cellFlags, cellPaletteIndex, createDocument, makeCell, MapStore, rasterContentHash, tileRect, type RgbaImage, type Tileset } from "@smap/core";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { getTilesetImage, retainTilesetImage, tilesetImageBytes, type TilesetImage } from "../state/tilesetImages";
import { pngHash } from "../state/pngHash";
import { regionCompositeOps } from "../export/pngComposite";
import { RasterReplay } from "./raster";
import { renderPreviewPixels } from "./preview";

const decoded = new Map<TilesetImage, RgbaImage>();
let decodedBytes=0;
function rememberPixels(image:TilesetImage,pixels:RgbaImage):void {
  while(decoded.size && decodedBytes+pixels.data.byteLength>AGENT_LIMITS.retainedBytes){const first=decoded.entries().next().value!;decoded.delete(first[0]);decodedBytes-=first[1].data.byteLength;}
  decoded.set(image,pixels);decodedBytes+=pixels.data.byteLength;
}
export async function imagePixels(id: string, signal: AgentSignal): Promise<RgbaImage> {
  signal.throwIfAborted();
  const image = getTilesetImage(id);
  if (!image) throw new AgentError(AgentErrorCode.SOURCE_CHANGED, "Tileset image unavailable", { tilesetId: id });
  const release = retainTilesetImage(image);
  try {
    let pixels = decoded.get(image);
    if (!pixels) { pixels = decodeWorkingSourcePng(await tilesetImageBytes(image)); rememberPixels(image, pixels); }
    signal.throwIfAborted();
    if (getTilesetImage(id) !== image) throw new AgentError(AgentErrorCode.SOURCE_CHANGED, "Tileset changed during image preparation");
    return pixels;
  } finally { release(); }
}
export function encodeAgentPng(image: RgbaImage): Uint8Array {
  if (image.width > AGENT_LIMITS.imageSide || image.height > AGENT_LIMITS.imageSide || image.width * image.height > AGENT_LIMITS.imagePixels) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED, "Image dimensions exceed budget");
  const png = encode({ width:image.width,height:image.height,data:image.data,channels:4,depth:8 });
  if (png.length > AGENT_LIMITS.pngBytes) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"PNG exceeds image budget");
  return png;
}
const sourceIds = new WeakMap<TilesetImage, string>();
let sourceSequence = 0;
const hashTuple = (value: unknown) => pngHash(new TextEncoder().encode(JSON.stringify(value)));
function assertTile(tileset: Tileset | undefined, tileId: number): asserts tileset is Tileset {
  const count=tileset?.edited?.nextTileId ?? (tileset ? tileset.columns*tileset.rows : 0);
  if(!tileset||!Number.isInteger(tileId)||tileId<0||tileId>=count)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown tile");
}
export function createImagePort(world: AgentWorldPort, revision: () => number): AgentImagePort {
  const tileFingerprint = async (tilesetId: string, tileId: number, signal: AgentSignal) => {
    const tileset=world.tilesets().find(t=>t.id===tilesetId);assertTile(tileset,tileId);
    const source=await imagePixels(tilesetId,signal),rect=tileRect(tileset,tileId);
    if(rect.x+rect.width>source.width||rect.y+rect.height>source.height)throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Tile outside current image");
    const pixels=new Uint8Array(rect.width*rect.height*4);
    for(let y=0;y<rect.height;y++)pixels.set(source.data.subarray(((rect.y+y)*source.width+rect.x)*4,((rect.y+y)*source.width+rect.x+rect.width)*4),y*rect.width*4);
    return hashTuple(["tile-v1",tileset.tileWidth,tileset.tileHeight,tileset.columns,tileset.rows,tileset.margin,tileset.spacing,tileId,rasterContentHash(rect.width,rect.height,pixels)]);
  };
  const stampFingerprint = async (id: string, signal: AgentSignal) => {
    const stamp=world.stamps().find(s=>s.id===id);if(!stamp)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown stamp");
    const fingerprints=await Promise.all(stamp.palette.map(p=>tileFingerprint(p.tilesetId,p.tileId,signal)));
    return hashTuple(["stamp-v1",stamp.width,stamp.height,stamp.layers.map(l=>[l.layerId,l.grid?"collision":"tile",l.role??null,Array.from(l.cells,cell=>{
      if(l.grid)return cell;
      const index=cellPaletteIndex(cell);if(!index)return null;
      const tile=stamp.palette[index-1];return tile?[tile.tilesetId,tile.tileId,cellFlags(cell),fingerprints[index-1]]:null;
    })])]);
  };
  async function sources(ids: readonly string[], call: AgentCallContext) {
    const result=new Map<string,RgbaImage>();
    let retained=0;
    for(const id of new Set(ids))try{const pixels=await imagePixels(id,call.signal);retained+=pixels.data.byteLength;if(retained>AGENT_LIMITS.retainedBytes)throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Image source budget exceeded");result.set(id,pixels);}catch(error){call.signal.throwIfAborted();if(!(error instanceof AgentError)||error.code===AgentErrorCode.LIMIT_EXCEEDED)throw error;}
    return result;
  }
  return {
    tileFingerprint, stampFingerprint,
    catalogSourceKey(id) {
      const image = getTilesetImage(id);
      if (!image) return null;
      let key = sourceIds.get(image);
      if (!key) { key = String(++sourceSequence); sourceIds.set(image, key); }
      return key;
    },
    async tileCatalog(args,call) {
      const rev=revision(),tileset=world.tilesets().find(t=>t.id===args.tilesetId);
      if(!tileset)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown tileset");
      const pixels=await imagePixels(tileset.id,call.signal),requestedScale=args.scale??1;
      const sheet=args.image==="sheet";
      if (sheet) {
        if (args.tileIds) throw new AgentError(AgentErrorCode.INVALID_ARGUMENT,"Sheet mode uses sheetRegion, not tileIds");
        const region=args.sheetRegion??{x:0,y:0,width:tileset.columns,height:tileset.rows};
        if (![region.x,region.y,region.width,region.height].every(Number.isSafeInteger) || region.x<0 || region.y<0 || region.width<1 || region.height<1 || region.x+region.width>tileset.columns || region.y+region.height>tileset.rows)
          throw new AgentError(AgentErrorCode.OUT_OF_BOUNDS,"Sheet crop outside tileset");
        const sourceRect={x:tileset.margin+region.x*(tileset.tileWidth+tileset.spacing),y:tileset.margin+region.y*(tileset.tileHeight+tileset.spacing),width:region.width*tileset.tileWidth+(region.width-1)*tileset.spacing,height:region.height*tileset.tileHeight+(region.height-1)*tileset.spacing};
        if(sourceRect.x+sourceRect.width>pixels.width||sourceRect.y+sourceRect.height>pixels.height)throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Sheet outside current image");
        const left=40,top=20;
        const scale=Math.min(requestedScale,(AGENT_LIMITS.imageSide-left)/sourceRect.width,(AGENT_LIMITS.imageSide-top)/sourceRect.height,Math.sqrt((AGENT_LIMITS.imagePixels-left*top)/(sourceRect.width*sourceRect.height)));
        const contentRect={x:left,y:top,width:Math.max(1,Math.floor(sourceRect.width*scale)),height:Math.max(1,Math.floor(sourceRect.height*scale))};
        const width=left+contentRect.width,height=top+contentRect.height;
        if(width*height>AGENT_LIMITS.imagePixels)throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Catalog image exceeds pixel budget");
        const canvas=new RasterReplay(width,height);canvas.fill({x:0,y:0,width,height},[27,33,42,255]);canvas.checker(contentRect);
        canvas.drawImage(pixels as unknown as CanvasImageSource,sourceRect.x,sourceRect.y,sourceRect.width,sourceRect.height,contentRect.x,contentRect.y,contentRect.width,contentRect.height);
        // Coordinate gutters stay outside the original artwork; no gaps split multi-tile sprites.
        const xStep=Math.max(1,Math.ceil(48/((tileset.tileWidth+tileset.spacing)*scale)));
        const yStep=Math.max(1,Math.ceil(16/((tileset.tileHeight+tileset.spacing)*scale)));
        for(let x=0;x<region.width;x+=xStep)canvas.text(String(region.x+x),left+x*(tileset.tileWidth+tileset.spacing)*scale,3);
        for(let y=0;y<region.height;y+=yStep)canvas.text(String(region.y+y),2,top+y*(tileset.tileHeight+tileset.spacing)*scale);
        call.signal.throwIfAborted();
        const image:CatalogImage={width,height,mode:"sheet",scale,placements:[],sheet:{region,sourceRect,contentRect,grid:{columns:tileset.columns,rows:tileset.rows,tileWidth:tileset.tileWidth,tileHeight:tileset.tileHeight,margin:tileset.margin,spacing:tileset.spacing}}};
        return {png:encodeAgentPng(canvas),width,height,revision:rev,warnings:[],image};
      }
      const count=tileset.edited?.nextTileId??tileset.columns*tileset.rows;
      const ids=args.tileIds??Array.from({length:Math.max(0,Math.min(args.limit??64,count-(args.offset??0)))},(_,i)=>i+(args.offset??0));
      if(!ids.length||ids.length>AGENT_LIMITS.catalogImagePage)throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Choose between 1 and 64 image tiles");
      ids.forEach(id=>assertTile(tileset,id));
      const scale=requestedScale,gutter=18,gap=4,tw=tileset.tileWidth*scale,th=tileset.tileHeight*scale;
      const cellWidth=Math.max(tw,8*String(count-1).length);
      const cols=Math.max(1,Math.min(ids.length,Math.floor((AGENT_LIMITS.imageSide-gap)/(cellWidth+gap))));
      const rows=Math.ceil(ids.length/cols);
      const width=cols*(cellWidth+gap)+gap,height=rows*(th+gutter+gap)+gap;
      if(width>AGENT_LIMITS.imageSide||height>AGENT_LIMITS.imageSide||width*height>AGENT_LIMITS.imagePixels)throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Catalog image too large; select a smaller page");
      const canvas=new RasterReplay(width,height);canvas.fill({x:0,y:0,width,height},[27,33,42,255]);
      const placements:CatalogImage["placements"]=[];
      for(const [i,tileId]of ids.entries()){
        const rect={x:gap+(i%cols)*(cellWidth+gap),y:gap+Math.floor(i/cols)*(th+gutter+gap),width:tw,height:th};
        canvas.checker(rect);const src=tileRect(tileset,tileId);
        if(src.x+src.width>pixels.width||src.y+src.height>pixels.height)throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Tile outside current image");
        canvas.drawImage(pixels as unknown as CanvasImageSource,src.x,src.y,src.width,src.height,rect.x,rect.y,tw,th);
        const labelRect={x:rect.x,y:rect.y+th,width:cellWidth,height:gutter};
        canvas.text(String(tileId),labelRect.x,labelRect.y+3);placements.push({tileId,rect,labelRect});
      }
      call.signal.throwIfAborted();
      const image:CatalogImage={width,height,mode:"tiles",scale,placements};
      return {png:encodeAgentPng(canvas),width,height,revision:rev,warnings:[],image};
    },
    async renderPreview(args,call) {
      const store=await world.loadMap(args.mapId),mapRevision=store.revision,rev=revision(),doc=store.document;
      const region=args.region??{x:0,y:0,width:doc.map.width,height:doc.map.height};
      const ids=new Set<string>();for(const op of regionCompositeOps(doc,region,1,args.layerIds))if(op.kind==="draw")ids.add(op.tilesetId);
      const images=await sources([...ids],call);
      const result=renderPreviewPixels(doc,region,args,id=>images.get(id));call.signal.throwIfAborted();
      if(store.revision!==mapRevision)throw new AgentError(AgentErrorCode.REVISION_CONFLICT,"Map changed during preview");
      return {png:encodeAgentPng(result),width:result.width,height:result.height,revision:rev,mapRevision,region,image:result.image,warnings:result.missing.map(id=>({code:"MISSING_IMAGE",detail:id}))};
    },
    async stampPreview(stampId,call) {
      const stamp=world.stamps().find(s=>s.id===stampId);if(!stamp)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown stamp");
      const first=world.tilesets().find(t=>stamp.palette.some(p=>p.tilesetId===t.id));
      const store=new MapStore(createDocument({width:stamp.width,height:stamp.height,tileWidth:first?.tileWidth??16,tileHeight:first?.tileHeight??16,tilesets:world.tilesets()}));
      for(const layer of stamp.layers){if(layer.grid)continue;const id=store.dispatch({type:"addLayer",layer:{name:layer.name}});const cells=Array.from(layer.cells,(cell,i)=>{
        const entry=stamp.palette[cellPaletteIndex(cell)-1];return{x:i%stamp.width,y:Math.floor(i/stamp.width),cell:entry?makeCell(store.getOrAddPaletteIndex(entry.tilesetId,entry.tileId),cellFlags(cell)):0};
      });store.dispatch({type:"paintCells",layerId:id,cells});}
      const images=await sources(stamp.palette.map(p=>p.tilesetId),call);
      const result=renderPreviewPixels(store.document,{x:0,y:0,width:stamp.width,height:stamp.height},{},id=>images.get(id));call.signal.throwIfAborted();
      return{png:encodeAgentPng(result),width:result.width,height:result.height,revision:revision(),warnings:[]};
    },
  };
}
