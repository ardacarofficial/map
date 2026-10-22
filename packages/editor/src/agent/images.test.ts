import { encode } from "fast-png";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRgbaPng } from "@smap/core";
import { CallSignal, type AgentCallContext, type AgentWorldPort } from "@smap/agent";
import { setTilesetImage, clearTilesetImages, deferredTilesetImage } from "../state/tilesetImages";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import * as sourcePng from "../io/sourcePng";
import { createImagePort, imagePixels } from "./images";
const ts={id:"art",name:"Art",imagePath:"tilesets/art.png",tileWidth:2,tileHeight:2,columns:2,rows:1,margin:1,spacing:1};
const call:AgentCallContext={clientSessionId:"test",clientInfo:{name:"Test",version:"1"},bridgeEpoch:"test",deadline:Date.now()+10000,signal:{aborted:false,throwIfAborted(){},onAbort:()=>()=>{}}};
const world={tilesets:()=>[ts],stamps:()=>[]} as unknown as AgentWorldPort;
function pixels(){const data=new Uint8Array(7*4*4);for(let y=1;y<3;y++)for(let x=1;x<3;x++)data.set([255,0,0,255],(y*7+x)*4);for(let y=1;y<3;y++)for(let x=4;x<6;x++)data.set([0,255,0,255],(y*7+x)*4);return data;}
function image(bytes:Uint8Array){setTilesetImage({tilesetId:"art",bytes,bitmap:{width:7,height:4,close:vi.fn()} as unknown as ImageBitmap});}
afterEach(()=>{clearTilesetImages();vi.restoreAllMocks();});
describe("agent catalog images and fingerprints",()=>{
  it("uses real source rectangles with margin/spacing and reserves numeric-label gutters",async()=>{
    image(encodeRgbaPng(7,4,pixels()));const port=createImagePort(world,()=>1);
    const result=await port.tileCatalog({context:{worldSessionId:"world"},tilesetId:"art",tileIds:[1,0],image:"tiles",scale:2},call);
    const decoded=decodeWorkingSourcePng(result.png);const first=result.image.placements[0]!;
    expect([...decoded.data.slice((first.rect.y*decoded.width+first.rect.x)*4,(first.rect.y*decoded.width+first.rect.x)*4+4)]).toEqual([0,255,0,255]);
    expect(first.labelRect.y).toBeGreaterThanOrEqual(first.rect.y+first.rect.height);expect(first.tileId).toBe(1);
  });
  it("keeps fingerprints through PNG reencoding and changes only the affected tile",async()=>{
    const data=pixels(),port=createImagePort(world,()=>1);image(encodeRgbaPng(7,4,data));
    const before=await Promise.all([0,1].map(id=>port.tileFingerprint("art",id,call.signal)));
    image(encode({width:7,height:4,data,channels:4,depth:8}));
    expect(await port.tileFingerprint("art",0,call.signal)).toBe(before[0]);
    data[(1*7+1)*4]=150;image(encodeRgbaPng(7,4,data));
    expect(await port.tileFingerprint("art",0,call.signal)).not.toBe(before[0]);expect(await port.tileFingerprint("art",1,call.signal)).toBe(before[1]);
  });
});

it("catalog IDs have a readable ten-pixel glyph height outside the sprite", async () => {
  image(encodeRgbaPng(7,4,pixels()));
  const result = await createImagePort(world,()=>1).tileCatalog({context:{worldSessionId:"world"},tilesetId:"art",tileIds:[1],image:"tiles",scale:2},call);
  const png=decodeWorkingSourcePng(result.png),label=result.image.placements[0]!.labelRect;
  const inkRows=new Set<number>();
  for(let y=label.y;y<label.y+label.height;y++)for(let x=label.x;x<label.x+label.width;x++){
    const i=(y*png.width+x)*4;if(png.data[i]===215&&png.data[i+1]===225)inkRows.add(y);
  }
  expect(inkRows.size).toBeGreaterThanOrEqual(10);
});

