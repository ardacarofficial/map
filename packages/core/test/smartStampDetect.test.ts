import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { detectNineSliceSelection, type NineSliceSelectionInput } from "../src/smartStamp/detect";
function input(w=3,h=3,col=2,row=1): NineSliceSelectionInput {
  const tileset={id:"road",columns:12,rows:10,tileWidth:16,tileHeight:16,margin:1,spacing:2};
  return {tileset,rect:{col,row,width:w,height:h},ids:Array.from({length:w*h},(_,i)=>(row+Math.floor(i/w))*12+col+i%w),emptyIds:new Set()};
}
/** Continuous bordered artwork with distinct corners/edges and repeating tile-local texture. */
function art(w=6,h=6): NineSliceSelectionInput {
  const s=input(w,h), width=1+12*18, height=1+10*18,data=new Uint8Array(width*height*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) for(let py=0;py<16;py++) for(let px=0;px<16;px++) {
    const edge=Math.min(x===0?px:99,x===w-1?15-px:99,y===0?py:99,y===h-1?15-py:99);
    const v=edge<3?40:edge<5?90:160+(px+py)%3;
    const i=((1+(1+y)*18+py)*width+1+(2+x)*18+px)*4;
    data.set([v,v+10,v+20,255],i);
  }
  return {...s,pixels:{width,height,data}};
}
describe("detectNineSliceSelection",()=>{
 it("requires pixels for a full offset 3×3 and verifies bordered artwork",()=>{
   expect(detectNineSliceSelection(input())).toBeNull();
   expect(detectNineSliceSelection(art(3,3))).toMatchObject({version:6,border:1,xBands:[1,1,1],reason:"repeating-bands",sourceIds:input().ids});
 });
 it("rejects holes, duplicate/permuted/invalid ids and empty tiles before bounding-box reduction",()=>{
   const s=input();
   for(const ids of [s.ids.slice(1),[...s.ids].reverse(),s.ids.map((v,i)=>i===1?s.ids[0]!:v),s.ids.map((v,i)=>i===1?999:v)]) expect(detectNineSliceSelection({...s,ids})).toBeNull();
   expect(detectNineSliceSelection({...s,emptyIds:new Set([s.ids[0]!])})).toBeNull();
   expect(detectNineSliceSelection(input(2,2))).toBeNull();
   expect(detectNineSliceSelection(input(1,5))).toBeNull();
 });
 it.each([[3,5],[5,3],[6,6]])("accepts b=1 repeating %i×%i artwork with spacing and offsets",(w,h)=>{
   expect(detectNineSliceSelection(art(w,h))).toMatchObject({border:1,reason:"repeating-bands",xBands:[1,w-2,1],yBands:[1,h-2,1]});
   expect(detectNineSliceSelection(input(w,h))).toBeNull();
 });
 it("rejects negative corpus: uniform sheet, object atlas, decorated centre, transparent cell, b=2 corners",()=>{
   for(const kind of ["uniform","objects","decoration","transparent","b2"]) {
     const s=art(),p=s.pixels!,d=p.data.slice(),t=s.tileset;
     if(kind==="uniform") for(let i=0;i<d.length;i+=4) d.set([90,90,90,255],i);
     else for(let y=0;y<6;y++) for(let x=0;x<6;x++) for(let py=0;py<16;py++) for(let px=0;px<16;px++) {
       const i=((t.margin+(1+y)*18+py)*p.width+t.margin+(2+x)*18+px)*4;
       if(kind==="objects") d.set([(x*71+y*37+px*17)%256,py*13,x*41,255],i);
       if(kind==="decoration"&&x===3&&y===3) d.set([255,0,0,255],i);
       if(kind==="transparent"&&x===2&&y===2) d[i+3]=0;
       if(kind==="b2"&&x===1&&y===1) d.set([0,0,0,255],i);
     }
     expect(detectNineSliceSelection({...s,pixels:{...p,data:d}}),kind).toBeNull();
   }
 });
 it("rejects a boundaryless opaque black 3×3",()=>{
   const s=art(3,3),p=s.pixels!,d=p.data.slice();
   for(let i=0;i<d.length;i+=4){ d[i]=0;d[i+1]=0;d[i+2]=0; }
   expect(detectNineSliceSelection({...s,pixels:{...p,data:d}})).toBeNull();
 });
 it("is deterministic, immutable and independent of sheet stride/offset",()=>{
   fc.assert(fc.property(fc.integer({min:3,max:80}),fc.integer({min:0,max:20}),fc.integer({min:0,max:20}),(columns,col,row)=>{
     const s=input();const c=col%(columns-2);const v={...s,tileset:{...s.tileset,columns,rows:row+3},rect:{col:c,row,width:3,height:3},ids:Array.from({length:9},(_,i)=>(row+Math.floor(i/3))*columns+c+i%3)};
     const before=JSON.stringify(v);expect(detectNineSliceSelection(v)).toEqual(detectNineSliceSelection(v));expect(detectNineSliceSelection(v)).toBeNull();expect(JSON.stringify(v)).toBe(before);
   }));
 });
});

