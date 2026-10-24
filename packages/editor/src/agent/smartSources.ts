import { AgentError, AgentErrorCode, type AgentMetadataPort, type AgentSmartSourcePort, type AgentWorldPort, type PreparedSmartSource, type LayerMapping, type SmartCandidateInfo } from "@smap/agent";
import { detectNineSliceSelection, findSmartCandidates, isEntityLayer, isGridLayer, makeCell, NINE_SLICE_DETECTOR_VERSION, nineSliceProblem, type Stamp, type MapStore } from "@smap/core";
import { prepareSmartStamp, discardSmartStamp, type PreparedSmartStamp } from "../commands/smartStampCommands";
import { useProjectLibrary } from "../io/projectLibrary";
import { getTilesetImage, removeTilesetImage, setTilesetImage, sourceVersionMatches, tilesetWorldVersion } from "../state/tilesetImages";
import { pngHash } from "../state/pngHash";
import { imagePixels } from "./images";

/** Candidate scans are keyed by the decoded image object and sheet grid, so edits to either rescan once. */
const candidateCache=new WeakMap<object,{grid:string;result:Promise<readonly SmartCandidateInfo[]>}>();

/** This preparation never selects a brush, stamp, layer, map tab or source rectangle. */
export function createSmartSourcePort(world: AgentWorldPort, metadata: AgentMetadataPort, followers: () => readonly MapStore[] = () => []): AgentSmartSourcePort {
  const records=new Map<string,{source:PreparedSmartSource;prepared:PreparedSmartStamp;published:boolean}>();
  const assertCurrent=(source:PreparedSmartSource)=>{
    const record=records.get(source.sourceId);
    if(!record||record.prepared.worldVersion!==tilesetWorldVersion())throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Smart source belongs to an expired world");
    for(const [id,version]of record.prepared.sources)if(!sourceVersionMatches(id,version,record.prepared.store.document.getTileset(id)))throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Smart source changed");
  };
  return {
    get:id=>records.get(id)?.source,assertCurrent,
    candidates(tilesetId,signal){
      const tileset=world.tilesets().find(t=>t.id===tilesetId),image=getTilesetImage(tilesetId);
      if(!tileset||!image||tileset.generated||tileset.edited)return Promise.resolve([]);
      const grid=JSON.stringify([tileset.columns,tileset.rows,tileset.tileWidth,tileset.tileHeight,tileset.margin,tileset.spacing]);
      const cached=candidateCache.get(image);
      if(cached?.grid===grid)return cached.result;
      // The scan is shared by every caller; a cancelled caller only stops waiting.
      const result=imagePixels(tilesetId,{aborted:false,throwIfAborted(){},onAbort:()=>()=>{}}).then(pixels=>
        findSmartCandidates({tileset,pixels,emptyIds:new Set()}).map(c=>({tilesetId,rect:{...c.rect},kind:c.kind,band:c.band})));
      result.catch(()=>{if(candidateCache.get(image)?.result===result)candidateCache.delete(image);});
      candidateCache.set(image,{grid,result});
      signal.throwIfAborted();
      return result;
    },
    async prepare(args,call,reserve){
      const store=await world.loadMap(args.mapId);call.signal.throwIfAborted();
      let stamp:Stamp;
      let forced:boolean;
      if("stampId"in args.source){
        const stampId=args.source.stampId;
        const source=world.stamps().find(s=>s.id===stampId);
        if(!source)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown stamp");
        if(!source.nineSlice&&!args.force)throw new AgentError(AgentErrorCode.SOURCE_NOT_SMART,"Stamp has no prepared smart recipe; explicit force is required");
        forced=!source.nineSlice&&!!args.force;
        stamp=source.nineSlice?source:{...source,nineSlice:{border:1,tileLayers:[]}};
      }else{
        const {tilesetId,region}=args.source,tileset=store.document.getTileset(tilesetId);
        if(!tileset)throw new AgentError(AgentErrorCode.UNKNOWN_ID,"Unknown tileset");
        if(tileset.tileWidth!==store.document.map.tileWidth||tileset.tileHeight!==store.document.map.tileHeight)throw new AgentError(AgentErrorCode.GRID_MISMATCH,"Source and map tile dimensions differ");
        if(region.x<0||region.y<0||region.x+region.width>tileset.columns||region.y+region.height>tileset.rows)throw new AgentError(AgentErrorCode.OUT_OF_BOUNDS,"Source rectangle outside tileset");
        const ids=Array.from({length:region.width*region.height},(_,i)=>(region.y+Math.floor(i/region.width))*tileset.columns+region.x+i%region.width);
        const pixels=await imagePixels(tilesetId,call.signal);
        const detected=detectNineSliceSelection({tileset,rect:{col:region.x,row:region.y,width:region.width,height:region.height},ids,emptyIds:new Set(),pixels});
        if(!detected&&!args.force)throw new AgentError(AgentErrorCode.SOURCE_NOT_SMART,"Selected pixels are not a smart source; select another rectangle or explicitly force");
        forced=!detected&&!!args.force;
        stamp={id:`agent-source-${crypto.randomUUID()}`,name:tileset.name,width:region.width,height:region.height,
          palette:ids.map(tileId=>({tilesetId,tileId})),layers:[{layerId:"tileset",name:tilesetId,cells:Uint32Array.from(ids,(_,i)=>makeCell(i+1))}],nineSlice:{border:detected?.border??1,tileLayers:[]}};
      }
      if(nineSliceProblem(stamp))throw new AgentError(AgentErrorCode.SOURCE_NOT_SMART,"Source geometry is incompatible with smart placement");
      for(const ref of stamp.palette){
        const tileset=store.document.getTileset(ref.tilesetId);
        if(!tileset)throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Smart source tileset is unavailable",{tilesetId:ref.tilesetId});
        if(tileset.tileWidth!==store.document.map.tileWidth||tileset.tileHeight!==store.document.map.tileHeight)throw new AgentError(AgentErrorCode.GRID_MISMATCH,"Source and map tile dimensions differ",{sourceTileWidth:tileset.tileWidth,sourceTileHeight:tileset.tileHeight,mapTileWidth:store.document.map.tileWidth,mapTileHeight:store.document.map.tileHeight});
      }
      const layerMapping:LayerMapping[]=[];
      if(stamp.layers.length>1){
        const used=new Set<string>();
        for(const layer of stamp.layers){
          const compatible=store.document.layers.filter(target=>!used.has(target.id)&&!isEntityLayer(target)&&(layer.grid?isGridLayer(target)&&(layer.role===undefined||target.role===layer.role):!isGridLayer(target)));
          const ids=compatible.filter(target=>target.id===layer.layerId),names=compatible.filter(target=>target.name===layer.name);
          const matches=ids.length?ids:names.length?names:compatible;
          if(matches.length!==1)throw new AgentError(AgentErrorCode.STAMP_MAPPING_REQUIRED,"Create unambiguous matching layers before preparing this multilayer source");
          used.add(matches[0]!.id);layerMapping.push({sourceLayerId:layer.layerId,targetLayerId:matches[0]!.id});
        }
      }
      // Each action owns fresh banks; cancelling cannot retire a previous action's bitmap.
      const targets=new Map(stamp.layers.filter(layer=>!layer.grid).map((layer,i)=>[layer.layerId,`agent-${crypto.randomUUID()}-${i}`]));
      let estimatedBytes=0;
      const prepared=await prepareSmartStamp(stamp,undefined,targets,undefined,undefined,store.document.map,{store,recipes:useProjectLibrary.getState().generatedRecipes,reserve(bytes){estimatedBytes=bytes;reserve?.(bytes);}});
      const sourceId=crypto.randomUUID();
      try{
        call.signal.throwIfAborted();
        const source:PreparedSmartSource={sourceId,transactionId:args.context.transactionId,mapId:args.mapId,band:prepared.stamp.nineSlice!.border,
          usages:prepared.stamp.nineSlice?.road?["area","road"]:["area"],detectorVersion:NINE_SLICE_DETECTOR_VERSION,
          fingerprint:await pngHash(new TextEncoder().encode(JSON.stringify([...prepared.sources]))),forced,generatedTilesetIds:prepared.assets.map(a=>a.tileset.id),
          layerMapping,retainedBytes:Math.max(estimatedBytes,prepared.assets.reduce((n,a)=>n+a.tileset.columns*a.tileset.rows*a.tileset.tileWidth*a.tileset.tileHeight*4+(a.image.bytes?.byteLength??0),0)),stamp:prepared.stamp,tilesets:prepared.assets.map(a=>a.tileset)};
        call.signal.throwIfAborted();
        records.set(source.sourceId,{source,prepared,published:false});assertCurrent(source);return source;
      }catch(error){records.delete(sourceId);discardSmartStamp(prepared);throw error;}
    },
    discard(source){
      const record=records.get(source.sourceId);
      if(record&&!record.published){records.delete(source.sourceId);discardSmartStamp(record.prepared);}
    },
    publish(source){
      assertCurrent(source);const record=records.get(source.sourceId)!;
      for(const asset of record.prepared.assets){
        for(const store of new Set([record.prepared.store,...followers()]))if(!store.document.getTileset(asset.tileset.id))store.dispatch({type:"addTileset",tileset:asset.tileset,undoable:true});
        setTilesetImage(asset.image);
      }
      const before=useProjectLibrary.getState().generatedRecipes,add=record.prepared.assets.map(a=>({tilesetId:a.tileset.id,stamp:record.prepared.source}));
      metadata.stage({kind:"recipes",before,after:[...before.filter(r=>!add.some(a=>a.tilesetId===r.tilesetId)),...add]});record.published=true;
    },
    releaseTransaction(id,outcome){
      let failure:unknown,failed=false;
      for(const [sourceId,record]of records)if(record.source.transactionId===id){
        if(outcome==="cancelled"||!record.published)for(const asset of record.prepared.assets){
          try{if(record.published&&getTilesetImage(asset.tileset.id)===asset.image)removeTilesetImage(asset.tileset.id);else if(!record.published)asset.image.bitmap.close();}
          catch(error){if(!failed){failure=error;failed=true;}}
        }
        // Approved images remain retained for ordinary undo/redo and save from another tab.
        records.delete(sourceId);
      }
      if(failed)throw failure;
    },
  };
}
