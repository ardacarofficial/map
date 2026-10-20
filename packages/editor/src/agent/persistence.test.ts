import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSignal } from "@smap/agent";
import { browserPlatform, setPlatform, type ProjectLocation } from "../platform";
import { MemoryFileSystem } from "../io/memoryFs";
import { closeProject, getLevelWorkspace, installSession, newProject, saveCurrentProject, waitForWrites } from "../io/session";
import { editGate, getAgentWorldSessionId } from "./editGate";
const signal:AgentSignal={aborted:false,throwIfAborted(){},onAbort:()=>()=>{}};
let off=()=>{},release=()=>{};
beforeEach(()=>{setPlatform({...browserPlatform,watchProject(){},onCloseRequested:()=>()=>{},setUnsavedChanges(){}});});
afterEach(()=>{release();release=()=>{};off();off=()=>{};closeProject();vi.useRealTimers();vi.unstubAllGlobals();setPlatform(browserPlatform);});
describe("live pending-edit persistence races",()=>{
  it("begin waits for a manual Save As paused before the write queue",async()=>{
    let pick!:(folder:ProjectLocation)=>void;const fs=new MemoryFileSystem(),folder={fs,label:"Live",ref:"live"};
    setPlatform({...browserPlatform,watchProject(){},pickProjectFolder:()=>new Promise(resolve=>{pick=resolve;})});
    await newProject({name:"Live",width:8,height:8,tileSize:16});
    const save=saveCurrentProject(true);
    const edit=editGate.acquireEdit(getAgentWorldSessionId()!);release=()=>edit.release("cancelled");
    let ready=false;const wait=edit.waitForWrites(signal,Date.now()+3000).then(()=>{ready=true;});
    await Promise.resolve();expect(ready).toBe(false);expect(fs.files.size).toBe(0);
    pick(folder);expect(await save).toBe(true);await wait;
    expect(await fs.readText("project.smap")).toContain("Live");expect(ready).toBe(true);
  });
  it("Save As preserves optional independent tag bytes, including an unreadable future sidecar",async()=>{
    const source=new MemoryFileSystem(),target=new MemoryFileSystem();
    const sourceFolder={fs:source,label:"Source",ref:"source"},targetFolder={fs:target,label:"Target",ref:"target"};
    setPlatform({...browserPlatform,watchProject(){},pickProjectFolder:async()=>targetFolder});
    await newProject({name:"Live",width:8,height:8,tileSize:16,folder:sourceFolder});
    const text='{"format":"smap-ai-tags","tagFormatVersion":42,"preserve":"exact"}';await source.writeText("ai-tags.json",text);
    expect(await saveCurrentProject(true)).toBe(true);expect(await target.readText("ai-tags.json")).toBe(text);expect(await source.readText("ai-tags.json")).toBe(text);
  });
  it("reschedules pre-existing dirty work after discard, beyond idle and max-wait autosave windows",async()=>{
    vi.useFakeTimers();vi.stubGlobal("window",{addEventListener(){},removeEventListener(){}});
    const fs=new MemoryFileSystem();await newProject({name:"Live",width:8,height:8,tileSize:16,folder:{fs,label:"Live",ref:"live"}});
    off=installSession();const ws=getLevelWorkspace()!,store=ws.active.store;
    store.dispatch({type:"setLayerProps",layerId:store.document.layers[0]!.id,props:{name:"Existing unsaved work"}});
    const before=await fs.readText("levels/main.json");
    const edit=editGate.acquireEdit(getAgentWorldSessionId()!);release=()=>edit.release("cancelled");
    await vi.advanceTimersByTimeAsync(31000);expect(await fs.readText("levels/main.json")).toBe(before);
    release();await vi.advanceTimersByTimeAsync(2100);await waitForWrites();
    expect(await fs.readText("levels/main.json")).toContain("Existing unsaved work");
  });
});
