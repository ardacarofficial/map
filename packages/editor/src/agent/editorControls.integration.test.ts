import { afterEach, expect, it, vi } from "vitest";
import { createAgentApi, CallSignal, memoryCall, type AgentApi, type AgentToolResult, type ToolName } from "@smap/agent";
import { serializeLevel } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { closeProject, getLevelWorkspace, newProject } from "../io/session";
import { useEditorStore } from "../state/editorStore";
import { usePixelUi } from "../state/pixelUi";
import { useProjectLibrary } from "../io/projectLibrary";
import { useDockStore } from "../ui/layout/dockStore";
import { registerCommands } from "../commands/registry";
import { createEditorHost } from "./editorHost";
import { useAppSettings } from "../platform/appSettings";
import { setCanvasHandle } from "../ui/canvas/canvasHandle";
import type { CanvasHandle } from "../canvas";
let api: AgentApi | undefined;
afterEach(async()=>{await api?.dispose();api=undefined;closeProject();setPlatform(browserPlatform);useAppSettings.setState({dialogOpen:false});usePixelUi.setState({mode:"tile",pending:false});setCanvasHandle(null);vi.restoreAllMocks();});
function ok(result: AgentToolResult){expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({ok:true});if(!result.structuredContent.ok)throw Error(result.structuredContent.message);return result.structuredContent;}
async function setup(){setPlatform({...browserPlatform,watchProject(){}});await newProject({name:"Controls",width:16,height:16,tileSize:16});const host=createEditorHost();api=createAgentApi(host);let key=0;
  const run=(name:ToolName,args:object={})=>api!.executeTool({name,arguments:args,clientSessionId:"client",clientInfo:{name:"Test",version:"1"},bridgeEpoch:"epoch",deadline:Date.now()+30000,signal:{aborted:false,throwIfAborted(){},onAbort:()=>()=>{}}});
  const context=()=>({worldSessionId:api!.getState().worldSessionId!});const edit=(name:ToolName,args:object={})=>run(name,{...args,context:{...context(),transactionId:api!.getState().transaction!.id,expectedRevision:api!.getState().revision,idempotencyKey:`control-edit-${++key}`}});
  return{host,run,edit,context,begin:()=>run("begin_edit",{context:context(),expectedRevision:api!.getState().revision,idempotencyKey:"begin-controls",requestLabel:"Controls",mapIds:[getLevelWorkspace()!.activeId]})};}
