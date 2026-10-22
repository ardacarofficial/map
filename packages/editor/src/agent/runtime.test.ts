import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentApi, AgentConnection, AgentHost, AgentState, AgentConnectionStatus, AgentToolResult, BridgeControl, BridgeRequest } from "@smap/agent";
import { createMemoryHost, memoryCall } from "../../../agent/src/testing/memoryHost";
import { serializeLevel } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { installAgentRuntime, getAgentRuntime } from "./runtime";
import { startDevMcp } from "../../dev/devMcp";
import * as editorHost from "./editorHost";
import { getAgentApi } from "./agentUiState";
import { hasAgentWorldFlush } from "./editGate";
const state:AgentState={phase:"ready",instanceId:"instance",worldSessionId:null,revision:0,committedRevision:0,transaction:null};
function setup(){
  let request=(_value:BridgeRequest)=>{},control=(_value:BridgeControl)=>{};
  const listeners=new Set<(value:AgentState)=>void>();
  let current=state;
  const statusListeners=new Set<(value:AgentConnectionStatus)=>void>();
  const api:AgentApi={executeTool:vi.fn(async()=>({content:[{type:"text",text:"{}"}],structuredContent:{}} as AgentToolResult)),describeTools:()=>[],sessionEnded:vi.fn(async()=>{}),userAction:vi.fn(async()=>{}),dispose:vi.fn(async()=>{}),getState:()=>current,subscribe:cb=>{listeners.add(cb);return()=>{listeners.delete(cb);};}};
  const connection:AgentConnection={onRequest:cb=>{request=cb;return()=>{};},onControl:cb=>{control=cb;return()=>{};},reply:vi.fn(async()=>{}),publishStatus:vi.fn(async()=>{}),ready:vi.fn(async()=>{}),getSettings:vi.fn(),setSettings:vi.fn(),revealToken:vi.fn(),copyToken:vi.fn(),regenerateToken:vi.fn(),status:{state:"listening",port:48765,clients:[]},subscribeStatus:cb=>{statusListeners.add(cb);return()=>{statusListeners.delete(cb);};}};
  const call=(epoch:string):BridgeRequest=>({requestId:"request",bridgeEpoch:epoch,clientSessionId:"client",clientInfo:{name:"Test",version:"1"},type:"tools/call",deadline:Date.now()+1000,name:"get_session",arguments:{}});
  return {api,connection,status:(value:AgentConnectionStatus)=>{for(const cb of statusListeners)cb(value);},emitState:(value:AgentState)=>{current=value;for(const cb of listeners)cb(value);},request:(r:BridgeRequest)=>request(r),control:(c:BridgeControl)=>control(c),call};
}
afterEach(async()=>{await getAgentRuntime()?.dispose();vi.restoreAllMocks();vi.useRealTimers();setPlatform(browserPlatform);});
describe("live transport runtime",()=>{
  it("forwards authenticated identity and rejects a request from a stale webview epoch",async()=>{
    setPlatform({...browserPlatform,onFileChanged:()=>()=>{}});const fake=setup();
    const runtime=await installAgentRuntime({connection:fake.connection,host:{} as AgentHost,apiFactory:()=>fake.api});
    fake.request(fake.call("old"));await Promise.resolve();expect(fake.api.executeTool).not.toHaveBeenCalled();
    expect(fake.connection.reply).toHaveBeenCalledWith(expect.objectContaining({type:"failure",error:expect.objectContaining({code:"STALE_EPOCH"})}));
    fake.request(fake.call(runtime.bridgeEpoch));await Promise.resolve();await Promise.resolve();
    expect(fake.api.executeTool).toHaveBeenCalledWith(expect.objectContaining({clientSessionId:"client",clientInfo:{name:"Test",version:"1"},bridgeEpoch:runtime.bridgeEpoch}));
    expect(fake.connection.reply).toHaveBeenCalledWith(expect.objectContaining({type:"result",requestId:"request"}));
  });
  it("aborts only the timed out request and drops a late completion",async()=>{
    vi.useFakeTimers();setPlatform({...browserPlatform,onFileChanged:()=>()=>{}});const fake=setup();let finish!:(r:AgentToolResult)=>void;
    vi.mocked(fake.api.executeTool).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const runtime=await installAgentRuntime({connection:fake.connection,host:{} as AgentHost,apiFactory:()=>fake.api});fake.request(fake.call(runtime.bridgeEpoch));
    await vi.advanceTimersByTimeAsync(1001);expect(fake.api.sessionEnded).not.toHaveBeenCalled();
    const forwarded=vi.mocked(fake.api.executeTool).mock.calls[0]![0];expect(forwarded.signal.aborted).toBe(true);
    finish({} as AgentToolResult);await Promise.resolve();await Promise.resolve();expect(fake.connection.reply).not.toHaveBeenCalled();
  });
  it("Stop aborts an in-flight image reply without expiring the stopped edit later",async()=>{
    vi.useFakeTimers();setPlatform({...browserPlatform,onFileChanged:()=>()=>{}});const fake=setup();
    vi.mocked(fake.api.executeTool).mockImplementation(()=>new Promise(()=>{}));
    const runtime=await installAgentRuntime({connection:fake.connection,host:{} as AgentHost,apiFactory:()=>fake.api});
    fake.request({...fake.call(runtime.bridgeEpoch),name:"render_preview"});
    fake.emitState({...state,phase:"stopped",transaction:{owner:{clientSessionId:"client"}} as AgentState["transaction"]});
    expect(vi.mocked(fake.api.executeTool).mock.calls[0]![0].signal.aborted).toBe(true);
    expect(fake.connection.reply).toHaveBeenCalledWith(expect.objectContaining({type:"failure",error:expect.objectContaining({code:"CANCELLED"})}));
    await vi.advanceTimersByTimeAsync(1001);expect(fake.api.sessionEnded).not.toHaveBeenCalled();
  });
  it("ignores stale session controls and disposes the API before detaching the current runtime",async()=>{
    setPlatform({...browserPlatform,onFileChanged:()=>()=>{}});const fake=setup();
    const runtime=await installAgentRuntime({connection:fake.connection,host:{} as AgentHost,apiFactory:()=>fake.api});
    fake.control({type:"sessionEnded",bridgeEpoch:"old",clientSessionId:"client",reason:"disconnect"});expect(fake.api.sessionEnded).not.toHaveBeenCalled();
    fake.control({type:"sessionEnded",bridgeEpoch:runtime.bridgeEpoch,clientSessionId:"client",reason:"disconnect"});expect(fake.api.sessionEnded).toHaveBeenCalledWith("client");
    await runtime.dispose();expect(fake.api.dispose).toHaveBeenCalledTimes(1);expect(getAgentRuntime()).toBeNull();
  });
  it("closes request admission as soon as disposal starts and shares its completion",async()=>{
    setPlatform({...browserPlatform,onFileChanged:()=>()=>{}});const fake=setup();
    let finish!:()=>void;
    vi.mocked(fake.api.dispose).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const runtime=await installAgentRuntime({connection:fake.connection,host:{} as AgentHost,apiFactory:()=>fake.api});
    const disposing=runtime.dispose(),again=runtime.dispose();
    fake.request(fake.call(runtime.bridgeEpoch));
    finish();await Promise.all([disposing,again]);
    expect(fake.api.executeTool).not.toHaveBeenCalled();
    expect(fake.api.dispose).toHaveBeenCalledTimes(1);
    expect(getAgentRuntime()).toBeNull();
  });
  it("detaches the runtime after tag persistence fails so a replacement can install",async()=>{
    const offFile=vi.fn();setPlatform({...browserPlatform,onFileChanged:()=>offFile});
    const fake=setup(),host=createMemoryHost(),failure=new Error("disk unavailable");
    const disposeTags=vi.fn(),clearReferences=vi.fn();
    const live={...host,setClients:vi.fn(),tags:{...host.tags,reload:vi.fn(async()=>{}),folderChanged:vi.fn(async()=>{}),externalChange:vi.fn(async()=>{}),dispose:disposeTags,flush:vi.fn(async():Promise<void>=>{throw failure;})},visualReferences:{...host.visualReferences!,clear:clearReferences}};
    vi.spyOn(editorHost,"createEditorHost").mockReturnValue(live);
    const runtime=await installAgentRuntime({connection:fake.connection});
    const original=serializeLevel(host.stores.get("map-1")!.document),worldSessionId=host.session().worldSessionId!;
    const begin=await runtime.api.executeTool(memoryCall("begin_edit",{context:{worldSessionId},expectedRevision:runtime.api.getState().revision,idempotencyKey:"dispose-begin",requestLabel:"Pending edit",mapIds:["map-1"]}));
    expect(begin.structuredContent.ok).toBe(true);
    const painted=await runtime.api.executeTool(memoryCall("paint_cells",{context:{worldSessionId,transactionId:runtime.api.getState().transaction!.id,expectedRevision:runtime.api.getState().revision,idempotencyKey:"dispose-paint"},mapId:"map-1",layerId:"ground",cells:[{x:1,y:1,value:{tilesetId:"tiles",tileId:0}}]}));
    expect(painted.structuredContent.ok).toBe(true);
    expect(serializeLevel(host.stores.get("map-1")!.document)).not.toBe(original);
    const execute=vi.spyOn(runtime.api,"executeTool");
    try {
      await expect(runtime.dispose()).rejects.toBe(failure);
      expect(getAgentRuntime()).toBeNull();
      expect(getAgentApi()).toBeNull();
      expect(hasAgentWorldFlush()).toBe(false);
      expect(offFile).toHaveBeenCalledTimes(1);
      expect(disposeTags).toHaveBeenCalledTimes(1);
      expect(clearReferences).toHaveBeenCalled();
      expect(serializeLevel(host.stores.get("map-1")!.document)).toBe(original);
      expect(host.transactions.writeGate.blocked).toBe(false);
      const replacement=setup();
      await installAgentRuntime({connection:replacement.connection,host:{} as AgentHost,apiFactory:()=>replacement.api});
      fake.request(fake.call(runtime.bridgeEpoch));
      expect(execute).not.toHaveBeenCalled();
    } finally {
      vi.mocked(live.tags.flush).mockResolvedValue(undefined);
      await runtime.dispose().catch(()=>{});
    }
  });
});

