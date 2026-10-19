import { describe, expect, it } from "vitest";
import { FLIP_D, FLIP_H, FLIP_V, makeCell, nineSliceLayout, orientPoint, type Stamp, type Tileset } from "@smap/core";
import { rasterizeSmartStamp, type PixelImage } from "./smartStampBake";

const stamp = (flags = 0): Stamp => ({ id: "road", name: "Road", width: 3, height: 3, palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: "source", tileId })), layers: [{ layerId: "ground", name: "Ground", cells: Uint32Array.from({ length: 9 }, (_, i) => makeCell(i + 1, flags)) }] });
const sheet = (size: number): Tileset => ({ id: "source", name: "Source", imagePath: "tilesets/source.png", columns: 3, rows: 3, margin: 0, spacing: 0, tileWidth: size, tileHeight: size });
const source = (size: number): PixelImage => {
  const width = size * 3, data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) data.set([x, y, (x * 9 + y) % 255, (x + y) % 3 ? 127 : 0], (y * width + x) * 4);
  return { width, height: width, data };
};
const pixel = (p: PixelImage, x: number, y: number) => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];
describe("smart stamp bake", () => {
  it.each([0, FLIP_H, FLIP_V, FLIP_D, (FLIP_H | FLIP_V | FLIP_D) >>> 0])("a cropped, offset source gives identical assembly pixels with flags %s", flags => {
    const ts = { ...sheet(3), columns: 8, rows: 8, margin: 0, spacing: 0 }, width = 24;
    const data = Uint8ClampedArray.from({ length: width * width * 4 }, (_, i) => (i * 37) % 256);
    const original = { width, height: width, data }, cropped = new Uint8ClampedArray(9 * 9 * 4);
    for (let y = 0; y < 9; y++) cropped.set(data.subarray(((y + 9) * width + 6) * 4, ((y + 9) * width + 15) * 4), y * 9 * 4);
    const s = { ...stamp(flags), palette: stamp().palette.map((e, i) => ({ ...e, tileId: 2 + i % 3 + (3 + Math.floor(i / 3)) * 8 })) };
    const target = { ...ts, id: "generated", columns: 8, rows: 8 };
    const full = rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels: original }]]));
    expect(rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels: { width: 9, height: 9, data: cropped, originX: 6, originY: 9 } }]]))).toEqual(full);
  });
  it.each([0, FLIP_H, FLIP_V, FLIP_H | FLIP_V, FLIP_D, (FLIP_D | FLIP_H) >>> 0, (FLIP_D | FLIP_V) >>> 0, (FLIP_H | FLIP_V | FLIP_D) >>> 0])("word copies match the legacy byte path in every slot with flags %s", flags => {
    for (const size of [1, 3, 4, 5]) {
      const ts = sheet(size), pixels = source(size), s = stamp(flags), target = { ...ts, columns: 8, rows: 8 };
      const unaligned = new Uint8Array(new ArrayBuffer(pixels.data.length + 1), 1); unaligned.set(pixels.data);
      const legacy = rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels: { ...pixels, data: unaligned } }]]));
      expect(rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels }]]))).toEqual(legacy);
    }
  });
  for (const size of [1, 3, 4, 5]) for (const flags of [0, FLIP_H, FLIP_V, FLIP_D, (FLIP_H | FLIP_V | FLIP_D) >>> 0]) {
    it(`copies all source slots exactly with alpha, size ${size}, flags ${flags}`, () => {
      const ts = sheet(size), pixels = source(size), s = stamp(flags), target = { ...ts, id: "generated", columns: 8, rows: 8 };
      const before = new Uint8ClampedArray(pixels.data);
      const p = rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels }]]));
      for (let id = 0; id < 9; id++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const q = orientPoint({ x, y }, size, size, flags);
        expect(pixel(p, (id % 8) * size + q.x, Math.floor(id / 8) * size + q.y)).toEqual(pixel(pixels, (id % 3) * size + x, Math.floor(id / 3) * size + y));
      }
      expect(pixels.data).toEqual(before);
      expect(rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels }]]))).toEqual(p);
    });
  }
  it("splices compact caps at floor(size/2), with stable row-major slots and transparent trailing capacity", () => {
    const size = 5, ts = sheet(size), pixels = source(size), s = stamp(), target = { ...ts, columns: 8, rows: 8 };
    const p = rasterizeSmartStamp(s, "ground", target, new Map([[ts.id, { tileset: ts, pixels }]])), layout = nineSliceLayout(s);
    const at = (slot: number, x: number, y: number) => pixel(p, (slot % 8) * size + x, Math.floor(slot / 8) * size + y);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      expect(at(layout.collapsedWidth, x, y)).toEqual(pixel(pixels, x < 2 ? x : 2 * size + x, y));
      expect(at(layout.isolated, x, y)).toEqual(pixel(pixels, x < 2 ? x : 2 * size + x, y < 2 ? y : 2 * size + y));
    }
    for (let slot = layout.slots; slot < 64; slot++) expect(at(slot, 0, 0)).toEqual([0, 0, 0, 0]);
  });
  it("fails before publishing anything when a source is missing or its grid no longer fits", () => {
    const ts = sheet(4), s = stamp();
    expect(() => rasterizeSmartStamp(s, "ground", { ...ts, columns: 8, rows: 8 }, new Map())).toThrow("Missing source");
    expect(() => rasterizeSmartStamp(s, "ground", { ...ts, columns: 8, rows: 8 }, new Map([[ts.id, { tileset: ts, pixels: source(3) }]]))).toThrow("does not fit");
  });
});

