/** Lift the unit solver onto a world-origin-aligned b×b lattice. No pixel work occurs while painting. */
import type { CellRect } from "../geometry";
import { inverseOrientation, orientPoint } from "../nineSlice";
import { BLOB47_MASKS } from "./topology";
import { roadMembership, solveRoadFromReader, type RoadMembership, type RoadSolveOptions, type RoadTileReader, type RoadTileWrite } from "./roadSolver";

const logicalProfile={tiles:BLOB47_MASKS.map((mask,tileId)=>({mask,tileId}))};
export function macroRect(r:CellRect,b:number):CellRect {
 const x=Math.floor(r.x/b),y=Math.floor(r.y/b);
 return {x,y,width:Math.ceil((r.x+r.width)/b)-x,height:Math.ceil((r.y+r.height)/b)-y};
}
export function solveMacroRoad(reader:RoadTileReader,tilesetId:string,bank:number,b:number,membership:RoadMembership,options:RoadSolveOptions):RoadTileWrite[] {
 const read=(x:number,y:number)=>{
  let rank:number|undefined,flags=0;
  for(let dy=0;dy<b;dy++)for(let dx=0;dx<b;dx++){
   const wx=x*b+dx,wy=y*b+dy;if(wx>=reader.width||wy>=reader.height)continue;
   const cell=reader.read(wx,wy);
   if(cell.tile===null){if(rank!==undefined)return {tile:undefined};continue;}
   if(!cell.tile||cell.tile.tilesetId!==tilesetId)return {tile:undefined};
   const slot=cell.tile.tileId-bank,r=Math.floor(slot/(b*b)),f=cell.flags??0;
   if(slot<0||r>=47||(rank!==undefined&&(rank!==r||flags!==f)))return {tile:undefined};
   const local=orientPoint({x:dx,y:dy},b,b,inverseOrientation(f));
   if(slot-r*b*b!==local.y*b+local.x)return {tile:undefined};
   rank=r;flags=f;
  }
  // Reject partially erased patches, rather than treating unrelated cells as a road.
  if(rank!==undefined)for(let dy=0;dy<b;dy++)for(let dx=0;dx<b;dx++)if(x*b+dx<reader.width&&y*b+dy<reader.height&&!reader.read(x*b+dx,y*b+dy).tile)return {tile:undefined};
  return {tile:rank===undefined?null:{tilesetId,tileId:rank},flags};
 };
 let members:RoadMembership;
 if(membership.cells)members=roadMembership(membership.cells.map(p=>({x:Math.floor(p.x/b),y:Math.floor(p.y/b)})));
 else {const bounds=macroRect(membership.bounds,b);members={bounds,contains:(x,y)=>{
  for(let dy=0;dy<b;dy++)for(let dx=0;dx<b;dx++)if(membership.contains(x*b+dx,y*b+dy))return true;return false;
 }};}
 const logical={...reader,width:Math.ceil(reader.width/b),height:Math.ceil(reader.height/b),read};
 const window=options.window?macroRect(options.window,b):undefined;
 const writes=solveRoadFromReader(logical,logicalProfile,tilesetId,members,{...options,...(window?{window}:{})});
 const out:RoadTileWrite[]=[];
 for(const w of writes)for(let y=0;y<b;y++)for(let x=0;x<b;x++){
  const p=orientPoint({x,y},b,b,w.flags??0),wx=w.x*b+p.x,wy=w.y*b+p.y;
  if(wx>=reader.width||wy>=reader.height)continue;
  // A diagonal orientation rotates the patch interior as well as each tile's pixels.
  out.push({x:wx,y:wy,tile:w.tile?{tilesetId,tileId:bank+w.tile.tileId*b*b+y*b+x}:null,...(w.flags?{flags:w.flags}:{})});
 }
 return out.sort((a,c)=>a.y-c.y||a.x-c.x);
}
