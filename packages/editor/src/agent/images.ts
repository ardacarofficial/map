import { encode } from "fast-png";
import { AGENT_LIMITS, AgentError, AgentErrorCode, type AgentCallContext, type AgentImagePort, type AgentSignal, type AgentWorldPort, type CatalogImage } from "@smap/agent";
import { BUILTIN_ENTITY_TYPES, cellFlags, cellPaletteIndex, createDocument, makeCell, MapStore, rasterContentHash, tileRect, type RgbaImage, type Stamp, type Tileset } from "@smap/core";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { getTilesetImage, retainTilesetImage, tilesetImageBytes, type TilesetImage } from "../state/tilesetImages";
import { pngHash } from "../state/pngHash";
import { regionCompositeSteps } from "../export/pngComposite";
import { RasterReplay } from "./raster";
import { renderPreviewPixelsAsync, type PreviewHighlight } from "./preview";
import { changedCells, draftStartDocument, lastCallRects } from "./draftBaseline";
import { textWidth } from "./raster";
import { imageWork } from "./imageWork";

const decoded = new Map<TilesetImage, RgbaImage>();
const decoding = new WeakMap<TilesetImage, Promise<RgbaImage>>();
let decodedBytes=0;
function rememberPixels(image:TilesetImage,pixels:RgbaImage):void {
  const previous=decoded.get(image);
  if(previous){decoded.delete(image);decodedBytes-=previous.data.byteLength;}
  while(decoded.size && decodedBytes+pixels.data.byteLength>AGENT_LIMITS.retainedBytes){const first=decoded.entries().next().value!;decoded.delete(first[0]);decodedBytes-=first[1].data.byteLength;}
  decoded.set(image,pixels);decodedBytes+=pixels.data.byteLength;
}
export async function imagePixels(id: string, signal: AgentSignal): Promise<RgbaImage> {
  signal.throwIfAborted();
  const image = getTilesetImage(id);
  if (!image) throw new AgentError(AgentErrorCode.SOURCE_CHANGED, "Tileset image unavailable", { tilesetId: id });
  let pixels=decoded.get(image);
  if(!pixels){
    let pending=decoding.get(image);
    if(!pending){
      // A stamp can fingerprint many tiles at once. Share one source decode,
      // with a lease that survives individual callers cancelling their wait.
      const release=retainTilesetImage(image);
      pending=tilesetImageBytes(image).then(bytes=>{
        if(getTilesetImage(id)!==image)throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Tileset changed during image preparation");
        const result=decodeWorkingSourcePng(bytes);rememberPixels(image,result);return result;
      }).finally(()=>{decoding.delete(image);release();});
      decoding.set(image,pending);
    }
    pixels=await new Promise<RgbaImage>((resolve,reject)=>{
      let off=()=>{};
      off=signal.onAbort(()=>{off();try{signal.throwIfAborted();}catch(error){reject(error);}});
      pending.then(value=>{off();resolve(value);},error=>{off();reject(error);});
    });
  }
  signal.throwIfAborted();
  if (getTilesetImage(id) !== image) throw new AgentError(AgentErrorCode.SOURCE_CHANGED, "Tileset changed during image preparation");
  return pixels;
}
export function encodeAgentPng(image: RgbaImage): Uint8Array {
  if (image.width > AGENT_LIMITS.imageSide || image.height > AGENT_LIMITS.imageSide || image.width * image.height > AGENT_LIMITS.imagePixels) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED, "Image dimensions exceed budget");
  const png = encode({ width:image.width,height:image.height,data:image.data,channels:4,depth:8 });
  if (png.length > AGENT_LIMITS.pngBytes) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"PNG exceeds image budget");
  return png;
}
const sourceIds = new WeakMap<TilesetImage, string>();
let sourceSequence = 0;
function sourceKey(image:TilesetImage):string {
  let key=sourceIds.get(image);
  if(!key){key=String(++sourceSequence);sourceIds.set(image,key);}
  return key;
}
const hashTuple = (value: unknown) => pngHash(new TextEncoder().encode(JSON.stringify(value)));
function assertTile(tileset: Tileset | undefined, tileId: number): asserts tileset is Tileset {
  const count=tileset?.edited?.nextTileId ?? (tileset ? tileset.columns*tileset.rows : 0);
  if(!tileset||!Number.isInteger(tileId)||tileId<0||tileId>=count)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown tile");
}
export function createImagePort(world: AgentWorldPort, revision: () => number): AgentImagePort {
  // Source object identity and slicing geometry bound every cached fingerprint.
  // PNG replacement and grid edits invalidate only the affected atlas.
  const fingerprints=new Map<string,{imageKey:string;grid:string;values:Map<number,string>}>();
  let fingerprintEntries=0;
  const gridKey=(ts:Tileset)=>JSON.stringify([ts.tileWidth,ts.tileHeight,ts.columns,ts.rows,ts.margin,ts.spacing,ts.edited?.nextTileId??null]);
  const tileFingerprint = async (tilesetId: string, tileId: number, signal: AgentSignal) => {
    signal.throwIfAborted();
    const tileset=world.tilesets().find(t=>t.id===tilesetId);assertTile(tileset,tileId);
    const image=getTilesetImage(tilesetId),imageKey=image?sourceKey(image):null,grid=gridKey(tileset);
    let cached=fingerprints.get(tilesetId);
    if(cached&&(cached.imageKey!==imageKey||cached.grid!==grid)){
      fingerprintEntries-=cached.values.size;fingerprints.delete(tilesetId);cached=undefined;
    }
    const hit=cached?.values.get(tileId);if(hit)return hit;
    const source=await imagePixels(tilesetId,signal),rect=tileRect(tileset,tileId);
    const current=world.tilesets().find(t=>t.id===tilesetId);
    if(getTilesetImage(tilesetId)!==image||!image||!current||gridKey(current)!==grid)
      throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Tileset changed while fingerprinting");
    if(rect.x+rect.width>source.width||rect.y+rect.height>source.height)throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Tile outside current image");
    const pixels=new Uint8Array(rect.width*rect.height*4);
    for(let y=0;y<rect.height;y++)pixels.set(source.data.subarray(((rect.y+y)*source.width+rect.x)*4,((rect.y+y)*source.width+rect.x+rect.width)*4),y*rect.width*4);
    const fingerprint=await hashTuple(["tile-v1",tileset.tileWidth,tileset.tileHeight,tileset.columns,tileset.rows,tileset.margin,tileset.spacing,tileId,rasterContentHash(rect.width,rect.height,pixels)]);
    signal.throwIfAborted();
    const latest=world.tilesets().find(t=>t.id===tilesetId);
    if(getTilesetImage(tilesetId)!==image||!latest||gridKey(latest)!==grid)throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Tileset changed while fingerprinting");
    // Keep cache memory bounded independently from decoded source retention.
    if(fingerprintEntries>=100000){fingerprints.clear();fingerprintEntries=0;}
    cached=fingerprints.get(tilesetId);
    if(!cached||cached.imageKey!==imageKey||cached.grid!==grid){if(cached)fingerprintEntries-=cached.values.size;cached={imageKey:sourceKey(image),grid,values:new Map()};fingerprints.set(tilesetId,cached);}
    if(!cached.values.has(tileId)){cached.values.set(tileId,fingerprint);fingerprintEntries++;}
    return fingerprint;
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
  async function stampPixels(stamp:Stamp,call:AgentCallContext){
    // Preview documents never need undo. Allocate used references together so
    // edited atlases cannot copy growing palette snapshots for every cell.
    const checkpoint=imageWork(call),used=new Set<number>();let scanned=0;
    for(const layer of stamp.layers)if(!layer.grid)for(const cell of layer.cells){
      if((scanned++&1023)===0){const pause=checkpoint();if(pause)await pause;}
      const index=cellPaletteIndex(cell);
      if(stamp.palette[index-1])used.add(index);
    }
    const indices=[...used],mapped=new Map<number,number>();
    const sourceIds=new Set(indices.map(index=>stamp.palette[index-1]!.tilesetId));
    const first=world.tilesets().find(t=>sourceIds.has(t.id));
    const store=new MapStore(createDocument({width:stamp.width,height:stamp.height,tileWidth:first?.tileWidth??16,tileHeight:first?.tileHeight??16,tilesets:world.tilesets()}),{historyLimit:0});
    if(indices.length){const allocated=store.dispatch({type:"addPaletteEntries",entries:indices.map(index=>stamp.palette[index-1]!)});indices.forEach((index,i)=>mapped.set(index,allocated[i]!));}
    for(const layer of stamp.layers){
      if(layer.grid)continue;
      const id=store.dispatch({type:"addLayer",layer:{name:layer.name}});
      let cells:{x:number;y:number;cell:number}[]=[];
      for(let i=0;i<layer.cells.length;i++){
        if((i&1023)===0){const pause=checkpoint();if(pause)await pause;}
        const cell=layer.cells[i]!,index=mapped.get(cellPaletteIndex(cell));
        if(!index)continue;
        cells.push({x:i%stamp.width,y:Math.floor(i/stamp.width),cell:makeCell(index,cellFlags(cell))});
        if(cells.length===AGENT_LIMITS.cellsPerCall){store.dispatch({type:"paintCells",layerId:id,cells});cells=[];}
      }
      if(cells.length)store.dispatch({type:"paintCells",layerId:id,cells});
    }
    const images=await sources([...sourceIds],call);
    const result=await renderPreviewPixelsAsync(store.document,{x:0,y:0,width:stamp.width,height:stamp.height},{},id=>images.get(id),call);call.signal.throwIfAborted();
    return result;
  }
  /** All stamps of one page at a shared whole scale, labelled with name and size. */
  async function stampSheet(stampIds:readonly string[],call:AgentCallContext){
    const stamps=stampIds.map(id=>{const stamp=world.stamps().find(s=>s.id===id);if(!stamp)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown stamp",{stampId:id});return stamp;});
    const pictures:{stamp:Stamp;pixels:RgbaImage;label:string}[]=[];
    for(const stamp of stamps)pictures.push({stamp,pixels:await stampPixels(stamp,call),label:`${stamp.name} ${stamp.width}x${stamp.height}`});
    const side=1568,gap=8,labelHeight=18;
    const widest=Math.max(...pictures.map(p=>p.pixels.width)),tallest=Math.max(...pictures.map(p=>p.pixels.height));
    let scale=Math.max(1,Math.min(4,Math.floor(Math.min((side-2*gap)/widest,512/tallest))));
    const layout=(s:number)=>{
      const rects:{x:number;y:number;width:number;height:number}[]=[];let x=gap,y=gap,row=0,width=0;
      for(const p of pictures){
        const w=Math.max(p.pixels.width*s,Math.min(side-2*gap,textWidth(p.label))),h=p.pixels.height*s+labelHeight;
        if(x>gap&&x+w>side-gap){x=gap;y+=row+gap;row=0;}
        rects.push({x,y,width:w,height:h});x+=w+gap;row=Math.max(row,h);width=Math.max(width,x);
      }
      return{rects,width:Math.max(width,gap*2),height:y+row+gap};
    };
    let placed=layout(scale);
    while(scale>1&&placed.height>side){scale--;placed=layout(scale);}
    if(placed.width>AGENT_LIMITS.imageSide||placed.height>AGENT_LIMITS.imageSide||placed.width*placed.height>AGENT_LIMITS.imagePixels)throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Stamp sheet too large; request a smaller page (limit)");
    const canvas=new RasterReplay(placed.width,placed.height);canvas.fill({x:0,y:0,width:placed.width,height:placed.height},[27,33,42,255]);
    const sheet:{stampId:string;label:string;rect:{x:number;y:number;width:number;height:number}}[]=[];
    pictures.forEach((p,i)=>{
      const r=placed.rects[i]!,art={x:r.x,y:r.y,width:p.pixels.width*scale,height:p.pixels.height*scale};
      canvas.checker(art);
      canvas.drawImage(p.pixels as unknown as CanvasImageSource,0,0,p.pixels.width,p.pixels.height,art.x,art.y,art.width,art.height);
      canvas.text(p.label,r.x,r.y+art.height+4);
      sheet.push({stampId:p.stamp.id,label:p.label,rect:art});
    });
    call.signal.throwIfAborted();
    return{png:encodeAgentPng(canvas),width:placed.width,height:placed.height,revision:revision(),warnings:[],sheet};
  }
  return {
    tileFingerprint, stampFingerprint, stampSheet,
    catalogSourceKey(id) {
      const image = getTilesetImage(id);
      if (!image) return null;
      return sourceKey(image);
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
        // Tile ids in every cell: the agent reads ids directly instead of computing row*columns+col.
        const cellW=(tileset.tileWidth+tileset.spacing)*scale,cellH=(tileset.tileHeight+tileset.spacing)*scale,count=tileset.edited?.nextTileId??tileset.columns*tileset.rows;
        const idScale=cellW>=40&&cellH>=24?2:1;
        if(cellW>=textWidth(String(count-1),idScale)+2*idScale&&cellH>=7*idScale)for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++){
          const id=(region.y+y)*tileset.columns+region.x+x;if(id>=count)continue;
          canvas.label(String(id),contentRect.x+Math.floor(x*cellW),contentRect.y+Math.floor(y*cellH),idScale);
        }
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
      // Near-square grid within 1568 px (the side clients show without downscaling).
      const side=1568,fitCols=Math.max(1,Math.floor((side-gap)/(cellWidth+gap)));
      const cols=Math.max(1,Math.min(ids.length,fitCols,Math.ceil(Math.sqrt(ids.length*(th+gutter+gap)/(cellWidth+gap)))));
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
      const image:CatalogImage={width,height,mode:"tiles",scale,columns:cols,placements};
      return {png:encodeAgentPng(canvas),width,height,revision:rev,warnings:[],image};
    },
    async renderPreview(args,call) {
      const store=await world.loadMap(args.mapId),mapRevision=store.revision,rev=revision(),doc=store.document;
      const region=args.region??{x:0,y:0,width:doc.map.width,height:doc.map.height};
      const checkpoint=imageWork(call),ids=new Set<string>();
      for(const op of regionCompositeSteps(doc,region,1,args.layerIds)){
        const pause=checkpoint();if(pause)await pause;
        if(op?.kind==="draw")ids.add(op.tilesetId);
      }
      const images=await sources([...ids],call);
      const warnings:{code:string;detail:string}[]=[];
      let highlight:PreviewHighlight|undefined;
      if(args.highlight==="lastCall"){highlight={rects:lastCallRects(args.mapId)};if(!highlight.rects!.length)warnings.push({code:"NO_LAST_CALL",detail:"No write of yours touched this map yet"});}
      else if(args.highlight==="draft"){
        const before=draftStartDocument(args.mapId,doc);
        if(!before)warnings.push({code:"NO_DRAFT",detail:"No pending edit includes this map"});
        else highlight={cells:changedCells(before,doc,region)};
      }
      const entityNames=new Map<string,string>([...BUILTIN_ENTITY_TYPES,...doc.entityTypes].map(type=>[type.id,type.name]));
      const {highlight:_requested,...previewArgs}=args;
      const result=await renderPreviewPixelsAsync(doc,region,{...previewArgs,...(highlight?{highlight}:{}),entityNames},id=>images.get(id),call);call.signal.throwIfAborted();
      if(store.revision!==mapRevision)throw new AgentError(AgentErrorCode.REVISION_CONFLICT,"Map changed during preview");
      return {png:encodeAgentPng(result),width:result.width,height:result.height,revision:rev,mapRevision,region,image:result.image,warnings:[...warnings,...result.missing.map(id=>({code:"MISSING_IMAGE",detail:id}))]};
    },
    async stampPreview(stampId,call) {
      const stamp=world.stamps().find(s=>s.id===stampId);if(!stamp)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown stamp");
      const result=await stampPixels(stamp,call);
      return{png:encodeAgentPng(result),width:result.width,height:result.height,revision:revision(),warnings:[]};
    },
  };
}
