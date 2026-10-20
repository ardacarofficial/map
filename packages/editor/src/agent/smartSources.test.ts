import type * as BakeModule from "../ui/stamps/smartStampBake";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCell, serializeLevel, type Stamp, type Tileset } from "@smap/core";
import type { AgentCallContext, PrepareSmartSourceArgs } from "@smap/agent";
import { browserPlatform, setPlatform } from "../platform";
import { closeProject, getLevelWorkspace, newProject } from "../io/session";
import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { bakeSmartStamp } from "../ui/stamps/smartStampBake";
import { createEditorHost } from "./editorHost";
vi.mock("../ui/stamps/smartStampBake",async original=>({...await original<typeof BakeModule>(),bakeSmartStamp:vi.fn(async(_stamp:Stamp,_layer:string,target:Tileset)=>({tilesetId:target.id,bytes:new Uint8Array([1,2,3]),bitmap:{width:target.columns*target.tileWidth,height:target.rows*target.tileHeight,close:vi.fn()} as unknown as ImageBitmap}))}));
const call:AgentCallContext={clientSessionId:"client",clientInfo:{name:"Test",version:"1"},bridgeEpoch:"epoch",deadline:Date.now()+30000,signal:{aborted:false,throwIfAborted(){},onAbort:()=>()=>{}}};
afterEach(()=>{closeProject();setPlatform(browserPlatform);vi.mocked(bakeSmartStamp).mockClear();});
async function setup(){
  setPlatform({...browserPlatform,watchProject(){}});await newProject({name:"Smart",width:8,height:8,tileSize:5});const ws=getLevelWorkspace()!,store=ws.active.store;
  const ts:Tileset={id:"source",name:"Source",imagePath:"tilesets/source.png",tileWidth:5,tileHeight:5,columns:3,rows:3,margin:0,spacing:0};
  store.dispatch({type:"addTileset",tileset:ts});setTilesetImage({tilesetId:ts.id,bytes:new Uint8Array([1,2,3]),bitmap:{width:15,height:15,close:vi.fn()} as unknown as ImageBitmap});
  const stamp:Stamp={id:"road",name:"Road",width:3,height:3,palette:Array.from({length:9},(_,tileId)=>({tilesetId:ts.id,tileId})),layers:[{layerId:"source-layer",name:"Ground",cells:Uint32Array.from({length:9},(_,i)=>makeCell(i+1))}]};
  useProjectLibrary.getState().addStamp(stamp);return{ws,store,stamp,host:createEditorHost()};
}
describe("transaction-owned smart sources",()=>{
  it("prepares for an explicit inactive store without changing the user's brush or selection",async()=>{
    const {ws,store,host}=await setup();const other=ws.add({name:"Other",width:8,height:8,tileSize:5,layerName:"Ground"}),target=ws.entry(other.id)!.store;
    const before=serializeLevel(store.document),editor=useEditorStore.getState(),sourceImage=getTilesetImage("source");
    const baseline=host.transactions.captureBaseline([other.id]);
    const args={context:{transactionId:"transaction"},mapId:other.id,source:{stampId:"road"},force:true} as PrepareSmartSourceArgs;
    const prepared=await host.smartSources.prepare(args,call);
    expect(useEditorStore.getState().project!.store).toBe(store);expect(useEditorStore.getState().stamp).toBe(editor.stamp);expect(useEditorStore.getState().selection).toBe(editor.selection);
    expect(serializeLevel(store.document)).toBe(before);expect(prepared.generatedTilesetIds.every(id=>!getTilesetImage(id))).toBe(true);
    target.beginTransaction();host.smartSources.publish(prepared);expect(prepared.generatedTilesetIds.every(id=>!!target.document.getTileset(id))).toBe(true);
    target.rollback();host.smartSources.releaseTransaction("transaction","cancelled");host.transactions.restoreBaseline(baseline);
    expect(prepared.generatedTilesetIds.every(id=>!getTilesetImage(id))).toBe(true);expect(getTilesetImage("source")).toBe(sourceImage);expect(useProjectLibrary.getState().generatedRecipes).toEqual(baseline.metadata.recipes);
  });
  it("requires a complete unambiguous mapping for a multilayer smart source",async()=>{
    const {host,ws,stamp}=await setup();
    useProjectLibrary.getState().addStamp({...stamp,layers:[...stamp.layers,{...stamp.layers[0]!,layerId:"roof",name:"Roof"}]});
    const args={context:{transactionId:"mapping"},mapId:ws.activeId,source:{stampId:"road"},force:true} as PrepareSmartSourceArgs;
    await expect(host.smartSources.prepare(args,call)).rejects.toMatchObject({code:"STAMP_MAPPING_REQUIRED"});expect(bakeSmartStamp).not.toHaveBeenCalled();
    const ground=ws.active.store.document.layers[0]!.id;ws.active.store.dispatch({type:"setLayerProps",layerId:ground,props:{name:"Ground"}});
    const roof=ws.active.store.dispatch({type:"addLayer",layer:{name:"Roof"}});
    const prepared=await host.smartSources.prepare(args,call);
    expect(prepared.layerMapping).toEqual([{sourceLayerId:"source-layer",targetLayerId:ground},{sourceLayerId:"roof",targetLayerId:roof}]);
    host.smartSources.releaseTransaction("mapping","cancelled");
  });
  it("reports both dimensions on a stamp/map grid mismatch before baking",async()=>{
    const {host,ws}=await setup();ws.active.store.dispatch({type:"resizeMap",width:8,height:8,tileWidth:5,tileHeight:6});
    await expect(host.smartSources.prepare({context:{transactionId:"grid"},mapId:ws.activeId,source:{stampId:"road"},force:true} as PrepareSmartSourceArgs,call)).rejects.toMatchObject({code:"GRID_MISMATCH",details:{sourceTileWidth:5,sourceTileHeight:5,mapTileWidth:5,mapTileHeight:6}});
    expect(bakeSmartStamp).not.toHaveBeenCalled();
  });
  it("never replaces an approved atlas while preparing a later cancellable source",async()=>{
    const {host,ws}=await setup();
    const args={context:{transactionId:"first"},mapId:ws.activeId,source:{stampId:"road"},force:true} as PrepareSmartSourceArgs;
    const first=await host.smartSources.prepare(args,call);ws.active.store.beginTransaction();host.smartSources.publish(first);ws.active.store.commit();host.smartSources.releaseTransaction("first","approved");
    const retained=getTilesetImage(first.generatedTilesetIds[0]!)!;
    const second=await host.smartSources.prepare({...args,context:{...args.context,transactionId:"second"}},call);
    ws.active.store.beginTransaction();host.smartSources.publish(second);ws.active.store.rollback();host.smartSources.releaseTransaction("second","cancelled");
    expect(getTilesetImage(first.generatedTilesetIds[0]!)).toBe(retained);expect(retained.bitmap.close).not.toHaveBeenCalled();
  });
  it("closes a completed private atlas when Stop arrives during its asynchronous bake",async()=>{
    const {host,ws}=await setup();let resume!:()=>void;const gate=new Promise<void>(resolve=>{resume=resolve;});
    const original=vi.mocked(bakeSmartStamp).getMockImplementation()!;let atlas:Awaited<ReturnType<typeof bakeSmartStamp>>|undefined;
    vi.mocked(bakeSmartStamp).mockImplementationOnce(async(...args)=>{await gate;atlas=await original(...args);return atlas;});
    let stopped=false;
    const pending=host.smartSources.prepare({context:{transactionId:"transaction"},mapId:ws.activeId,source:{stampId:"road"},force:true} as PrepareSmartSourceArgs,{...call,signal:{...call.signal,throwIfAborted(){if(stopped)throw Error("Stopped");}}});
    await vi.waitFor(()=>expect(bakeSmartStamp).toHaveBeenCalled());stopped=true;resume();await expect(pending).rejects.toThrow("Stopped");
    expect(atlas!.bitmap.close).toHaveBeenCalledOnce();expect(ws.active.store.document.tilesets).toHaveLength(1);
  });
});
