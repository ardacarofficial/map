import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentApi, AgentConnection, AgentHost, AgentState, AgentToolResult, BridgeControl, BridgeRequest } from "@smap/agent";
import { browserPlatform, setPlatform } from "../platform";
import { installAgentRuntime, getAgentRuntime } from "./runtime";
const state:AgentState={phase:"ready",instanceId:"instance",worldSessionId:null,revision:0,committedRevision:0,transaction:null};
function setup(){
  let request=(_value:BridgeRequest)=>{},control=(_value:BridgeControl)=>{};
  const listeners=new Set<(value:AgentState)=>void>();
  let current=state;
  const api:AgentApi={executeTool:vi.fn(async()=>({content:[{type:"text",text:"{}"}],structuredContent:{}} as AgentToolResult)),describeTools:()=>[],sessionEnded:vi.fn(async()=>{}),userAction:vi.fn(async()=>{}),getState:()=>current,subscribe:cb=>{listeners.add(cb);return()=>{listeners.delete(cb);};}};
  const connection:AgentConnection={onRequest:cb=>{request=cb;return()=>{};},onControl:cb=>{control=cb;return()=>{};},reply:vi.fn(async()=>{}),publishStatus:vi.fn(async()=>{}),ready:vi.fn(async()=>{}),getSettings:vi.fn(),setSettings:vi.fn(),revealToken:vi.fn(),copyToken:vi.fn(),regenerateToken:vi.fn(),status:{state:"listening",port:48765,clients:[]},subscribeStatus:()=>()=>{}};
  const call=(epoch:string):BridgeRequest=>({requestId:"request",bridgeEpoch:epoch,clientSessionId:"client",clientInfo:{name:"Test",version:"1"},type:"tools/call",deadline:Date.now()+1000,name:"get_session",arguments:{}});
  return {api,connection,emitState:(value:AgentState)=>{current=value;for(const cb of listeners)cb(value);},request:(r:BridgeRequest)=>request(r),control:(c:BridgeControl)=>control(c),call};
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