for (const order of ["renderer-first", "transport-first"] as const)
 for (const tool of ["render_preview", "prepare_smart_source"] as const)
  it(`recovers the same HTTP session and retains reviewable work after ${tool} times out (${order})`, async () => {
    setPlatform({...browserPlatform,onFileChanged:()=>()=>{}});
    const transport = await startDevMcp({port:0,token:"timeout-test",imageTimeoutMs:120});
    const fake = setup(), host = createMemoryHost();
    let complete!: (value: never) => void;
    const suspended = vi.fn(() => new Promise<never>(resolve => { complete = resolve; }));
    if (tool === "render_preview") host.images.renderPreview = suspended;
    else host.smartSources.prepare = suspended;
    fake.connection.ready = async epoch => transport.attach("renderer",epoch,message => {
      if (message.type === "tools/call") fake.request({...message,deadline:message.deadline + (order === "renderer-first" ? -60 : 60)});
      else fake.control(message);
    });
    fake.connection.reply = vi.fn(async reply => { transport.reply("renderer",reply); });
    const runtime = await installAgentRuntime({connection:fake.connection,host});
    const ended = vi.spyOn(runtime.api,"sessionEnded");
    const post = (body:unknown, session?:string) => fetch(`${transport.url}?pair=renderer`,{
      method:"POST",headers:{Authorization:"Bearer timeout-test","Content-Type":"application/json",Accept:"application/json, text/event-stream",...(session?{"Mcp-Session-Id":session}: {})},body:JSON.stringify(body),
    });
    try {
      const initialized = await post({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"recovery",version:"1"}}});
      const session = initialized.headers.get("Mcp-Session-Id")!;
      await initialized.json();
      await post({jsonrpc:"2.0",method:"notifications/initialized"},session);
      const original = serializeLevel(host.stores.get("map-1")!.document), worldSessionId = host.session().worldSessionId!;
      const run = (name:string,args:unknown) => runtime.api.executeTool(memoryCall(name,args,{clientSessionId:session,bridgeEpoch:runtime.bridgeEpoch}));
      await run("begin_edit",{context:{worldSessionId},expectedRevision:runtime.api.getState().revision,idempotencyKey:"begin-recovery",requestLabel:"Retained work",mapIds:["map-1"]});
      const context = () => ({worldSessionId,transactionId:runtime.api.getState().transaction!.id,expectedRevision:runtime.api.getState().revision,idempotencyKey:crypto.randomUUID()});
      await run("paint_cells",{context:context(),mapId:"map-1",layerId:"ground",cells:[{x:1,y:1,value:{tilesetId:"tiles",tileId:0}}]});
      const painted = serializeLevel(host.stores.get("map-1")!.document);
      expect(painted).not.toBe(original);
      const args = tool === "render_preview" ? {context:{worldSessionId},mapId:"map-1"} : {context:context(),mapId:"map-1",source:{tilesetId:"tiles",region:{x:0,y:0,width:3,height:3}},force:true};
      const pending = post({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:tool,arguments:args}},session);
      await vi.waitFor(() => expect(suspended).toHaveBeenCalled());
      expect((await (await pending).json()).result.structuredContent.code).toBe("TIMEOUT");
      const recovered = await (await post({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"get_session",arguments:{}}},session)).json();
      expect(recovered.result.structuredContent).toMatchObject({ok:true});
      expect(runtime.api.getState().phase).toBe(tool === "render_preview" ? "running" : "stopped");
      expect(serializeLevel(host.stores.get("map-1")!.document)).toBe(painted);
      expect(ended).not.toHaveBeenCalled();
      expect(transport.sessionCount).toBe(1);
      complete({} as never);
      await Promise.resolve();
      expect(vi.mocked(fake.connection.reply).mock.calls.filter(([reply])=>reply.requestId!==undefined && reply.type==="result")).toHaveLength(1);
      await runtime.api.userAction("approve");
      expect(host.history.undoDepth).toBe(1);
      host.history.undo();
      expect(serializeLevel(host.stores.get("map-1")!.document)).toBe(original);
    } finally {
      await runtime.dispose();
      await transport.close();
    }
  });

