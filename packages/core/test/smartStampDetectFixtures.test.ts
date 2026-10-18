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
for(const[size,suffix,n,qualifies]of [[16,"",3,true],[32,"",3,true],[32,"-wide",6,true],[32,"-empty",3,false],[32,"-banded",6,false]]as const){
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