it("controls remain independent through running, review and discard without approving their own work",async()=>{
  const h=await setup(),ws=getLevelWorkspace()!,store=ws.active.store,before=serializeLevel(store.document);
  store.dispatch({type:"addTileset",tileset:{id:"art",name:"Art",imagePath:"tilesets/art.png",tileWidth:16,tileHeight:16,columns:2,rows:2,margin:0,spacing:0}});
  const depth=ws.history.undoDepth;await h.begin();ok(await h.edit("paint_rect",{mapId:ws.activeId,layerId:store.document.layers[0]!.id,region:{x:0,y:0,width:2,height:2},value:{tilesetId:"art",tileId:0}}));
  const revision=api!.getState().revision;
  ok(await h.run("configure_editor",{gridVisible:false,brush:{size:5,shape:"circle"},pixel:{foreground:"#f00",mirrorH:true},selection:{tile:{tilesetId:"art",tileId:1}}}));
  expect(api!.getState().revision).toBe(revision);expect(api!.getState().phase).toBe("running");
  ok(await h.edit("finish_edit"));
  ok(await h.run("configure_layout",{action:"move",panel:"aiActivity",zone:"right",split:"end"}));
  ok(await h.run("configure_editor",{collisionOverlay:true,rectangle:{mode:"outline",thickness:3},majorGrid:{interval:8,x:2,y:-2}}));
  expect(api!.getState().phase).toBe("awaitingApproval");expect(ws.history.undoDepth).toBe(depth);
  expect((await h.run("run_editor_command",{commandId:"ai.approve"})).structuredContent).toMatchObject({ok:false,code:"INVALID_ARGUMENT"});
  expect((await h.run("configure_editor",{context:{worldSessionId:"old-world"},gridVisible:true})).structuredContent).toMatchObject({ok:false,code:"STALE_WORLD"});
  expect(useEditorStore.getState().gridVisible).toBe(false);
  await api!.userAction("discard");expect(store.document.layers[0]!.getCell(0,0)).toBe(0);expect(useEditorStore.getState().gridVisible).toBe(false);expect(useEditorStore.getState().brushSize).toBe(5);
  expect(ws.history.undoDepth).toBe(depth);expect(before).not.toContain("art");
});
it("preflights mixed UI requests completely, supports navigation during review and validates target-map bounds",async()=>{
  const h=await setup(),ws=getLevelWorkspace()!,first=ws.activeId,other=ws.add({name:"Other",width:4,height:4,tileSize:16,layerName:"Other ground"});
  const original=useEditorStore.getState().gridVisible;
  expect((await h.run("configure_editor",{gridVisible:!original,selection:{entityId:"missing"}})).structuredContent).toMatchObject({ok:false,code:"UNKNOWN_ID"});expect(useEditorStore.getState().gridVisible).toBe(original);
  expect((await h.run("configure_editor",{activeMapId:other.id,selection:{region:{x:0,y:0,width:5,height:1}}})).structuredContent).toMatchObject({ok:false,code:"OUT_OF_BOUNDS"});expect(ws.activeId).toBe(first);
  await h.begin();ok(await h.edit("finish_edit"));const revision=api!.getState().revision;
  ok(await h.run("configure_editor",{activeMapId:other.id,activeLayerId:ws.entry(other.id)!.store.document.layers[0]!.id,selection:{region:{x:1,y:1,width:2,height:2}}}));expect(ws.activeId).toBe(other.id);expect(api!.getState().phase).toBe("awaitingApproval");expect(api!.getState().revision).toBe(revision);
  await api!.userAction("discard");expect(ws.activeId).toBe(other.id);expect(ws.level(first)).toBeDefined();
});
it("discovers real enablement and executes only audited UI commands",async()=>{
  const h=await setup();const safe=vi.fn(),unsafe=vi.fn();registerCommands([{id:"view.toggleGrid",title:"commands.view.toggleGrid",category:"view",run:safe},{id:"file.save",title:"commands.file.save",category:"file",run:unsafe}]);
  const list=ok(await h.run("list_editor_commands",{query:"view.toggleGrid"}));expect(list.data).toMatchObject({items:[{id:"view.toggleGrid",remoteExecutable:true,enabled:true}]});
  ok(await h.run("run_editor_command",{commandId:"view.toggleGrid"}));expect(safe).toHaveBeenCalledTimes(1);
  expect((await h.run("run_editor_command",{commandId:"file.save"})).structuredContent).toMatchObject({ok:false,code:"INVALID_ARGUMENT"});expect(unsafe).not.toHaveBeenCalled();
  useDockStore.getState().beginGesture();expect((await h.run("configure_layout",{action:"reset"})).structuredContent).toMatchObject({ok:false,code:"WRITER_BUSY"});useDockStore.getState().endGesture();
});
it("sets explicit camera/minimap options and returns stable selection/readback",async()=>{
  const h=await setup();let view:"level"|"world"="level";const centerOn=vi.fn(),setZoom=vi.fn(),setMinimapVisible=vi.fn();setCanvasHandle({captureViewport:()=>null,getView:()=>view,setView:(v:"level"|"world")=>{view=v;},setZoom,centerOn,setMinimapVisible,isMinimapVisible:()=>true} as unknown as CanvasHandle);
  ok(await h.run("configure_editor",{camera:{view:"level",zoom:2,center:{x:3,y:4}},minimapVisible:false}));expect(centerOn).toHaveBeenCalledWith(3,4);expect(setZoom).toHaveBeenCalledWith(2);expect(setMinimapVisible).toHaveBeenCalledWith(false);
  expect((await h.run("configure_editor",{gridVisible:true,camera:{view:"world",center:{x:1,y:1}}})).structuredContent).toMatchObject({ok:false,code:"INVALID_ARGUMENT"});expect(view).toBe("level");
});
it.each(["approve","discard"] as const)("library and world metadata %s are atomic, persistence-safe and reversible",async(outcome)=>{
  const h=await setup(),ws=getLevelWorkspace()!,id=ws.activeId,beforeName=ws.activeLevel.name,beforeWorld={...ws.activeLevel.world},settings=useProjectLibrary.getState().settings,depth=ws.history.undoDepth;
  useProjectLibrary.getState().addStamp({id:"house",name:"House",width:1,height:1,palette:[],layers:[{layerId:"source",name:"Ground",cells:Uint32Array.of(0)}]});
  await h.begin();ok(await h.edit("edit_map",{mapId:id,name:"Village",world:{x:-32,y:96}}));ok(await h.edit("configure_world",{settings:{tileWidth:24,newLevel:{width:20},background:"#112233",layerTemplate:[{name:"Ground",kind:"tile"},{name:"Collision",kind:"collision"}]}}));
  ok(await h.edit("edit_stamp",{stampId:"house",action:"update",props:{name:"Home",category:"Buildings",tags:["roof"],favorite:true}}));const duplicate=ok(await h.edit("edit_stamp",{stampId:"house",action:"duplicate",name:"Villa"}));expect(duplicate.data).toMatchObject({stamp:{name:"Villa",category:"Buildings"}});
  expect(ws.activeLevel.name).toBe("Village");expect(useProjectLibrary.getState().levels.find(level=>level.id===id)).toMatchObject({name:"Village",world:{x:-32,y:96}});expect(ws.history.undoDepth).toBe(depth);ok(await h.edit("finish_edit"));await api!.userAction(outcome);
  if(outcome==="approve"){expect(ws.history.undoDepth).toBe(depth+1);ws.history.undo();}
  expect(ws.activeLevel.name).toBe(beforeName);expect(ws.activeLevel.world).toEqual(beforeWorld);expect(useProjectLibrary.getState().settings).toEqual(settings);expect(useProjectLibrary.getState().stamps).toMatchObject([{id:"house",name:"House"}]);expect(useProjectLibrary.getState().stamps).toHaveLength(1);
  if(outcome==="approve"){ws.history.redo();expect(ws.activeLevel.name).toBe("Village");expect(useProjectLibrary.getState().stamps).toHaveLength(2);}
});

