import { afterEach, expect, it, vi } from "vitest";
import { CallSignal, type AgentCallContext, type AgentWorldPort } from "@smap/agent";
import { FLIP_D, FLIP_H, FLIP_V, MapStore, Palette, encodeRgbaPng, makeCell, type Tileset } from "@smap/core";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { clearTilesetImages, deferredTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { createImagePort } from "./images";

afterEach(() => { clearTilesetImages(); vi.restoreAllMocks(); });

it("previews 4096 distinct edited tiles with one palette allocation and no retained undo history", async () => {
  const count = 4096, side = 64;
  const ts: Tileset = { id:"edited", name:"Edited", imagePath:"tilesets/edited.png", tileWidth:2, tileHeight:2, columns:16, rows:256, margin:0, spacing:0,
    edited:{kind:"pixel",layoutVersion:1,nextTileId:count,contentHash:"0".repeat(64),origins:[]} };
  const source = new Uint8Array(32 * 512 * 4);
  for (let tile = 0; tile < count; tile++) for (let y=0;y<2;y++) for (let x=0;x<2;x++) {
    source.set([tile & 255, tile >> 8, x + y * 2, 255], (((tile >> 4)*2+y)*32+(tile%16)*2+x)*4);
  }
  setTilesetImage({tilesetId:ts.id,bytes:encodeRgbaPng(32,512,source),bitmap:{width:32,height:512,close:vi.fn()} as unknown as ImageBitmap});
  const flags = [0,FLIP_H,FLIP_V,FLIP_D,FLIP_H|FLIP_V,FLIP_H|FLIP_D,FLIP_V|FLIP_D,FLIP_H|FLIP_V|FLIP_D];
  const cells = Uint32Array.from({length:count},(_,i)=>makeCell(i+1,flags[i%8]!));
  const stamp = {id:"stamp",name:"Stamp",width:side,height:side,palette:Array.from({length:count},(_,tileId)=>({tilesetId:ts.id,tileId})),layers:[{layerId:"tiles",name:"Tiles",cells}]};
  const world = {tilesets:()=>[ts],stamps:()=>[stamp]} as unknown as AgentWorldPort;
  const call: AgentCallContext = {clientSessionId:"test",clientInfo:{name:"Test",version:"1"},bridgeEpoch:"test",deadline:Date.now()+10_000,signal:new CallSignal()};
  const original = MapStore.prototype.dispatch;
  let paletteCalls=0, snapshotSlots=0, maxUndoDepth=0, copiedSlots=0;
  const entries=Palette.prototype.entries;
  vi.spyOn(Palette.prototype,"entries").mockImplementation(function(this:Palette){const result=entries.call(this);copiedSlots+=result.length;return result;});
  vi.spyOn(MapStore.prototype,"dispatch").mockImplementation(function(this:MapStore, command:Parameters<typeof original>[0]) {
    const result = original.call(this,command);
    if(command.type==="addPaletteEntry"||command.type==="addPaletteEntries") {
      paletteCalls++;
      for(const change of this.peekUndo()?.changes??[]) if(change.kind==="paletteAppend") snapshotSlots+=change.before.length+change.after.length;
    }
    maxUndoDepth=Math.max(maxUndoDepth,this.undoDepth);
    return result;
  } as typeof original);
  const preview=await createImagePort(world,()=>7).stampPreview(stamp.id,call);
  const decoded=decodeWorkingSourcePng(preview.png);
  expect([decoded.width,decoded.height,preview.revision]).toEqual([128,128,7]);
  // All eight orientations preserve the exact source pixels in every cell.
  for(let tile=0;tile<count;tile++) for(let y=0;y<2;y++) for(let x=0;x<2;x++) {
    let sx=x,sy=y; const flag=flags[tile%8]!;
    if(flag&FLIP_H)sx=1-sx;if(flag&FLIP_V)sy=1-sy;
    if(flag&FLIP_D)[sx,sy]=[sy,sx];
    const offset=(((tile>>6)*2+y)*128+(tile%64)*2+x)*4;
    expect([...decoded.data.subarray(offset,offset+4)]).toEqual([tile&255,tile>>8,sx+sy*2,255]);
  }
  expect({paletteCalls,copiedSlots,snapshotSlots,maxUndoDepth}).toEqual({paletteCalls:1,copiedSlots:4096,snapshotSlots:0,maxUndoDepth:0});
});

it("ignores unused artwork and duplicate references while preserving empty cells and layer order",async()=>{
  const used:Tileset={id:"used",name:"Used",imagePath:"tilesets/used.png",tileWidth:1,tileHeight:1,columns:2,rows:1,margin:0,spacing:0};
  const unused={...used,id:"unused",tileWidth:64,tileHeight:64},missing={...unused,id:"missing"};
  const readUnused=vi.fn(async()=>{throw Error("Unused artwork must not be read");});
  setTilesetImage(deferredTilesetImage(unused.id,{width:64,height:64,close:vi.fn()} as unknown as ImageBitmap,readUnused));
  setTilesetImage({tilesetId:used.id,bytes:encodeRgbaPng(2,1,new Uint8Array([255,0,0,255,0,255,0,255])),bitmap:{width:2,height:1,close:vi.fn()} as unknown as ImageBitmap});
  const stamp={id:"mixed",name:"Mixed",width:3,height:1,palette:[{tilesetId:unused.id,tileId:0},{tilesetId:used.id,tileId:0},{tilesetId:missing.id,tileId:0},{tilesetId:used.id,tileId:1},{tilesetId:used.id,tileId:0}],layers:[
    {layerId:"lower",name:"Lower",cells:new Uint32Array([2,0,4])},
    {layerId:"collision",name:"Collision",grid:true,cells:new Uint32Array([1,1,1])},
    {layerId:"upper",name:"Upper",cells:new Uint32Array([4,0,5])},
  ]};
  const world={tilesets:()=>[unused,missing,used],stamps:()=>[stamp]} as unknown as AgentWorldPort;
  const call:AgentCallContext={clientSessionId:"test",clientInfo:{name:"Test",version:"1"},bridgeEpoch:"test",deadline:Date.now()+10000,signal:new CallSignal()};
  const result=await createImagePort(world,()=>1).stampPreview(stamp.id,call),pixels=decodeWorkingSourcePng(result.png);
  expect([result.width,result.height]).toEqual([3,1]);
  expect([...pixels.data]).toEqual([0,255,0,255,36,36,36,255,255,0,0,255]);
  expect(readUnused).not.toHaveBeenCalled();
});

it("builds large stamp previews using bounded paint batches and skips empty source cells",async()=>{
  const ts:Tileset={id:"art",name:"Art",imagePath:"tilesets/art.png",tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0};
  setTilesetImage({tilesetId:ts.id,bytes:encodeRgbaPng(1,1,new Uint8Array([255,0,0,255])),bitmap:{width:1,height:1,close:vi.fn()} as unknown as ImageBitmap});
  const cells=new Uint32Array(128*128).fill(1);cells[1]=0;
  const stamp={id:"large",name:"Large",width:128,height:128,palette:[{tilesetId:ts.id,tileId:0}],layers:[{layerId:"tiles",name:"Tiles",cells}]};
  const original=MapStore.prototype.dispatch,batches:number[]=[];
  vi.spyOn(MapStore.prototype,"dispatch").mockImplementation(function(this:MapStore,command:Parameters<typeof original>[0]){
    if(command.type==="paintCells")batches.push(command.cells.length);
    return original.call(this,command);
  } as typeof original);
  const call:AgentCallContext={clientSessionId:"test",clientInfo:{name:"Test",version:"1"},bridgeEpoch:"test",deadline:Date.now()+10000,signal:new CallSignal()};
  const result=await createImagePort({tilesets:()=>[ts],stamps:()=>[stamp]} as unknown as AgentWorldPort,()=>1).stampPreview(stamp.id,call);
  expect(batches).toEqual([4096,4096,4096,4095]);
  const png=decodeWorkingSourcePng(result.png);
  expect([...png.data.subarray(0,12)]).toEqual([255,0,0,255,36,36,36,255,255,0,0,255]);
  expect([...png.data.subarray(png.data.length-4)]).toEqual([255,0,0,255]);
});