for (const phase of ["running", "stopped", "awaitingApproval"] as const)
  for (const ending of ["delete", "expired", "tokenRegenerated", "disconnect", "disabled", "failed", "portInUse"] as const)
    it(`${ending} rolls back only running edits and preserves ${phase} review`, async () => {
      setPlatform({...browserPlatform,onFileChanged:()=>()=>{}});
      const fake=setup(),host=createMemoryHost();
      const runtime=await installAgentRuntime({connection:fake.connection,host});
      const api=runtime.api,worldSessionId=host.session().worldSessionId!;
      const run=async(name:string,args:unknown)=>{
        const result=await api.executeTool(memoryCall(name,args,{bridgeEpoch:runtime.bridgeEpoch}));
        expect(result.structuredContent.ok).toBe(true);
        return result.structuredContent;
      };
      const original=serializeLevel(host.stores.get("map-1")!.document);
      await run("begin_edit",{context:{worldSessionId},expectedRevision:api.getState().revision,idempotencyKey:"runtime-begin",requestLabel:"Garden",mapIds:["map-1"]});
      const context=()=>({worldSessionId,transactionId:api.getState().transaction!.id,expectedRevision:api.getState().revision,idempotencyKey:crypto.randomUUID()});
      await run("paint_cells",{context:context(),mapId:"map-1",layerId:"ground",cells:[{x:1,y:1,value:{tilesetId:"tiles",tileId:0}}]});
      if(phase==="stopped")await api.userAction("stop");
      if(phase==="awaitingApproval")await run("finish_edit",{context:context()});
      const painted=serializeLevel(host.stores.get("map-1")!.document);
      // Keep a bridge request in flight: aborting it must not turn running work
      // into a user-stopped review before disconnect chooses its rollback policy.
      const prepare=vi.fn(()=>new Promise<never>(()=>{})),preview=vi.fn(()=>new Promise<never>(()=>{}));
      host.smartSources.prepare=prepare;host.images.renderPreview=preview;
      fake.request({...fake.call(runtime.bridgeEpoch),clientSessionId:"client-1",deadline:Date.now()+10000,
        name:phase==="running"?"prepare_smart_source":"render_preview",
        arguments:phase==="running"?{context:context(),mapId:"map-1",source:{tilesetId:"tiles",region:{x:0,y:0,width:3,height:3}},force:true}:{context:{worldSessionId},mapId:"map-1"}});
      await vi.waitFor(()=>expect(phase==="running"?prepare:preview).toHaveBeenCalled());
      if(ending==="disabled"||ending==="failed"||ending==="portInUse")fake.status({state:ending,port:48765,clients:[]});
      else fake.control({type:"sessionEnded",bridgeEpoch:runtime.bridgeEpoch,clientSessionId:"client-1",reason:ending});
      await vi.waitFor(()=>expect(api.getState().phase).toBe(phase==="running"?"ready":phase));
      if(phase==="running")expect(serializeLevel(host.stores.get("map-1")!.document)).toBe(original);
      else {
        await vi.waitFor(()=>expect(api.getState().transaction!.owner.clientSessionId).toBeNull());
        expect(serializeLevel(host.stores.get("map-1")!.document)).toBe(painted);
        await api.userAction("approve");
        expect(host.history.undoDepth).toBe(1);
        host.history.undo();
        expect(serializeLevel(host.stores.get("map-1")!.document)).toBe(original);
      }
    });