it("renders a continuous sheet with source margin/spacing and compact coordinate metadata", async () => {
  const original=encodeRgbaPng(7,4,pixels());image(original);const port=createImagePort(world,()=>1);
  const result=await port.tileCatalog({context:{worldSessionId:"world"},tilesetId:"art",image:"sheet",scale:2},call);
  expect(result.image.placements).toEqual([]);
  expect(result.image.sheet).toMatchObject({sourceRect:{x:1,y:1,width:5,height:2},region:{x:0,y:0,width:2,height:1},grid:{margin:1,spacing:1,columns:2}});
  const png=decodeWorkingSourcePng(result.png),rect=result.image.sheet!.contentRect;
  const pixel=(x:number)=>[...png.data.slice(((rect.y)*png.width+rect.x+x)*4,((rect.y)*png.width+rect.x+x)*4+4)];
  expect(pixel(0)).toEqual([255,0,0,255]);expect(pixel(6)).toEqual([0,255,0,255]);
  expect(original).toEqual(encodeRgbaPng(7,4,pixels()));
  const crop=await port.tileCatalog({context:{worldSessionId:"world"},tilesetId:"art",image:"sheet",sheetRegion:{x:1,y:0,width:1,height:1},scale:2},call);
  expect(crop.image.sheet!.sourceRect).toEqual({x:4,y:1,width:2,height:2});
});

it("fits large sheets within image budgets without per-tile placement metadata", async () => {
  const large={...ts,columns:128,rows:128,tileWidth:16,tileHeight:16,margin:0,spacing:0};
  setTilesetImage({tilesetId:"art",bytes:encodeRgbaPng(2048,2048,new Uint8Array(2048*2048*4)),bitmap:{width:2048,height:2048,close:vi.fn()} as unknown as ImageBitmap});
  const port=createImagePort({tilesets:()=>[large],stamps:()=>[]} as unknown as AgentWorldPort,()=>1);
  const result=await port.tileCatalog({context:{worldSessionId:"world"},tilesetId:"art",image:"sheet",scale:4},call);
  expect(result.width).toBeLessThanOrEqual(2048);expect(result.height).toBeLessThanOrEqual(2048);
  expect(result.image.scale).toBeLessThan(1);expect(JSON.stringify(result.image).length).toBeLessThan(1000);
});

it("changes catalog source identities on replacement and leaves stable reads cached", async () => {
  const port=createImagePort(world,()=>1);expect(port.catalogSourceKey!("art")).toBeNull();
  image(encodeRgbaPng(7,4,pixels()));const key=port.catalogSourceKey!("art");expect(port.catalogSourceKey!("art")).toBe(key);
  image(encodeRgbaPng(7,4,pixels()));expect(port.catalogSourceKey!("art")).not.toBe(key);
});

it("shares cached pixel hashes and invalidates source and grid identities",async()=>{
  const core=await import("@smap/core"),hash=vi.spyOn(core,"rasterContentHash");
  const grid={...ts};
  const port=createImagePort({tilesets:()=>[grid],stamps:()=>[]} as unknown as AgentWorldPort,()=>1);
  image(encodeRgbaPng(7,4,pixels()));hash.mockClear();
  const first=await port.tileFingerprint("art",0,call.signal);
  await port.tileFingerprint("art",0,call.signal);
  expect(hash).toHaveBeenCalledTimes(1);
  await Promise.all([0,1,1].map(id=>port.tileFingerprint("art",id,call.signal)));
  const count=hash.mock.calls.length;
  await port.tileFingerprint("art",1,call.signal);expect(hash).toHaveBeenCalledTimes(count);
  grid.spacing=0;
  expect(await port.tileFingerprint("art",0,call.signal)).not.toBe(first);
  expect(hash).toHaveBeenCalledTimes(count+1);
  image(encodeRgbaPng(7,4,pixels()));
  await port.tileFingerprint("art",0,call.signal);expect(hash).toHaveBeenCalledTimes(count+2);
  hash.mockRestore();
});