import { sampleNineSlice, inverseOrientation } from "@smap/core";
import fc from "fast-check";
/** Independent pixel oracle: splice outer bands at the midpoint, otherwise tile the centre span. */
function verifyBandedPixels(b:number,size:number,w:number,h:number,sourceFlags:number,orientation:number,n=3*b,m=4*b) {
 const ts={...sheet(size),columns:n,rows:m};
 const s:Stamp={...stamp(sourceFlags),width:n,height:m,palette:Array.from({length:n*m},(_,tileId)=>({tilesetId:"source",tileId})),layers:[{layerId:"ground",name:"Ground",cells:Uint32Array.from({length:n*m},(_,i)=>makeCell(i+1,sourceFlags))}],nineSlice:{border:b,tileLayers:[]}};
 const data=Uint8ClampedArray.from({length:n*m*size*size*4},(_,i)=>Math.floor(i/4)%251),pixels={width:n*size,height:m*size,data};
 const l=nineSliceLayout(s),target={...ts,id:"baked",columns:16,rows:Math.ceil(l.slots/16)};
 const baked=rasterizeSmartStamp(s,"ground",target,new Map([[ts.id,{tileset:ts,pixels}]]));
 const W=orientation&FLIP_D?h:w,H=orientation&FLIP_D?w:h;
 const coord=(p:number,length:number,full:number)=>length<2*b*size?(p<Math.ceil(length/2)?p:full-length+p):p<b*size?p:p>=length-b*size?full-length+p:b*size+(p-b*size)%(full-2*b*size);
 let mismatch="";
 for(let y=0;y<h*size&&!mismatch;y++)for(let x=0;x<w*size;x++){
  const sample=sampleNineSlice({x:-2,y:-3,width:w,height:h},{x:-2+Math.floor(x/size),y:-3+Math.floor(y/size)},s,orientation)!;
  const local=orientPoint({x:x%size,y:y%size},size,size,inverseOrientation(orientation));
  const actual=pixel(baked,(sample.slot%16)*size+local.x,Math.floor(sample.slot/16)*size+local.y);
  const canonical=orientPoint({x,y},w*size,h*size,inverseOrientation(orientation));
  const sx=coord(canonical.x,W*size,n*size),sy=coord(canonical.y,H*size,m*size);
  const raw=orientPoint({x:sx%size,y:sy%size},size,size,inverseOrientation(sourceFlags));
  const expected=pixel(pixels,Math.floor(sx/size)*size+raw.x,Math.floor(sy/size)*size+raw.y);
  if(actual.some((v,i)=>v!==expected[i])){mismatch=`b=${b} size=${size} target=${w}x${h} sourceFlags=${sourceFlags} orientation=${orientation} pixel=${x},${y}`;break;}
 }
 expect(mismatch).toBe("");
}
it("layout-2 area pixels preserve corners and symmetric caps in every size class and D4 orientation",()=>{
 for(const b of [2,3])for(const w of [1,b,2*b-1,2*b,2*b+1,11])for(const h of [1,b,2*b-1,2*b,2*b+1,10])for(const orientation of [0,FLIP_H,FLIP_V,FLIP_D,(FLIP_H|FLIP_D)>>>0])verifyBandedPixels(b,3,w,h,FLIP_V,orientation);
}, 60_000);
it("banded area pixel oracle holds for random source flips, rectangle shapes and pixel sizes",()=>{
 fc.assert(fc.property(fc.integer({min:2,max:4}),fc.constantFrom(3,16,32),fc.integer({min:1,max:12}),fc.integer({min:1,max:12}),fc.constantFrom(0,FLIP_H,FLIP_V,FLIP_D,(FLIP_H|FLIP_D)>>>0),fc.constantFrom(0,FLIP_H,FLIP_V,FLIP_D),(b,size,w,h,flags,orientation)=>verifyBandedPixels(b,size,w,h,flags,orientation)),{numRuns:30});
},60_000);