it("cancelled asynchronous navigation never applies requested controls",async()=>{
 const h=await setup(),ws=getLevelWorkspace()!,first=ws.activeId,other=ws.add({name:"Other",width:4,height:4,tileSize:16,layerName:"Ground"}),store=ws.entry(other.id)!.store;
 const original=useEditorStore.getState().gridVisible;let resolve!:(value:typeof store)=>void;const load=vi.spyOn(h.host.world,"loadMap").mockReturnValue(new Promise(r=>{resolve=r;}));const signal=new CallSignal();
 const pending=api!.executeTool({...memoryCall("configure_editor",{activeMapId:other.id,gridVisible:!original}),signal});await vi.waitFor(()=>expect(load).toHaveBeenCalled());signal.abort();expect((await pending).structuredContent).toMatchObject({ok:false,code:"CANCELLED"});resolve(store);await Promise.resolve();await Promise.resolve();expect(ws.activeId).toBe(first);expect(useEditorStore.getState().gridVisible).toBe(original);
});
it("cross-map oriented tile selection resolves a target default layer",async()=>{
 const h=await setup(),ws=getLevelWorkspace()!,store=ws.active.store;store.dispatch({type:"addTileset",tileset:{id:"art",name:"Art",imagePath:"tilesets/art.png",tileWidth:16,tileHeight:16,columns:2,rows:2,margin:0,spacing:0}});
 const other=ws.add({name:"Other",width:4,height:4,tileSize:16,layerName:"Target ground"}),layer=ws.entry(other.id)!.store.document.layers[0]!.id;
 ok(await h.run("configure_editor",{activeMapId:other.id,selection:{tile:{tilesetId:"art",tileId:0,flags:1}}}));expect(useEditorStore.getState().activeLayerId).toBe(layer);expect(useEditorStore.getState().stamp!.layers[0]!.layerId).toBe(layer);
});
it("export preferences remain independent during review and reject enabling automatic delivery without a destination",async()=>{
 const h=await setup();await h.begin();ok(await h.edit("finish_edit"));const revision=api!.getState().revision;
 const configured=ok(await h.run("configure_export",{preferences:{target:"png",pngScale:4,unityTiles:false,autoUnity:false}}));expect(configured.data).toMatchObject({target:"png",pngScale:4,unityTiles:false});expect(ok(await h.run("get_export_settings")).data).toMatchObject({target:"png",pngScale:4});
 expect((await h.run("configure_export",{preferences:{autoUnity:true}})).structuredContent).toMatchObject({ok:false,code:"INVALID_ARGUMENT"});expect(api!.getState().revision).toBe(revision);expect(api!.getState().phase).toBe("awaitingApproval");
});