it("versioned repetition thresholds reject changes above either tolerance",()=>{
 const s=art(),p=s.pixels!,d=p.data.slice();
 // One repeated centre has a three-channel shift > mean tolerance, despite all deltas <= 8.
 for(let py=0;py<16;py++)for(let px=0;px<16;px++){
  const i=((1+(1+3)*18+py)*p.width+1+(2+3)*18+px)*4;
  d[i]=d[i]!+4;d[i+1]=d[i+1]!+4;d[i+2]=d[i+2]!+4;
 }
 expect(detectNineSliceSelection({...s,pixels:{...p,data:d}})).toBeNull();
});

it("reads cropped RGBA with an explicit origin identically to a full sheet",()=>{
 const s=art(),p=s.pixels!,originX=1+2*18,originY=1+18,width=6*18-2,height=6*18-2,data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)data.set(p.data.subarray(((originY+y)*p.width+originX)*4,((originY+y)*p.width+originX+width)*4),y*width*4);
 expect(detectNineSliceSelection({...s,pixels:{originX,originY,width,height,data}})).toEqual(detectNineSliceSelection(s));
});

it("verified 3×3 evidence is invariant under arbitrary sheet offsets and gutters",()=>{
 fc.assert(fc.property(fc.integer({min:0,max:7}),fc.integer({min:0,max:7}),fc.integer({min:0,max:3}),fc.integer({min:0,max:3}),(col,row,margin,spacing)=>{
  const original=art(3,3),p=original.pixels!,stride=16+spacing,columns=col+4,rows=row+4,width=margin*2+columns*stride,height=margin*2+rows*stride,data=new Uint8Array(width*height*4);
  for(let y=0;y<3;y++)for(let x=0;x<3;x++)for(let py=0;py<16;py++)for(let px=0;px<16;px++){
   const a=((1+(1+y)*18+py)*p.width+1+(2+x)*18+px)*4,b=((margin+(row+y)*stride+py)*width+margin+(col+x)*stride+px)*4;
   data.set(p.data.subarray(a,a+4),b);
  }
  const source={tileset:{...original.tileset,columns,rows,margin,spacing},rect:{col,row,width:3,height:3},ids:Array.from({length:9},(_,i)=>(row+Math.floor(i/3))*columns+col+i%3),emptyIds:new Set<number>(),pixels:{width,height,data}};
  const before=data.slice();expect(detectNineSliceSelection(source)?.border).toBe(1);expect(data.every((v,i)=>v===before[i])).toBe(true);expect(detectNineSliceSelection(source)).toEqual(detectNineSliceSelection(source));
 }),{numRuns:40});
});

it("verifies transparent road borders while ignoring RGB hidden under zero alpha",()=>{
 const s=art(3,3),p=s.pixels!,a=p.data.slice(),b=p.data.slice();
 for(let y=0;y<48;y++)for(let x=0;x<48;x++)if(Math.min(x,y,47-x,47-y)<2){
  const i=((1+(1+Math.floor(y/16))*18+y%16)*p.width+1+(2+Math.floor(x/16))*18+x%16)*4;
  a.set([0,0,0,0],i);b.set([x*3%256,y*5%256,255,0],i);
 }
 const expected=detectNineSliceSelection({...s,pixels:{...p,data:a}});expect(expected?.border).toBe(1);expect(detectNineSliceSelection({...s,pixels:{...p,data:b}})).toEqual(expected);
});

it("accepts arbitrary asymmetric details beside a continuous wrap without mutating pixels",()=>{
 fc.assert(fc.property(fc.integer({min:1,max:12}),fc.boolean(),fc.integer({min:35,max:80}),(start,far,contrast)=>{
  const s=art(3,3),p=s.pixels!,data=p.data.slice(),px=far?14:1;
  for(let py=start;py<Math.min(15,start+3);py++){
   const i=((1+2*18+py)*p.width+1+3*18+px)*4;
   data.set([160-contrast,170-contrast,180-contrast,255],i);
  }
  const before=data.slice(),input={...s,pixels:{...p,data}};
  expect(detectNineSliceSelection(input)?.border).toBe(1);
  expect(detectNineSliceSelection(input)).toEqual(detectNineSliceSelection(input));expect(data.every((v,i)=>v===before[i])).toBe(true);
 }),{numRuns:40});
});
