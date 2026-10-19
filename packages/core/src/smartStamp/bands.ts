/** Layout 2: lossless tile patches, compact caps, then 47 row-major macro patches. */
import { cellFlags, cellPaletteIndex, FLIP_D, FLIP_H, FLIP_V } from "../cell";
import type { TileClip } from "../clip";
import { inverseOrientation, orientPoint, nineSliceMaskSources, type NineSliceBlit, type NineSliceLayout, type NineSliceSample } from "../nineSlice";
import type { CellPoint, CellRect } from "../geometry";
import { BLOB47_MASKS } from "./topology";

export type BandedSource = Pick<TileClip,"width"|"height"> & { readonly nineSlice?: { readonly border:number } };
export const bandWidth = (source:BandedSource):number => source.nineSlice?.border ?? 1;
const triangle = (n:number) => n*(n+1)/2;
export function bandLayout(source:BandedSource):NineSliceLayout {
 const {width:n,height:m}=source,b=bandWidth(source),sum=triangle(2*b-1);
 if(![n,m,b].every(Number.isSafeInteger)||b<1||n<=2*b||m<=2*b)throw new Error("invalid nine-slice bands");
 const collapsedWidth=n*m,collapsedHeight=collapsedWidth+sum*m,isolated=collapsedHeight+sum*n,bank=isolated+sum*sum;
 return {source:0,collapsedWidth,collapsedHeight,isolated,bank,slots:bank+47*b*b};
}
export const bandPhase = (p:number,length:number,n:number,b:number):number => p<b?p:p>=length-b?n-length+p:b+(p-b)%(n-2*b);
export function bandSample(rect:CellRect,world:CellPoint,source:BandedSource,orientation:number):NineSliceSample {
 const b=bandWidth(source),l=bandLayout(source),n=source.width,m=source.height;
 const p=orientPoint({x:world.x-rect.x,y:world.y-rect.y},rect.width,rect.height,inverseOrientation(orientation));
 const W=orientation&FLIP_D?rect.height:rect.width,H=orientation&FLIP_D?rect.width:rect.height;
 const shortX=W<2*b,shortY=H<2*b,sx=bandPhase(p.x,W,n,b),sy=bandPhase(p.y,H,m,b);
 const sum=triangle(2*b-1);
 const slot=shortX?(shortY?l.isolated+triangle(H-1)*sum+H*triangle(W-1)+p.y*W+p.x:l.collapsedWidth+triangle(W-1)*m+sy*W+p.x):shortY?l.collapsedHeight+triangle(H-1)*n+p.y*n+sx:sy*n+sx;
 // Raw contributors for grids/holes; clipping can splice inside an individual tile.
 const axis=(v:number,len:number,full:number,short:boolean)=>short?[...(v<Math.ceil(len/2)?[v]:[]),...(v>=Math.floor(len/2)?[full-len+v]:[])]:[bandPhase(v,len,full,b)];
 const sourceIndices=axis(p.y,H,m,shortY).flatMap(y=>axis(p.x,W,n,shortX).map(x=>y*n+x));
 return {...world,slot,flags:orientation,sourceIndices};
}
interface Span {start:number;end:number;source:number}
/** Piecewise pixel translation, split where the two outer bands meet. */
function spans(size:number,full:number,b:number,pixels:number):Span[] {
 if(size<2*b){const split=Math.ceil(size*pixels/2);return [{start:0,end:split,source:0},{start:split,end:size*pixels,source:full*pixels-size*pixels+split}];}
 return [{start:0,end:size*pixels,source:0}];
}
export function bandBlits(source:TileClip & BandedSource,layerId:string,tw:number,th:number):NineSliceBlit[] {
 const layer=source.layers.find(l=>l.layerId===layerId)!;
 const n=source.width,m=source.height,b=bandWidth(source),l=bandLayout(source),out:NineSliceBlit[]=[];
 const emit=(slot:number,dx:number,dy:number,sx:number,sy:number,width:number,height:number)=>{
  const index=Math.floor(sy/th)*n+Math.floor(sx/tw),cell=layer.cells[index]!;
  if(!cell)return;
  const flags=cellFlags(cell);if(flags&FLIP_D&&tw!==th)throw new Error("diagonal source orientation requires square tiles");
  let x=sx%tw,y=sy%th,w=width,h=height;
  if(flags&FLIP_H)x=tw-x-w;if(flags&FLIP_V)y=th-y-h;
  if(flags&FLIP_D){[x,y]=[y,x];[w,h]=[h,w];}
  out.push({slot,tile:source.palette[cellPaletteIndex(cell)-1]!,flags,sourceRect:{x,y,width:w,height:h},destinationRect:{x:dx,y:dy,width,height}});
 };
 // Copy one translated rectangle, splitting at source AND destination tile boundaries.
 const copy=(base:number,columns:number,dx:number,dy:number,sx:number,sy:number,w:number,h:number)=>{
  for(let y=0;y<h;){const hh=Math.min(h-y,th-(sy+y)%th,th-(dy+y)%th);
   for(let x=0;x<w;){const ww=Math.min(w-x,tw-(sx+x)%tw,tw-(dx+x)%tw);
    const slot=base+Math.floor((dy+y)/th)*columns+Math.floor((dx+x)/tw);
    emit(slot,(dx+x)%tw,(dy+y)%th,sx+x,sy+y,ww,hh);x+=ww;
   }y+=hh;
  }
 };
 const patch=(base:number,w:number,h:number)=>{
  for(const ys of spans(h,m,b,th))for(const xs of spans(w,n,b,tw))copy(base,w,xs.start,ys.start,xs.source,ys.source,xs.end-xs.start,ys.end-ys.start);
 };
 copy(0,n,0,0,0,0,n*tw,m*th);
 for(let w=1;w<2*b;w++)patch(l.collapsedWidth+triangle(w-1)*m,w,m);
 for(let h=1;h<2*b;h++)patch(l.collapsedHeight+triangle(h-1)*n,n,h);
 const sum=triangle(2*b-1);
 for(let h=1;h<2*b;h++)for(let w=1;w<2*b;w++)patch(l.isolated+triangle(h-1)*sum+h*triangle(w-1),w,h);
 // A macro role always occupies b×b tiles. Its repeat axis may have fewer
 // than b source tiles: wrap inside that segment rather than reading the
 // opposite border. Existing layout-2 sources retain identical blits/slots.
 const roleSpans=(role:number,start:number,length:number,full:number,pixels:number)=>{
  const origin=(role===2?full-b:role*b)*pixels,span=(role===1?full-2*b:b)*pixels,result:{destination:number;source:number;length:number}[]=[];
  for(let used=0;used<length;){const phase=(start+used)%span,count=Math.min(length-used,span-phase);result.push({destination:start+used,source:origin+phase,length:count});used+=count;}
  return result;
 };
 const mx=b*tw,my=b*th,left=Math.floor(mx/2),top=Math.floor(my/2);
 BLOB47_MASKS.forEach((mask,rank)=>{
  const roles=nineSliceMaskSources({width:3,height:3},mask);
  for(let q=0;q<4;q++){
   const role=roles[q]!,rx=role%3,ry=Math.floor(role/3),x=q===1||q===2?left:0,y=q>=2?top:0;
   for(const ys of roleSpans(ry,y,q>=2?my-top:top,m,th))for(const xs of roleSpans(rx,x,q===1||q===2?mx-left:left,n,tw)){
    copy(l.bank+rank*b*b,b,xs.destination,ys.destination,xs.source,ys.source,xs.length,ys.length);
   }
  }
 });
 return out;
}
