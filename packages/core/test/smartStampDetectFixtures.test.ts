/** Actual committed PNG corpus, decoded only by the existing test-only PNG helper. */
// eslint-disable-next-line no-restricted-imports -- test-only fixture oracle
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { detectNineSliceSelection } from "../src/smartStamp/detect";
import { decodePng } from "./png";
let fixtureRoot=decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/\/[^/]*$/, "");
if (/^\/[A-Za-z]:/.test(fixtureRoot)) fixtureRoot=fixtureRoot.slice(1);
fixtureRoot+="/../../../e2e/fixtures/";
const png=(name:string)=>decodePng(readFileSync(fixtureRoot+name+".png"));
for(const[size,suffix,n,qualifies]of [[16,"",3,true],[32,"",3,true],[32,"-wide",6,true],[32,"-empty",3,false],[32,"-banded",6,true]]as const){
 it(`classifies actual offset PNG art ${size}${suffix}`,()=>{
  const pixels=png(`smart-road-${size}${suffix}`),tileset={id:"road",columns:12,rows:8,tileWidth:size,tileHeight:size,margin:0,spacing:0};
  const result=detectNineSliceSelection({tileset,rect:{col:2,row:1,width:n,height:n},ids:Array.from({length:n*n},(_,i)=>(1+Math.floor(i/n))*12+2+i%n),emptyIds:new Set(),pixels});
  expect(result!==null).toBe(qualifies);
 });
}
it("b=1 repetition and continuity evidence are equivalent under every D4 orientation",()=>{
 const source=png("smart-road-32-wide"),size=192;
 for(let flags=0;flags<8;flags++){
  const data=source.data.slice();
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   let dx=x,dy=y;if(flags&1)[dx,dy]=[dy,dx];if(flags&2)dx=size-1-dx;if(flags&4)dy=size-1-dy;
   const a=((32+y)*source.width+64+x)*4,b=((32+dy)*source.width+64+dx)*4;data.set(source.data.subarray(a,a+4),b);
  }
  expect(detectNineSliceSelection({tileset:{id:"road",columns:12,rows:8,tileWidth:32,tileHeight:32,margin:0,spacing:0},rect:{col:2,row:1,width:6,height:6},ids:Array.from({length:36},(_,i)=>(1+Math.floor(i/6))*12+2+i%6),emptyIds:new Set(),pixels:{...source,data}})?.border).toBe(1);
 }
});
for(const [size,suffix,w,h]of [[16,"-thick",6,6],[32,"-thick",6,6],[32,"-thick-wide",8,6],[32,"-thick-odd",7,6]]as const)it(`detects real thick artwork ${size}${suffix} under all D4 transforms`,()=>{
 const source=png(`smart-road-${size}${suffix}`),W=w*size,H=h*size;
 for(let flags=0;flags<8;flags++){
  const dw=flags&1?H:W,dh=flags&1?W:H,width=dw+4*size,height=dh+2*size,data=new Uint8Array(width*height*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   let dx=x,dy=y;if(flags&1)[dx,dy]=[dy,dx];if(flags&2)dx=dw-1-dx;if(flags&4)dy=dh-1-dy;
   const a=((size+y)*source.width+2*size+x)*4,b=((size+dy)*width+2*size+dx)*4;data.set(source.data.subarray(a,a+4),b);
  }
  const n=dw/size,m=dh/size,columns=width/size;
  expect(detectNineSliceSelection({tileset:{id:"road",columns,rows:height/size,tileWidth:size,tileHeight:size,margin:0,spacing:0},rect:{col:2,row:1,width:n,height:m},ids:Array.from({length:n*m},(_,i)=>(1+Math.floor(i/n))*columns+2+i%n),emptyIds:new Set(),pixels:{width,height,data}})?.border).toBe(2);
 }
});

for(const name of ["texture","brick","warehouse"])it(`keeps the opaque ${name} sheet plain`,()=>{
 const pixels=png(`smart-object-16-${name}`);
 expect(detectNineSliceSelection({tileset:{id:"object",columns:12,rows:8,tileWidth:16,tileHeight:16,margin:0,spacing:0},rect:{col:2,row:1,width:6,height:6},ids:Array.from({length:36},(_,i)=>(1+Math.floor(i/6))*12+2+i%6),emptyIds:new Set(),pixels})).toBeNull();
});

for(const size of [16,32])for(const material of ["stone","plank","grass"])it(`keeps the nonperiodic ${size}px ${material} sheet plain`,()=>{
 const pixels=png(`smart-road-${size}-material-${material}`);
 expect(detectNineSliceSelection({tileset:{id:"material",columns:12,rows:8,tileWidth:size,tileHeight:size,margin:0,spacing:0},rect:{col:2,row:1,width:6,height:6},ids:Array.from({length:36},(_,i)=>(1+Math.floor(i/6))*12+2+i%6),emptyIds:new Set(),pixels})).toBeNull();
});
