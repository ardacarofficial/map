import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentApi, AgentConnection, AgentHost, AgentState, AgentConnectionStatus, AgentToolResult, BridgeControl, BridgeRequest } from "@smap/agent";
import { createMemoryHost, memoryCall } from "../../../agent/src/testing/memoryHost";
import { serializeLevel } from "@smap/core";
import { browserPlatform, setPlatform } from "../platform";
import { installAgentRuntime, getAgentRuntime } from "./runtime";
const state:AgentState={phase:"ready",instanceId:"instance",worldSessionId:null,revision:0,committedRevision:0,transaction:null};
function setup(){
  let request=(_value:BridgeRequest)=>{},control=(_value:BridgeControl)=>{};
  const listeners=new Set<(value:AgentState)=>void>();
  let current=state;
  const statusListeners=new Set<(value:AgentConnectionStatus)=>void>();
  const api:AgentApi={executeTool:vi.fn(async()=>({content:[{type:"text",text:"{}"}],structuredContent:{}} as AgentToolResult)),describeTools:()=>[],sessionEnded:vi.fn(async()=>{}),userAction:vi.fn(async()=>{}),getState:()=>current,subscribe:cb=>{listeners.add(cb);return()=>{listeners.delete(cb);};}};
  const connection:AgentConnection={onRequest:cb=>{request=cb;return()=>{};},onControl:cb=>{control=cb;return()=>{};},reply:vi.fn(async()=>{}),publishStatus:vi.fn(async()=>{}),ready:vi.fn(async()=>{}),getSettings:vi.fn(),setSettings:vi.fn(),revealToken:vi.fn(),copyToken:vi.fn(),regenerateToken:vi.fn(),status:{state:"listening",port:48765,clients:[]},subscribeStatus:cb=>{statusListeners.add(cb);return()=>{statusListeners.delete(cb);};}};
  const call=(epoch:string):BridgeRequest=>({requestId:"request",bridgeEpoch:epoch,clientSessionId:"client",clientInfo:{name:"Test",version:"1"},type:"tools/call",deadline:Date.now()+1000,name:"get_session",arguments:{}});
  return {api,connection,status:(value:AgentConnectionStatus)=>{for(const cb of statusListeners)cb(value);},emitState:(value:AgentState)=>{current=value;for(const cb of listeners)cb(value);},request:(r:BridgeRequest)=>request(r),control:(c:BridgeControl)=>control(c),call};
}
afterEach(async()=>{await getAgentRuntime()?.dispose();vi.useRealTimers();setPlatform(browserPlatform);});
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
  it("aborts a timed out request, ends its session and drops a late completion",async()=>{
    vi.useFakeTimers();setPlatform({...browserPlatform,onFileChanged:()=>()=>{}});const fake=setup();let finish!:(r:AgentToolResult)=>void;
    vi.mocked(fake.api.executeTool).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const runtime=await installAgentRuntime({connection:fake.connection,host:{} as AgentHost,apiFactory:()=>fake.api});fake.request(fake.call(runtime.bridgeEpoch));
    await vi.advanceTimersByTimeAsync(1001);expect(fake.api.sessionEnded).toHaveBeenCalledWith("client");
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
  it("ignores stale session controls and discards before detaching the current runtime",async()=>{
    setPlatform({...browserPlatform,onFileChanged:()=>()=>{}});const fake=setup();
    const runtime=await installAgentRuntime({connection:fake.connection,host:{} as AgentHost,apiFactory:()=>fake.api});
    fake.control({type:"sessionEnded",bridgeEpoch:"old",clientSessionId:"client",reason:"disconnect"});expect(fake.api.sessionEnded).not.toHaveBeenCalled();
    fake.control({type:"sessionEnded",bridgeEpoch:runtime.bridgeEpoch,clientSessionId:"client",reason:"disconnect"});expect(fake.api.sessionEnded).toHaveBeenCalledWith("client");
    await runtime.dispose();expect(fake.api.userAction).toHaveBeenCalledWith("discard");expect(getAgentRuntime()).toBeNull();
  });
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
