/** Conservative, pure selection classification. Layout 1 only: wider corner bands stay ordinary brushes. */
import type { Tileset } from "../tileset";
export interface NineSliceSelectionInput {
  readonly tileset: Pick<Tileset,"id"|"columns"|"rows"|"tileWidth"|"tileHeight"|"margin"|"spacing">;
  readonly rect: { readonly col:number;readonly row:number;readonly width:number;readonly height:number };
  readonly ids: readonly number[];
  readonly emptyIds: ReadonlySet<number>;
  readonly pixels?: {readonly width:number;readonly height:number;readonly originX?:number;readonly originY?:number;readonly data:Uint8Array|Uint8ClampedArray};
}
export interface NineSliceDetection {
  readonly version:1; readonly border:1;
  readonly xBands:readonly [number,number,number];readonly yBands:readonly [number,number,number];
  readonly reason:"three-by-three"|"repeating-bands";readonly sourceIds:readonly number[];
}
/** Thresholds are part of detector version 1; compare premultiplied RGBA, ignoring invisible RGB. */
export function detectNineSliceSelection(s:NineSliceSelectionInput):NineSliceDetection|null {
  const {tileset:t,rect:r,ids,pixels:p}=s, {width:w,height:h,col,row}=r;
  const ox=p?.originX??0,oy=p?.originY??0;
  if(![w,h,col,row,t.columns,t.rows,t.tileWidth,t.tileHeight,t.margin,t.spacing].every(Number.isSafeInteger)||w<3||h<3||col<0||row<0||col+w>t.columns||row+h>t.rows||t.tileWidth<1||t.tileHeight<1||t.margin<0||t.spacing<0||ids.length!==w*h) return null;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const id=ids[y*w+x]; if(id!==(row+y)*t.columns+col+x||s.emptyIds.has(id)) return null;
  }
  if(p && (![p.width,p.height,ox,oy].every(Number.isSafeInteger)||ox<0||oy<0||ox>t.margin+col*(t.tileWidth+t.spacing)||oy>t.margin+row*(t.tileHeight+t.spacing)||p.data.length!==p.width*p.height*4||t.margin+(col+w-1)*(t.tileWidth+t.spacing)+t.tileWidth>ox+p.width||t.margin+(row+h-1)*(t.tileHeight+t.spacing)+t.tileHeight>oy+p.height)) return null;
  const rgba=(x:number,y:number,px:number,py:number):readonly number[]=>{
    const i=((t.margin+(row+y)*(t.tileHeight+t.spacing)+py-oy)*p!.width+t.margin+(col+x)*(t.tileWidth+t.spacing)+px-ox)*4,a=p!.data[i+3]!;
    return [p!.data[i]!*a/255,p!.data[i+1]!*a/255,p!.data[i+2]!*a/255,a];
  };
  if(p) for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    let opaque=false;for(let py=0;py<t.tileHeight&&!opaque;py++) for(let px=0;px<t.tileWidth;px++) if(rgba(x,y,px,py)[3]){opaque=true;break;}
    if(!opaque) return null;
  }
  const result=(reason:NineSliceDetection["reason"]):NineSliceDetection=>Object.freeze({version:1,border:1,xBands:Object.freeze([1,w-2,1] as const),yBands:Object.freeze([1,h-2,1] as const),reason,sourceIds:Object.freeze([...ids])});
  if(w===3&&h===3) return result("three-by-three");
  if(!p) return null;
  const compare=(ax:number,ay:number,bx:number,by:number,distinct=false)=>{
    let good=0,diff=0,sum=0;const count=t.tileWidth*t.tileHeight;
    for(let py=0;py<t.tileHeight;py++) for(let px=0;px<t.tileWidth;px++) {
      const a=rgba(ax,ay,px,py),b=rgba(bx,by,px,py),ds=a.map((v,i)=>Math.abs(v-b[i]!));
      const max=Math.max(...ds);if(max<=8) good++;if(max>16) diff++;sum+=ds.reduce((a,b)=>a+b,0);
    }
    return distinct ? diff/count>=.05 : good/count>=.99&&sum/(count*4)<=2;
  };
  const phase=(v:number,n:number)=>v===0?0:v===n-1?n-1:1;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(!compare(x,y,phase(x,w),phase(y,h))) return null;
  for(const [x,y] of [[1,0],[0,1],[w-1,1],[1,h-1]]) if(!compare(x!,y!,1,1,true)) return null;
  for(const [x,y,nx,ny,wx,wy] of [[0,0,1,0,0,1],[w-1,0,1,0,w-1,1],[0,h-1,1,h-1,0,1],[w-1,h-1,1,h-1,w-1,1]]) if(!compare(x!,y!,nx!,ny!,true)||!compare(x!,y!,wx!,wy!,true)) return null;
  // All actual joins, including repeated strips/centre, must be continuous.
  const join=(x:number,y:number,dx:number,dy:number)=>{
    let good=0;const count=dx?t.tileHeight:t.tileWidth;
    for(let i=0;i<count;i++) {
      const a=rgba(x,y,dx?t.tileWidth-1:i,dy?t.tileHeight-1:i),b=rgba(x+dx,y+dy,dx?0:i,dy?0:i);
      if(a.every((v,c)=>Math.abs(v-b[c]!)<=32)) good++;
    }
    return good/count>=.95;
  };
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if((x<w-1&&!join(x,y,1,0))||(y<h-1&&!join(x,y,0,1))) return null;
  return result("repeating-bands");
}
