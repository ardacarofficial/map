import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRgbaPng, serializeLevel } from "@smap/core";
import { browserPlatform, setPlatform, type ProjectFileChange } from "../platform";
import { MemoryFileSystem } from "../io/memoryFs";
import { checkProjectRootChange, closeProject, newProject } from "../io/session";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage, onTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { installFileChangeHandling, reloadTilesetImage } from "../platform/fileChanges";
import { editGate, getAgentWorldSessionId, registerPendingCancellation } from "./editGate";
let cleanup=()=>{},release=()=>{};
afterEach(()=>{release();cleanup();cleanup=()=>{};release=()=>{};closeProject();setPlatform(browserPlatform);vi.unstubAllGlobals();});
async function setup(){setPlatform({...browserPlatform,watchProject(){}});const fs=new MemoryFileSystem();await newProject({name:"External",width:4,height:4,tileSize:2,folder:{fs,label:"External",ref:"external"}});return{fs,store:useEditorStore.getState().project!.store};}
describe("external evidence cancels before publication",()=>{
  it("rolls back before a changed PNG replaces the source bitmap, and ignores equal-byte echoes",async()=>{
    const {fs,store}=await setup();const ts={id:"source",name:"Source",imagePath:"tilesets/source.png",tileWidth:2,tileHeight:2,columns:1,rows:1,margin:0,spacing:0};
    store.dispatch({type:"addTileset",tileset:ts});const original=encodeRgbaPng(2,2,new Uint8Array(16).fill(255));
    await fs.writeBytes(ts.imagePath,original);setTilesetImage({tilesetId:ts.id,bytes:original,bitmap:{width:2,height:2,close(){}} as ImageBitmap});
    const old=getTilesetImage(ts.id),before=serializeLevel(store.document),edit=editGate.acquireEdit(getAgentWorldSessionId()!);release=()=>edit.release("cancelled");
    store.beginTransaction();store.dispatch({type:"setLayerProps",layerId:store.document.layers[0]!.id,props:{name:"Pending"}});
    const cancel=vi.fn(async()=>{store.rollback();release();});cleanup=registerPendingCancellation(cancel);
    await reloadTilesetImage(ts.imagePath);expect(cancel).not.toHaveBeenCalled();expect(getTilesetImage(ts.id)).toBe(old);
    const external=encodeRgbaPng(2,2,new Uint8Array(16).fill(99));await fs.writeBytes(ts.imagePath,external);
    vi.stubGlobal("createImageBitmap",async()=>({width:2,height:2,close(){}} as ImageBitmap));
    const observed=vi.fn(()=>{expect(editGate.blocked).toBe(false);expect(serializeLevel(store.document)).toBe(before);});const off=onTilesetImage(observed);
    try{await reloadTilesetImage(ts.imagePath);expect(cancel).toHaveBeenCalledOnce();expect(observed).toHaveBeenCalledOnce();expect(await fs.readBytes(ts.imagePath)).toEqual(external);}finally{off();}
  });
  it("does not lose a root change when an equal-byte level echo arrives in the same watcher burst",async()=>{
    const {fs}=await setup();let notify=(_change:ProjectFileChange)=>{};
    setPlatform({...browserPlatform,watchProject(){},onFileChanged(cb){notify=cb;return()=>{};}});
    const off=installFileChangeHandling(),edit=editGate.acquireEdit(getAgentWorldSessionId()!);release=()=>edit.release("cancelled");
    const cancel=vi.fn(async()=>release());cleanup=registerPendingCancellation(cancel);
    const root=await fs.readText("project.smap");await fs.writeText("project.smap",root.replace('"External"','"Changed outside"'));
    try{notify({path:"levels/main.json",kind:"modified"});notify({path:"project.smap",kind:"modified"});await vi.waitFor(()=>expect(cancel).toHaveBeenCalledOnce());}finally{off();}
  });
  it("detects a project-root edit even when the active map file is unchanged",async()=>{
    const {fs}=await setup();const edit=editGate.acquireEdit(getAgentWorldSessionId()!);release=()=>edit.release("cancelled");
    const cancel=vi.fn(async()=>release());cleanup=registerPendingCancellation(cancel);
    await checkProjectRootChange();expect(cancel).not.toHaveBeenCalled();
    const root=await fs.readText("project.smap");await fs.writeText("project.smap",root.replace('"External"','"Changed outside"'));
    await checkProjectRootChange();expect(cancel).toHaveBeenCalledOnce();
  });
});
