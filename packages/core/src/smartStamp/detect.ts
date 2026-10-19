/** Conservative, pure selection classification. Thresholds and band inference are versioned together. */
export const NINE_SLICE_DETECTOR_VERSION = 6;
export const NINE_SLICE_DETECTION_THRESHOLDS = Object.freeze({ repeatFraction: .99, repeatDelta: 8, repeatMean: 2, distinctFraction: .05, distinctDelta: 16, seamFraction: .95, seamDelta: 32, seamGradientRatio: 2, boundaryFraction: .95, boundaryDelta: 16 });
import type { Tileset } from "../tileset";
export interface NineSliceSelectionInput {
  readonly tileset: Pick<Tileset,"id"|"columns"|"rows"|"tileWidth"|"tileHeight"|"margin"|"spacing">;
  readonly rect: { readonly col:number;readonly row:number;readonly width:number;readonly height:number };
  readonly ids: readonly number[];
  readonly emptyIds: ReadonlySet<number>;
  readonly pixels?: {readonly width:number;readonly height:number;readonly originX?:number;readonly originY?:number;readonly data:Uint8Array|Uint8ClampedArray};
}
export interface NineSliceDetection {
  readonly version:6; readonly border:number;
  readonly xBands:readonly [number,number,number];readonly yBands:readonly [number,number,number];
  readonly reason:"three-by-three"|"repeating-bands";readonly sourceIds:readonly number[];
}
/** Thresholds are part of detector version 6; compare premultiplied RGBA, ignoring invisible RGB. */
export function detectNineSliceSelection(s:NineSliceSelectionInput):NineSliceDetection|null {
  const thresholds=NINE_SLICE_DETECTION_THRESHOLDS;
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
  const result=(reason:NineSliceDetection["reason"],border=1):NineSliceDetection=>Object.freeze({version:NINE_SLICE_DETECTOR_VERSION,border,xBands:Object.freeze([border,w-2*border,border] as const),yBands:Object.freeze([border,h-2*border,border] as const),reason,sourceIds:Object.freeze([...ids])});
  if(!p) return null;
  const compare=(ax:number,ay:number,bx:number,by:number,distinct=false)=>{
    let good=0,diff=0,sum=0;const count=t.tileWidth*t.tileHeight;
    for(let py=0;py<t.tileHeight;py++) for(let px=0;px<t.tileWidth;px++) {
      const a=rgba(ax,ay,px,py),b=rgba(bx,by,px,py),ds=a.map((v,i)=>Math.abs(v-b[i]!));
      const max=Math.max(...ds);if(max<=thresholds.repeatDelta) good++;if(max>thresholds.distinctDelta) diff++;sum+=ds.reduce((a,b)=>a+b,0);
    }
    return distinct ? diff/count>=thresholds.distinctFraction : good/count>=thresholds.repeatFraction&&sum/(count*4)<=thresholds.repeatMean;
  };
  // All actual joins, including repeated strips/centre, must be continuous.
  const join=(x:number,y:number,dx:number,dy:number)=>{
    let good=0;const count=dx?t.tileHeight:t.tileWidth;
    for(let i=0;i<count;i++) {
      const a=rgba(x,y,dx?t.tileWidth-1:i,dy?t.tileHeight-1:i),b=rgba(x+dx,y+dy,dx?0:i,dy?0:i);
      if(a.every((v,c)=>Math.abs(v-b[c]!)<=thresholds.seamDelta)) good++;
    }
    return good/count>=thresholds.seamFraction;
  };
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if((x<w-1&&!join(x,y,1,0))||(y<h-1&&!join(x,y,0,1))) return null;
  // Repetition within a borderless material is not evidence for an outside band.
  // Each axis must terminate: reject globally periodic rows/columns with at least
  // two observed copies. Unlike a full-span segment, these compare different tiles.
  const globallyPeriodic=(horizontal:boolean)=>{
    const span=horizontal?w:h;
    for(let step=1;step<=Math.floor(span/2);step++){
      let repeats=true;
      for(let y=0;y<h&&repeats;y++)for(let x=0;x<w;x++){
        if((horizontal?x:y)<step)continue;
        if(!compare(x,y,horizontal?x-step:x,horizontal?y:y-step)){repeats=false;break;}
      }
      if(repeats)return true;
    }
    return false;
  };
  if(globallyPeriodic(true)||globallyPeriodic(false))return null;
  for(let b=1;b<=Math.floor((Math.min(w,h)-1)/2);b++) {
    let valid=true;
    // Each strip/centre can have its own segment period. A full remaining span
    // is a valid single segment; it still needs all distinctness and seam evidence.
    const period=(x0:number,y0:number,width:number,height:number,horizontal:boolean):number=>{
      const span=horizontal?width:height;
      for(let step=1;step<=span;step++){
        if(span%step || (b===1&&step!==1))continue;
        let repeats=true;
        // The first segment has no observed repeat; never compare it with itself.
        // A full-span segment relies on boundary/distinctness and wrap evidence.
        for(let y=0;y<height&&repeats;y++)for(let x=0;x<width;x++){
          if((horizontal?x:y)<step)continue;
          if(!compare(x0+x,y0+y,x0+(horizontal?x%step:x),y0+(horizontal?y:y%step))){repeats=false;break;}
        }
        if(repeats)return step;
      }
      return 0;
    };
    const cx=w-2*b,cy=h-2*b;
    const strips=[[b,0,cx,b,true],[b,h-b,cx,b,true],[0,b,b,cy,false],[w-b,b,b,cy,false],[b,b,cx,cy,true],[b,b,cx,cy,false]] as const;
    const periods=strips.map(([x,y,width,height,horizontal])=>period(x,y,width,height,horizontal));
    if(periods.some(v=>v===0))continue;
    // A different random tile colour is not boundary evidence. For thick bands
    // (and thin full-span segments with no observed repeat), require mirrored
    // opposite profiles at EVERY segment position, plus coherent corner profiles.
    const fullSpan=periods.some((step,i)=>step===(strips[i]![4]?strips[i]![2]:strips[i]![3]));
    if(b>1||fullSpan){
      const pixel=(x:number,y:number)=>rgba(Math.floor(x/t.tileWidth),Math.floor(y/t.tileHeight),x%t.tileWidth,y%t.tileHeight);
      const oppositeProfiles=(horizontal:boolean)=>{
        const normal=horizontal?t.tileHeight:t.tileWidth,tangent=horizontal?t.tileWidth:t.tileHeight,span=horizontal?cx:cy;
        for(let segment=0;segment<span;segment++){
          let good=0;
          for(let d=0;d<b*normal;d++)for(let u=0;u<tangent;u++){
            const along=(b+segment)*tangent+u;
            const a=horizontal?pixel(along,d):pixel(d,along),c=horizontal?pixel(along,h*t.tileHeight-1-d):pixel(w*t.tileWidth-1-d,along);
            if(a.every((v,i)=>Math.abs(v-c[i]!)<=thresholds.boundaryDelta))good++;
          }
          if(good/(b*normal*tangent)<thresholds.boundaryFraction)return false;
        }
        return true;
      };
      // Compare the inward-facing column/row of each corner to its adjacent
      // edge. Ignore tile gutters and allow a constant RGB tint offset: the
      // depth PROFILE must continue, not necessarily the corner's colour.
      const cornerProfile=(horizontal:boolean,corner:number,edge:number,far:boolean)=>{
        const normal=horizontal?t.tileHeight:t.tileWidth;
        if(t.tileWidth<3||t.tileHeight<3)return false;
        const pairs:{a:readonly number[];c:readonly number[]}[]=[],offset=[0,0,0,0];
        for(let d=1;d<b*normal-1;d++){
          if(d%normal===0||d%normal===normal-1)continue;
          const n=far?(horizontal?h*t.tileHeight:w*t.tileWidth)-1-d:d;
          const a=horizontal?pixel(corner,n):pixel(n,corner),c=horizontal?pixel(edge,n):pixel(n,edge);
          pairs.push({a,c});for(let i=0;i<3;i++)offset[i]!+=a[i]!-c[i]!;
        }
        for(let i=0;i<3;i++)offset[i]!/=pairs.length;
        const good=pairs.filter(({a,c})=>a.every((v,i)=>Math.abs(v-c[i]!-offset[i]!)<=thresholds.boundaryDelta)).length;
        return good/pairs.length>=thresholds.boundaryFraction;
      };
      if(!oppositeProfiles(true)||!oppositeProfiles(false))continue;
      for(const right of [false,true])for(const bottom of [false,true]){
        const cornerX=right?(w-b)*t.tileWidth+1:b*t.tileWidth-2,edgeX=right?(w-b-1)*t.tileWidth+1:(b+1)*t.tileWidth-2;
        const cornerY=bottom?(h-b)*t.tileHeight+1:b*t.tileHeight-2,edgeY=bottom?(h-b-1)*t.tileHeight+1:(b+1)*t.tileHeight-2;
        if(!cornerProfile(true,cornerX,edgeX,bottom)||!cornerProfile(false,cornerY,edgeY,right))valid=false;
      }
      if(!valid)continue;
    }
    // Every tile of every edge depth must differ from the corresponding
    // centre phase, not just the first column/row of an inferred thick band.
    if(b>1){
      for(let x=0;x<cx;x++)for(let d=0;d<b;d++)if(!compare(b+x,d,b+x,b+d%cy,true)||!compare(b+x,h-b+d,b+x,b+d%cy,true))valid=false;
      for(let y=0;y<cy;y++)for(let d=0;d<b;d++)if(!compare(d,b+y,b+d%cx,b+y,true)||!compare(w-b+d,b+y,b+d%cx,b+y,true))valid=false;
    }
    if(!valid)continue;
    const distinct=(ax:number,ay:number,bx:number,by:number)=>{
      // Compare corresponding pixels across the whole patch, not just its first tile.
      let diff=0,count=0;
      for(let y=0;y<b;y++)for(let x=0;x<b;x++)for(let py=0;py<t.tileHeight;py++)for(let px=0;px<t.tileWidth;px++){
        const a=rgba(ax+(ax===b?x%cx:x),ay+(ay===b?y%cy:y),px,py),c=rgba(bx+(bx===b?x%cx:x),by+(by===b?y%cy:y),px,py);
        if(a.some((v,i)=>Math.abs(v-c[i]!)>thresholds.distinctDelta))diff++;count++;
      }
      return diff/count>=thresholds.distinctFraction;
    };
    for(const [x,y] of [[b,0],[0,b],[w-b,b],[b,h-b]])if(!distinct(x!,y!,b,b))valid=false;
    for(const [x,y,nx,ny,wx,wy] of [[0,0,b,0,0,b],[w-b,0,b,0,w-b,b],[0,h-b,b,h-b,0,b],[w-b,h-b,b,h-b,w-b,b]])if(!distinct(x!,y!,nx!,ny!)||!distinct(x!,y!,wx!,wy!))valid=false;
    // Segment wraps must join too, even when the source contains only one segment.
    for(let k=0;k<strips.length&&valid;k++){
      const [x0,y0,width,height,horizontal]=strips[k]!,step=periods[k]!;
      const count=horizontal?height*t.tileHeight:width*t.tileWidth;
      const depth=Math.min(3,(horizontal?t.tileWidth:t.tileHeight)-1);
      let good=0;
      for(let i=0;i<count;i++){
        const edge=(far:boolean,d:number)=>horizontal
          ?rgba(x0+(far?step-1:0),y0+Math.floor(i/t.tileHeight),far?t.tileWidth-1-d:d,i%t.tileHeight)
          :rgba(x0+Math.floor(i/t.tileWidth),y0+(far?step-1:0),i%t.tileWidth,far?t.tileHeight-1-d:d);
        const last=edge(true,0),first=edge(false,0),gradient=[0,0,0,0];
        // Estimate ordinary neighbour differences using up to three inward steps
        // on each side. Compare the wrap jump to that gradient, never to mirrored pixels:
        // asymmetric pebbles/tufts inside a repeating tile need not match each other.
        for(const far of [false,true])for(let d=0;d<depth;d++){
          const a=edge(far,d),c=edge(far,d+1);
          for(let j=0;j<4;j++)gradient[j]!+=Math.abs(a[j]!-c[j]!);
        }
        if(last.every((v,j)=>Math.abs(v-first[j]!)<=Math.max(thresholds.seamDelta,depth?thresholds.seamGradientRatio*gradient[j]!/(2*depth):0)))good++;
      }
      if(good/count<thresholds.seamFraction)valid=false;
    }
    if(valid) return result("repeating-bands",b);
  }
  return null;
}
