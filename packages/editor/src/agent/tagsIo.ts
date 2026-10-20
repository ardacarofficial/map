import { t } from "../i18n";
import { toast } from "../ui/toast/toastStore";
import { AGENT_LIMITS, AgentError, AgentErrorCode, type AgentImagePort, type AgentTagsPort, type AgentWorldPort, type TagRecord, type TagsAvailability, type TagsSidecar, type TagTarget, type ToolData } from "@smap/agent";
import { FileNotFoundError, type ProjectFileSystem } from "../io/fs";
import { cancelPendingEdit } from "./editGate";

const empty = (): TagsSidecar => ({ format:"smap-ai-tags",tagFormatVersion:1,tiles:[],stamps:[] });
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const key=(target:TagTarget)=>target.kind==="tile"?JSON.stringify(["tile",target.tilesetId,target.tileId]):JSON.stringify(["stamp",target.stampId]);
const words=(tags:readonly string[])=>[...new Set(tags.map(s=>s.trim().normalize("NFC")))].sort(compare);
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join()!==keys.sort().join())throw Error("Invalid tag record");
}
export function parseTagsSidecar(text:string): TagsSidecar {
  if(new TextEncoder().encode(text).length>AGENT_LIMITS.tagsFileBytes)throw Error("oversized");
  const value:unknown=JSON.parse(text);
  if(value&&typeof value==="object"&&"tagFormatVersion"in value&&typeof value.tagFormatVersion==="number"&&value.tagFormatVersion>1)throw Error("futureVersion");
  exact(value,["format","tagFormatVersion","tiles","stamps"]);
  if(value.format!=="smap-ai-tags"||value.tagFormatVersion!==1||!Array.isArray(value.tiles)||!Array.isArray(value.stamps)||value.tiles.length>AGENT_LIMITS.tileTagRecords||value.stamps.length>AGENT_LIMITS.stampTagRecords)throw Error("Invalid tags file");
  const seen=new Set<string>();
  for(const [kind,records]of [["tile",value.tiles],["stamp",value.stamps]] as const)for(const record of records){
    exact(record,kind==="tile"?["tilesetId","tileId","fingerprint","tags","note"]:["stampId","fingerprint","tags","note"]);
    const id=kind==="tile"?record.tilesetId:record.stampId;
    if(typeof id!=="string"||!id.length||id.length>128||typeof record.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(record.fingerprint)||typeof record.note!=="string"||record.note.length>256||!Array.isArray(record.tags)||record.tags.length>16||record.tags.some(t=>typeof t!=="string"||!t.trim()||t.length>48))throw Error("Invalid tags record");
    if(kind==="tile"&&(!Number.isSafeInteger(record.tileId)||(record.tileId as number)<0))throw Error("Invalid tile id");
    const identity=JSON.stringify([kind,id,record.tileId??null]);if(seen.has(identity))throw Error("Duplicate tag identity");seen.add(identity);
  }
  return value as unknown as TagsSidecar;
}
export function serializeTagsSidecar(sidecar:TagsSidecar):string {
  const tiles=[...sidecar.tiles].sort((a,b)=>compare(a.tilesetId,b.tilesetId)||a.tileId-b.tileId).map(r=>({tilesetId:r.tilesetId,tileId:r.tileId,fingerprint:r.fingerprint,tags:words(r.tags),note:r.note}));
  const stamps=[...sidecar.stamps].sort((a,b)=>compare(a.stampId,b.stampId)).map(r=>({stampId:r.stampId,fingerprint:r.fingerprint,tags:words(r.tags),note:r.note}));
  const text=JSON.stringify({format:"smap-ai-tags",tagFormatVersion:1,tiles,stamps},null,2)+"\n";parseTagsSidecar(text);return text;
}
export interface TagsIoPort extends AgentTagsPort { reload():Promise<void>; folderChanged():Promise<void>; externalChange():Promise<void>; dispose():void }
export function createTagsPort(deps:{world:AgentWorldPort;images:AgentImagePort;folder:()=>ProjectFileSystem|null;worldId:()=>string|null}):TagsIoPort {
  let state:TagsAvailability={state:"ready",sidecar:empty()},worldId=deps.worldId(),known:string|null=null,dirty=false,timer:ReturnType<typeof setTimeout>|undefined;
  let loading:Promise<void>|null=null,queue=Promise.resolve(),initialized=false;
  const listeners=new Set<()=>void>(),emit=()=>{for(const cb of listeners){try{cb();}catch{console.warn("AI tags observer failed");}}};
  const ensureWorld=()=>{if(worldId!==deps.worldId()){worldId=deps.worldId();known=null;dirty=false;loading=null;initialized=false;state={state:"ready",sidecar:empty()};}};
  const assertContext=(id:string)=>{ensureWorld();if(id!==worldId)throw new AgentError(AgentErrorCode.STALE_WORLD,"Tags world has changed");};
  async function reload(){
    ensureWorld();initialized=true;const fs=deps.folder(),epoch=worldId;
    if(!fs){state={state:"ready",sidecar:empty()};emit();return;}
    loading=(async()=>{try{const text=await fs.readText("ai-tags.json");if(epoch!==deps.worldId())return;const sidecar=parseTagsSidecar(text);state={state:"ready",sidecar};known=text;dirty=false;}
    catch(error){if(epoch!==deps.worldId())return;if(error instanceof FileNotFoundError){state={state:"ready",sidecar:empty()};known=null;dirty=false;}
    else{const reason=error instanceof Error&&["futureVersion","oversized"].includes(error.message)?error.message as "futureVersion"|"oversized":error instanceof SyntaxError||error instanceof Error&&error.message.startsWith("Invalid")||error instanceof Error&&error.message.startsWith("Duplicate")?"malformed":"io";state={state:"unavailable",reason,detail:"AI tags unavailable"};}}
    if(state.state==="unavailable")toast.warning(t("aiRuntime.tagsUnavailable",{detail:state.reason}));
    emit();})();await loading;
  }
  async function ready(){ensureWorld();if(loading)await loading;else if(!initialized)await reload();}
  async function flush(){
    if(timer){clearTimeout(timer);timer=undefined;}
    await ready();if(!dirty||state.state!=="ready")return queue;
    const fs=deps.folder(),epoch=worldId;if(!fs)return;
    const text=serializeTagsSidecar(state.sidecar);dirty=false;
    queue=queue.catch(()=>{}).then(async()=>{
      if(epoch!==deps.worldId())return;
      try{await fs.writeText("ai-tags.json",text);if(epoch===deps.worldId())known=text;}
      catch(error){if(epoch===deps.worldId())dirty=true;throw error;}
    });return queue;
  }
  const fingerprint=async(target:TagTarget,call:Parameters<AgentTagsPort["get"]>[1])=>target.kind==="tile"?deps.images.tileFingerprint(target.tilesetId,target.tileId,call.signal):deps.images.stampFingerprint(target.stampId,call.signal);
  return {
    availability(){ensureWorld();return state;},reload,flush,
    async folderChanged(){
      await ready();
      if(state.state!=="ready" || (known===null && !state.sidecar.tiles.length && !state.sidecar.stamps.length))return;
      const fs=deps.folder();if(!fs)return;
      let destination:string|null=null;
      try{destination=await fs.readText("ai-tags.json");}catch(error){if(!(error instanceof FileNotFoundError))throw error;}
      if(destination!==null){try{parseTagsSidecar(destination);}catch{await reload();return;}}
      dirty=true;await flush();
    },
    subscribe(cb){listeners.add(cb);return()=>{listeners.delete(cb);};},
    dispose(){if(timer)clearTimeout(timer);listeners.clear();},
    async externalChange(){const fs=deps.folder();if(!fs)return;let text:string|null=null;try{text=await fs.readText("ai-tags.json");}catch(error){if(!(error instanceof FileNotFoundError))return;}
      if(text===known)return;await cancelPendingEdit();loading=null;await reload();},
    async get(args,call){
      await ready();assertContext(args.context.worldSessionId);if(state.state!=="ready")throw new AgentError(AgentErrorCode.DISK_CONFLICT,"AI tags are unavailable");
      const sidecar=state.sidecar,targets:TagTarget[]=[];
      if(args.kind==="stamps"){for(const stamp of deps.world.stamps())targets.push({kind:"stamp",stampId:stamp.id});for(const r of sidecar.stamps)if(!targets.some(t=>t.kind==="stamp"&&t.stampId===r.stampId))targets.push({kind:"stamp",stampId:r.stampId});}
      else{for(const ts of deps.world.tilesets()){if(args.tilesetId&&ts.id!==args.tilesetId)continue;for(let tileId=0;tileId<(ts.edited?.nextTileId??ts.columns*ts.rows);tileId++)targets.push({kind:"tile",tilesetId:ts.id,tileId});}
        const ids=new Set(targets.map(key));for(const r of sidecar.tiles)if((!args.tilesetId||r.tilesetId===args.tilesetId)&&!ids.has(key({kind:"tile",...r})))targets.push({kind:"tile",tilesetId:r.tilesetId,tileId:r.tileId});}
      const offset=args.cursor?Number(args.cursor):0;if(!Number.isSafeInteger(offset)||offset<0)throw new AgentError(AgentErrorCode.INVALID_ARGUMENT,"Invalid tags cursor");
      const items:TagRecord[]=[],limit=Math.min(args.limit??64,128);let index=offset;
      for(;index<targets.length&&items.length<limit;index++){
        const target=targets[index]!,stored=target.kind==="tile"?sidecar.tiles.find(r=>r.tilesetId===target.tilesetId&&r.tileId===target.tileId):sidecar.stamps.find(r=>r.stampId===target.stampId);
        let currentFingerprint:string|null=null;try{currentFingerprint=await fingerprint(target,call);}catch{call.signal.throwIfAborted();}
        const status=!stored?"missing":stored.fingerprint===currentFingerprint?"current":"stale";
        if((args.status??"missing")!=="all"&&status!==(args.status??"missing"))continue;
        items.push({target,tags:stored?.tags??[],note:stored?.note??"",status,...(stored?{storedFingerprint:stored.fingerprint}:{}),currentFingerprint});
      }
      assertContext(args.context.worldSessionId);return{items,nextCursor:index<targets.length?String(index):null};
    },
    async set(args,call){
      await ready();assertContext(args.context.worldSessionId);if(state.state!=="ready")throw new AgentError(AgentErrorCode.DISK_CONFLICT,"AI tags are unavailable");
      const updated:ToolData["set_tags"]["updated"]=[];
      for(const entry of args.entries){const current=await fingerprint(entry.target,call);if(current!==entry.expectedFingerprint)throw new AgentError(AgentErrorCode.TAG_FINGERPRINT_CHANGED,"Tile or stamp pixels changed");updated.push({target:entry.target,fingerprint:current,tags:words(entry.tags),note:entry.note??"",status:"current"});}
      call.signal.throwIfAborted();assertContext(args.context.worldSessionId);
      const next:TagsSidecar={...state.sidecar,tiles:[...state.sidecar.tiles],stamps:[...state.sidecar.stamps]};
      // Apply the entire prevalidated batch together, including duplicate-target replacements.
      for(const entry of updated){if(entry.target.kind==="tile"){const target=entry.target;next.tiles=next.tiles.filter(r=>!(r.tilesetId===target.tilesetId&&r.tileId===target.tileId));next.tiles.push({tilesetId:target.tilesetId,tileId:target.tileId,fingerprint:entry.fingerprint,tags:entry.tags,note:entry.note});}
        else{const target=entry.target;next.stamps=next.stamps.filter(r=>r.stampId!==target.stampId);next.stamps.push({stampId:target.stampId,fingerprint:entry.fingerprint,tags:entry.tags,note:entry.note});}}
      parseTagsSidecar(serializeTagsSidecar(next));state={state:"ready",sidecar:next};dirty=true;emit();
      timer??=setTimeout(()=>{void flush().catch(()=>{toast.warning(t("aiRuntime.tagsUnavailable",{detail:"IO"}));});},AGENT_LIMITS.tagsDebounceMs);
      return{updated,change:{plannedCells:0,changedCells:0,affected:[],createdLayerIds:[],createdEntityIds:[]}};
    },
  };
}