it("decodes a cold atlas once while fingerprinting an entire stamp palette",async()=>{
  image(encodeRgbaPng(7,4,pixels()));
  const decode=vi.spyOn(sourcePng,"decodeWorkingSourcePng");
  const stamp={id:"stamp",name:"Stamp",width:2,height:1,palette:[{tilesetId:"art",tileId:0},{tilesetId:"art",tileId:1}],layers:[{layerId:"layer",name:"Layer",cells:new Uint32Array([1,2])}]};
  const port=createImagePort({tilesets:()=>[ts],stamps:()=>[stamp]} as unknown as AgentWorldPort,()=>1);
  expect(await port.stampFingerprint("stamp",call.signal)).toMatch(/^[a-f0-9]{64}$/);
  expect(decode).toHaveBeenCalledTimes(1);
  await port.tileFingerprint("art",1,call.signal);
  expect(decode).toHaveBeenCalledTimes(1);
});

it("cancels one pending image waiter promptly while retaining the shared source for other callers",async()=>{
  let finish!:(bytes:Uint8Array)=>void;
  const bytes=new Promise<Uint8Array>(resolve=>{finish=resolve;}),close=vi.fn();
  setTilesetImage(deferredTilesetImage("art",{width:7,height:4,close} as unknown as ImageBitmap,()=>bytes));
  const decode=vi.spyOn(sourcePng,"decodeWorkingSourcePng"),cancelled=new CallSignal();
  const first=imagePixels("art",cancelled),second=imagePixels("art",call.signal);
  const rejection=expect(first).rejects.toMatchObject({code:"CANCELLED"});
  cancelled.abort();await rejection;
  expect(close).not.toHaveBeenCalled();
  finish(encodeRgbaPng(7,4,pixels()));
  expect(await second).toMatchObject({width:7,height:4});
  expect(decode).toHaveBeenCalledTimes(1);
});

it("rejects retired pending sources for every waiter and releases the lease after encoding",async()=>{
  let finish!:(bytes:Uint8Array)=>void;
  const bytes=new Promise<Uint8Array>(resolve=>{finish=resolve;}),close=vi.fn();
  setTilesetImage(deferredTilesetImage("art",{width:7,height:4,close} as unknown as ImageBitmap,()=>bytes));
  const decode=vi.spyOn(sourcePng,"decodeWorkingSourcePng");
  const first=imagePixels("art",call.signal),second=imagePixels("art",call.signal);
  image(encodeRgbaPng(7,4,pixels()));
  expect(close).not.toHaveBeenCalled();
  const results=Promise.allSettled([first,second]);
  finish(encodeRgbaPng(7,4,pixels()));
  for(const result of await results){expect(result.status).toBe("rejected");if(result.status==="rejected")expect(result.reason).toMatchObject({code:"SOURCE_CHANGED"});}
  expect(close).toHaveBeenCalledTimes(1);
  expect(decode).not.toHaveBeenCalled();
  await imagePixels("art",call.signal);
  expect(decode).toHaveBeenCalledTimes(1);
});

it("retries after a shared decode failure",async()=>{
  image(encodeRgbaPng(7,4,pixels()));
  const decode=vi.spyOn(sourcePng,"decodeWorkingSourcePng").mockImplementationOnce(()=>{throw Error("decode failed");});
  const results=await Promise.allSettled([imagePixels("art",call.signal),imagePixels("art",call.signal)]);
  expect(results.map(result=>result.status)).toEqual(["rejected","rejected"]);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(await imagePixels("art",call.signal)).toMatchObject({width:7,height:4});
  expect(decode).toHaveBeenCalledTimes(2);
});

it("counts shared decoded pixels once when retaining multiple atlases",async()=>{
  const bytes=encodeRgbaPng(7,4,pixels());image(bytes);
  const decode=vi.spyOn(sourcePng,"decodeWorkingSourcePng").mockImplementation(()=>({width:3072,height:2048,data:new Uint8Array(24*1024*1024)}));
  await Promise.all([imagePixels("art",call.signal),imagePixels("art",call.signal)]);
  setTilesetImage({tilesetId:"other",bytes,bitmap:{width:7,height:4,close:vi.fn()} as unknown as ImageBitmap});
  await imagePixels("other",call.signal);
  await imagePixels("art",call.signal);
  expect(decode).toHaveBeenCalledTimes(2);
});
