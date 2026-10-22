import { makeStampId, normalizeProjectSettings, normalizeStampMeta, stampMetaProblem, type Stamp } from "@smap/core";
import { AGENT_LIMITS as L, AgentError, AgentErrorCode as E, type ToolArguments } from "../contracts";
import type { Transactions } from "../transactions";
import { check } from "../validation";
import { change } from "./mutations";

export function editMap(tx: Transactions, args: ToolArguments["edit_map"]) {
  const store=tx.store(args.mapId),before=tx.host.world.maps().find(map=>map.id===args.mapId)!;
  if(args.name!==undefined)check(args.name.trim().length>0,E.INVALID_ARGUMENT,"Map name must not be blank");
  const retained=2048+(args.name?.length??0)*2;
  tx.charge(0,retained);
  tx.run(()=>{
    if(args.name!==undefined)tx.host.metadata.stage({kind:"mapName",mapId:args.mapId,before:before.name,after:args.name.trim()});
    if(args.world)tx.host.metadata.stage({kind:"mapPosition",mapId:args.mapId,before:before.world,after:args.world});
    tx.host.metadata.publish();
  });
  const result=change(args.mapId,store);tx.record(result,retained);
  return {change:result,map:tx.host.world.maps().find(map=>map.id===args.mapId)!};
}
export function editStamp(tx: Transactions, args: ToolArguments["edit_stamp"]) {
  const before=[...tx.host.world.stamps()],stamp=before.find(s=>s.id===args.stampId);
  check(stamp,E.UNKNOWN_ID,"Unknown stamp");
  const retained=4096+before.length*16+stamp.palette.length*128+stamp.layers.reduce((sum,l)=>sum+l.cells.byteLength,0);
  let after: Stamp[],resultStamp: Stamp | null;
  if(args.action==="remove"){after=before.filter(s=>s.id!==stamp.id);resultStamp=null;}
  else {
    const patch=args.action==="duplicate"?{name:args.name}:args.props;
    if(patch.name!==undefined)check(patch.name.trim().length>0,E.INVALID_ARGUMENT,"Stamp name must not be blank");
    const meta={category:stamp.category??"",tags:[...(stamp.tags??[])],favorite:stamp.favorite??false,...patch};
    const problem=stampMetaProblem(meta);check(!problem,E.INVALID_ARGUMENT,problem??"Invalid stamp metadata");
    const {category:_category,tags:_tags,favorite:_favorite,...base}=stamp;
    const name=(patch.name??stamp.name).trim();
    const id=args.action==="duplicate"?makeStampId(name,[...before.map(s=>s.id),...tx.host.metadata.snapshot().brokenStampFiles.map(path=>path.slice(path.lastIndexOf("/")+1).replace(/\.json$/,""))]):stamp.id;
    resultStamp=Object.freeze({...base,id,name,...normalizeStampMeta(meta)});
    after=args.action==="duplicate"?[...before,resultStamp]:before.map(s=>s.id===stamp.id?resultStamp!:s);
  }
  check(retained<=L.retainedBytes,E.LIMIT_EXCEEDED,"Stamp metadata exceeds edit memory budget");
  tx.charge(0,retained);tx.run(()=>tx.host.metadata.stage({kind:"stamps",before,after}));
  const result=change();tx.record(result,retained);
  return {change:result,stamp:resultStamp?{id:resultStamp.id,name:resultStamp.name,width:resultStamp.width,height:resultStamp.height,category:resultStamp.category??"",tags:[...(resultStamp.tags??[])],favorite:resultStamp.favorite??false}:null,stampId:resultStamp?.id??stamp.id,action:args.action};
}
export function configureWorld(tx: Transactions,args:ToolArguments["configure_world"]) {
  const before=tx.host.metadata.snapshot().project.settings??tx.host.world.settings(),p=args.settings;
  let after: ReturnType<typeof normalizeProjectSettings>;
  try { after=normalizeProjectSettings({...before,...p,newLevel:{...before.newLevel,...p.newLevel}}); }
  catch(error) { throw new AgentError(E.INVALID_ARGUMENT,error instanceof Error?error.message:"Invalid world settings"); }
  check(after.newLevel.width*after.newLevel.height<=L.mapArea,E.LIMIT_EXCEEDED,"Default map area exceeds limit");
  check(after.layerTemplate.length<=L.layersPerMap,E.LIMIT_EXCEEDED,"Layer template exceeds limit");
  const retained=4096+after.layerTemplate.length*512;tx.charge(0,retained);
  tx.run(()=>tx.host.metadata.stage({kind:"worldSettings",before,after}));const result=change();tx.record(result,retained);
  return {change:result,settings:after};
}
