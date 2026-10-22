import { AGENT_LIMITS, hashCanonical, AgentError, AgentErrorCode, type AgentSignal, type AgentWorldPort, type EditorContext } from "@smap/agent";
import { tileRect } from "@smap/core";
import { useEditorStore } from "../state/editorStore";
import { useTilesetView } from "../ui/tileset/tilesetViewStore";
import { getCanvasHandle } from "../ui/canvas/canvasHandle";
import { getAgentWorldSessionId } from "./editGate";
import { getTilesetImage } from "../state/tilesetImages";
import { imagePixels } from "./images";
import { publishSelectedReference, selectedReferenceInfo } from "./selectedReference";

// Editor selections/clips are immutable snapshots. Weak summaries keep reads bounded after a selection changes.
const identities=new WeakMap<object,number>();let identity=0;
const objectToken=(value:object|null|undefined)=>{if(!value)return null;let token=identities.get(value);if(token===undefined){token=++identity;identities.set(value,token);}return token;};
const masks=new WeakMap<Uint8Array,{selectedCells:number;data:number[];truncated:boolean}>();
function maskSummary(mask:Uint8Array){
  let result=masks.get(mask);if(result)return result;
  let selectedCells=0;for(const bit of mask)if(bit)selectedCells++;
  result={selectedCells,data:Array.from(mask.subarray(0,AGENT_LIMITS.cellsPerCall)),truncated:mask.length>AGENT_LIMITS.cellsPerCall};masks.set(mask,result);return result;
}
const sources=new WeakMap<readonly number[],{columns:number;region:NonNullable<EditorContext["selection"]>["region"];tileIds:number[];truncated:boolean}>();
const membership=new WeakMap<readonly number[],ReadonlySet<number>>();
function contains(ids:readonly number[],id:number){let found=membership.get(ids);if(!found){found=new Set(ids);membership.set(ids,found);}return found.has(id);}
function sourceSelection(world:AgentWorldPort):EditorContext["selection"] {
  const editor=useEditorStore.getState(),panel=useTilesetView.getState().selection;
  const matches=panel&&(editor.stamp?panel.clip===editor.stamp:!panel.clip&&(!editor.selection||editor.selection.tilesetId===panel.tilesetId&&contains(panel.ids,editor.selection.tileId)));
  const tilesetId=matches?panel.tilesetId:editor.selection?.tilesetId;
  const ts=world.tilesets().find(t=>t.id===tilesetId);
  if(!ts)return null;
  const ids=matches?(panel.referenceIds??panel.ids):editor.selection?[editor.selection.tileId]:[];
  if(!ids.length)return null;
  let summary=sources.get(ids);
  if(!summary||summary.columns!==ts.columns){
    let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
    for(const id of ids){const cx=id%ts.columns,cy=Math.floor(id/ts.columns);x=Math.min(x,cx);y=Math.min(y,cy);right=Math.max(right,cx);bottom=Math.max(bottom,cy);}
    summary={columns:ts.columns,region:{x,y,width:right-x+1,height:bottom-y+1},tileIds:ids.slice(0,AGENT_LIMITS.cellsPerCall),truncated:ids.length>AGENT_LIMITS.cellsPerCall};sources.set(ids,summary);
  }
  return {tilesetId:ts.id,region:{...summary.region},grid:{columns:ts.columns,rows:ts.rows,tileWidth:ts.tileWidth,tileHeight:ts.tileHeight,margin:ts.margin,spacing:ts.spacing},tileIds:[...summary.tileIds],truncated:summary.truncated};
}
/** UI selection has an independent token: panning/selecting does not alter content revision. */
export function captureEditorContext(world:AgentWorldPort,revision:number):EditorContext {
  const state=useEditorStore.getState(),projectId=state.project?.levelId;
  const mapId=projectId&&world.maps().some(map=>map.id===projectId)?projectId:null,region=state.region,clip=state.stamp;
  const mask=region?.mask?maskSummary(region.mask):null;
  const selectedCells=mask?.selectedCells??(region?region.width*region.height:0);
  const stampId=clip&&"id"in clip&&typeof clip.id==="string"&&world.stamps().some(s=>s.id===clip.id)?clip.id:null;
  const data:Omit<EditorContext,"contextToken">={
    activeMapId:mapId,activeLayerId:mapId?state.activeLayerId:null,tool:state.tool,
    selection:sourceSelection(world),
    stamp:clip?{stampId,width:clip.width,height:clip.height,layerIds:clip.layers.map(l=>l.layerId)}:null,
    region:region?{bounds:{x:region.x,y:region.y,width:region.width,height:region.height},selectedCells,masked:!!region.mask,mask:mask?[...mask.data]:null,truncated:mask?.truncated??false}:null,
    viewport:getCanvasHandle()?.captureViewport()??null,
    reference:selectedReferenceInfo(getAgentWorldSessionId()),
  };
  // Identity includes off-page immutable selection changes without serializing all cells.
  const panel=useTilesetView.getState().selection;
  const token=hashCanonical([getAgentWorldSessionId(),revision,data,objectToken(region?.mask),objectToken(panel?.referenceIds??panel?.ids),objectToken(clip)]);
  return {contextToken:token,...data};
}
/** Called only by the user's Share selection action; strips atlas gutters for exact matcher input. */
export async function shareSelectedReference(world:AgentWorldPort,signal:AgentSignal):Promise<void> {
  const selection=sourceSelection(world),worldId=getAgentWorldSessionId();
  if(!selection||!worldId||selection.truncated||selection.tileIds.length!==selection.region.width*selection.region.height)
    throw new AgentError(AgentErrorCode.INVALID_ARGUMENT,"Select a bounded rectangular tileset region first");
  const ts=world.tilesets().find(t=>t.id===selection.tilesetId)!;
  const image=getTilesetImage(ts.id),grid=JSON.stringify(ts),source=await imagePixels(ts.id,signal),region=selection.region;
  const width=region.width*ts.tileWidth,height=region.height*ts.tileHeight;
  if(width>AGENT_LIMITS.imageSide||height>AGENT_LIMITS.imageSide||width*height>AGENT_LIMITS.imagePixels)throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED,"Selected reference exceeds image budget");
  const data=new Uint8Array(width*height*4);
  for(let cy=0;cy<region.height;cy++)for(let cx=0;cx<region.width;cx++){
    const rect=tileRect(ts,(region.y+cy)*ts.columns+region.x+cx);
    if(rect.x+rect.width>source.width||rect.y+rect.height>source.height)throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Selection exceeds current source image");
    for(let y=0;y<rect.height;y++)data.set(source.data.subarray(((rect.y+y)*source.width+rect.x)*4,((rect.y+y)*source.width+rect.x+rect.width)*4),((cy*ts.tileHeight+y)*width+cx*ts.tileWidth)*4);
  }
  signal.throwIfAborted();
  if(worldId!==getAgentWorldSessionId()||getTilesetImage(ts.id)!==image||JSON.stringify(world.tilesets().find(t=>t.id===ts.id))!==grid||JSON.stringify(sourceSelection(world))!==JSON.stringify(selection))
    throw new AgentError(AgentErrorCode.SOURCE_CHANGED,"Selection changed while capturing reference");
  publishSelectedReference(worldId,{width,height,data});
}
