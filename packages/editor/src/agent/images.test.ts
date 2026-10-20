import { encode } from "fast-png";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRgbaPng } from "@smap/core";
import type { AgentCallContext, AgentWorldPort } from "@smap/agent";
import { setTilesetImage, clearTilesetImages } from "../state/tilesetImages";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { createImagePort } from "./images";
const ts={id:"art",name:"Art",imagePath:"tilesets/art.png",tileWidth:2,tileHeight:2,columns:2,rows:1,margin:1,spacing:1};
const call:AgentCallContext={clientSessionId:"test",clientInfo:{name:"Test",version:"1"},bridgeEpoch:"test",deadline:Date.now()+10000,signal:{aborted:false,throwIfAborted(){},onAbort:()=>()=>{}}};
const world={tilesets:()=>[ts],stamps:()=>[]} as unknown as AgentWorldPort;
function pixels(){const data=new Uint8Array(7*4*4);for(let y=1;y<3;y++)for(let x=1;x<3;x++)data.set([255,0,0,255],(y*7+x)*4);for(let y=1;y<3;y++)for(let x=4;x<6;x++)data.set([0,255,0,255],(y*7+x)*4);return data;}
function image(bytes:Uint8Array){setTilesetImage({tilesetId:"art",bytes,bitmap:{width:7,height:4,close:vi.fn()} as unknown as ImageBitmap});}
afterEach(clearTilesetImages);
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