import { BLOB47_MASKS } from "@smap/core";
it("every thick road mask copies its macro quadrants losslessly, including odd b and pixel sizes",()=>{
 for(const b of [2,3])for(const size of [3,16])for(const flags of [0,FLIP_H,FLIP_V,FLIP_D]){
  const n=3*b,ts={...sheet(size),columns:n,rows:n},s:Stamp={...stamp(flags),width:n,height:n,palette:Array.from({length:n*n},(_,tileId)=>({tilesetId:"source",tileId})),layers:[{layerId:"ground",name:"Ground",cells:Uint32Array.from({length:n*n},(_,i)=>makeCell(i+1,flags))}],nineSlice:{border:b,tileLayers:[]}};
  const pixels={width:n*size,height:n*size,data:Uint8Array.from({length:n*n*size*size*4},(_,i)=>(i*73+Math.floor(i/31))%256)};
  const layout=nineSliceLayout(s),target={...ts,columns:16,rows:Math.ceil(layout.slots/16)},atlas=rasterizeSmartStamp(s,"ground",target,new Map([[ts.id,{tileset:ts,pixels}]]));
  let mismatch="";
  for(let rank=0;rank<47&&!mismatch;rank++)for(let y=0;y<b*size&&!mismatch;y++)for(let x=0;x<b*size;x++){
   const right=x>=Math.floor(b*size/2),bottom=y>=Math.floor(b*size/2),mask=BLOB47_MASKS[rank]!;
   const vertical=!!(mask&(bottom?16:1)),horizontal=!!(mask&(right?4:64));
   const rx=horizontal?1:right?2:0,ry=vertical?1:bottom?2:0;
   const sx=rx*b*size+x,sy=ry*b*size+y,raw=orientPoint({x:sx%size,y:sy%size},size,size,inverseOrientation(flags));
   const expected=pixel(pixels,Math.floor(sx/size)*size+raw.x,Math.floor(sy/size)*size+raw.y);
   const slot=layout.bank+rank*b*b+Math.floor(y/size)*b+Math.floor(x/size),actual=pixel(atlas,(slot%16)*size+x%size,Math.floor(slot/16)*size+y%size);
   if(actual.some((v,i)=>v!==expected[i])){mismatch=`b=${b}, size=${size}, flags=${flags}, mask=${mask}, pixel=${x},${y}`;break;}
  }
  expect(mismatch).toBe("");
 }
}, 60_000);

it("non-multiple sources tile their centre without spilling into opposite bands, in area and every road mask",()=>{
 for(const [b,n,m] of [[2,7,6],[2,6,7],[2,5,5],[3,7,8]] as const){
  for(const orientation of [0,FLIP_H,FLIP_V,FLIP_D])for(const size of [3,16])for(const w of [1,b,2*b-1,2*b,2*b+1,11])verifyBandedPixels(b,size,w,7,FLIP_H,orientation,n,m);
  for(const flags of [0,FLIP_H,FLIP_V,FLIP_D]){
   const size=3,ts={...sheet(size),columns:n,rows:m},s:Stamp={...stamp(),width:n,height:m,palette:Array.from({length:n*m},(_,tileId)=>({tilesetId:"source",tileId})),layers:[{layerId:"ground",name:"Ground",cells:Uint32Array.from({length:n*m},(_,i)=>makeCell(i+1,flags))}],nineSlice:{border:b,tileLayers:[]}};
   const pixels={width:n*size,height:m*size,data:Uint8Array.from({length:n*m*size*size*4},(_,i)=>(i*73+Math.floor(i/31))%256)};
   const layout=nineSliceLayout(s),target={...ts,columns:16,rows:Math.ceil(layout.slots/16)},atlas=rasterizeSmartStamp(s,"ground",target,new Map([[ts.id,{tileset:ts,pixels}]]));
   const coord=(role:number,p:number,full:number)=>role===0?p:role===2?(full-b)*size+p:b*size+p%((full-2*b)*size);
   for(let rank=0;rank<47;rank++)for(let y=0;y<b*size;y++)for(let x=0;x<b*size;x++){
    const right=x>=Math.floor(b*size/2),bottom=y>=Math.floor(b*size/2),mask=BLOB47_MASKS[rank]!;
    const rx=mask&(right?4:64)?1:right?2:0,ry=mask&(bottom?16:1)?1:bottom?2:0;
    const sx=coord(rx,x,n),sy=coord(ry,y,m),raw=orientPoint({x:sx%size,y:sy%size},size,size,inverseOrientation(flags));
    const expected=pixel(pixels,Math.floor(sx/size)*size+raw.x,Math.floor(sy/size)*size+raw.y),slot=layout.bank+rank*b*b+Math.floor(y/size)*b+Math.floor(x/size);
    expect(pixel(atlas,(slot%16)*size+x%size,Math.floor(slot/16)*size+y%size)).toEqual(expected);
   }
  }
 }
},60_000);
