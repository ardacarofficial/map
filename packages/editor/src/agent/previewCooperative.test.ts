import { afterEach, expect, it, vi } from "vitest";
import { CallSignal, type AgentCallContext, type AgentWorldPort } from "@smap/agent";
import { createDocument, MapStore } from "@smap/core";
import { createImagePort } from "./images";
import { renderPreviewPixels, renderPreviewPixelsAsync } from "./preview";

const ts={id:"art",name:"Art",imagePath:"tilesets/art.png",tileWidth:2,tileHeight:2,columns:1,rows:1,margin:0,spacing:0};
const art={width:2,height:2,data:new Uint8Array([255,0,0,255,0,255,0,128,0,0,255,255,255,255,255,64])};
const region={x:0,y:0,width:128,height:128};
function dense(){
  const store=new MapStore(createDocument({...region,tileWidth:2,tileHeight:2,tilesets:[ts]}),{historyLimit:0});
  const layerId=store.dispatch({type:"addLayer",layer:{name:"Ground",opacity:.6}}),cell=store.getOrAddPaletteIndex(ts.id,0);
  store.dispatch({type:"paintCells",layerId,cells:Array.from({length:128*128},(_,i)=>({x:i%128,y:i>>7,cell}))});
  return store;
}
function context(signal=new CallSignal(),deadline=Date.now()+10000): AgentCallContext {
  return {clientSessionId:"test",clientInfo:{name:"Test",version:"1"},bridgeEpoch:"test",deadline,signal};
}
afterEach(()=>vi.restoreAllMocks());

it("lets a real Stop timer interrupt dense source discovery before the whole map is scanned",async()=>{
  const store=dense(),signal=new CallSignal(),base=Date.now();let inspected=0;
  const original=store.document.getTileset.bind(store.document);
  vi.spyOn(store.document,"getTileset").mockImplementation(id=>{inspected++;return original(id);});
  vi.spyOn(Date,"now").mockImplementation(()=>base+(inspected>=128?9:0));
  const port=createImagePort({loadMap:async()=>store,tilesets:()=>[ts]} as unknown as AgentWorldPort,()=>1);
  const timer=setTimeout(()=>signal.abort(),0);
  try{await expect(port.renderPreview({context:{worldSessionId:"world"},mapId:"map",maxSide:64},context(signal,base+10000))).rejects.toMatchObject({code:"CANCELLED"});}
  finally{clearTimeout(timer);}
  expect(inspected).toBe(128);
});

it("yields during dense raster replay and checks deadlines without waiting for timer delivery",async()=>{
  const doc=dense().document,signal=new CallSignal(),base=Date.now();let draws=0;
  const source=()=>{draws++;return art;};
  vi.spyOn(Date,"now").mockImplementation(()=>base+(draws>=128?9:0));
  const timer=setTimeout(()=>signal.abort(),0);
  try{await expect(renderPreviewPixelsAsync(doc,region,{maxSide:64},source,context(signal,base+10000))).rejects.toMatchObject({code:"CANCELLED"});}
  finally{clearTimeout(timer);}
  expect(draws).toBe(128);
  draws=0;
  await expect(renderPreviewPixelsAsync(doc,region,{maxSide:64},source,context(new CallSignal(),base+9))).rejects.toMatchObject({code:"TIMEOUT"});
  expect(draws).toBe(128);
});

it("reports scan progress even when every stored cell has an unavailable palette reference",async()=>{
  const store=dense(),signal=new CallSignal(),base=Date.now();let inspected=0;
  vi.spyOn(store.document.palette,"get").mockImplementation(()=>{inspected++;return undefined;});
  vi.spyOn(Date,"now").mockImplementation(()=>base+(inspected>=1024?9:0));
  const timer=setTimeout(()=>signal.abort(),0);
  try{await expect(renderPreviewPixelsAsync(store.document,region,{maxSide:64},()=>art,context(signal,base+10000))).rejects.toMatchObject({code:"CANCELLED"});}
  finally{clearTimeout(timer);}
  expect(inspected).toBe(1024);
});

it("keeps every output pixel and preview metadata equal to synchronous replay",async()=>{
  const store=dense(),id=store.dispatch({type:"addLayer",layer:{name:"Collision",type:"grid",role:"collision"}});
  store.dispatch({type:"paintGrid",layerId:id,cells:[{x:31,y:31,value:1},{x:32,y:31,value:2}]});
  const options={maxSide:64,grid:true,coordinates:true,layerIds:store.document.layers.map(l=>l.id)};
  const sync=renderPreviewPixels(store.document,region,options,()=>art);
  expect(await renderPreviewPixelsAsync(store.document,region,options,()=>art,context())).toEqual(sync);
});
