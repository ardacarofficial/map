import { createAgentApi, type AgentApi, type AgentConnection, type AgentHost, type AgentSignal, type BridgeRequest } from "@smap/agent";
import { useEditorStore } from "../state/editorStore";
import { getLevelWorkspace, getProjectFolder, registerUnsavedGuard } from "../io/session";
import { getPlatform } from "../platform";
import { bindAgentUiState } from "./agentUiState";
import { createEditorHost } from "./editorHost";
import { cancelPendingEdit, editGate, registerPendingCancellation, registerAgentWorldFlush } from "./editGate";

export interface AgentRuntime { host:AgentHost; api:AgentApi; connection:AgentConnection; bridgeEpoch:string; dispose():Promise<void> }
let installed:AgentRuntime|null=null;
export const getAgentRuntime=()=>installed;
export function createAgentSignal(controller:AbortController):AgentSignal {
  return{get aborted(){return controller.signal.aborted;},throwIfAborted(){controller.signal.throwIfAborted();},onAbort(cb){controller.signal.addEventListener("abort",cb,{once:true});if(controller.signal.aborted)cb();return()=>controller.signal.removeEventListener("abort",cb);}};
}
/** One transport belongs to one live webview epoch. No document copies cross the bridge. */
export async function installAgentRuntime(options:{connection:AgentConnection;host?:AgentHost;apiFactory?:(host:AgentHost)=>AgentApi}):Promise<AgentRuntime> {
  if(installed)await installed.dispose();
  const connection=options.connection,live=options.host?null:createEditorHost(),host=options.host??live!;
  const api=(options.apiFactory??createAgentApi)(host),bridgeEpoch=crypto.randomUUID();
  const requests=new Map<string,{controller:AbortController;request:BridgeRequest;timer:ReturnType<typeof setTimeout>}>();
  const clients=new Map<string,BridgeRequest["clientInfo"]>();
  let disposed=false;
  const log=(error:unknown)=>{getPlatform().log("warn",error instanceof Error?error.name:"Agent runtime failure");};
  const updateClients=()=>live?.setClients([...clients].map(([clientSessionId,info])=>({...info,state:"connected",isWriter:api.getState().transaction?.owner.clientSessionId===clientSessionId})));
  const publish=(requestId?:string)=>connection.publishStatus({bridgeEpoch,...(requestId?{requestId}:{}),state:api.getState()}).catch(log);
  const offRequest=connection.onRequest(request=>{
    if(disposed||request.bridgeEpoch!==bridgeEpoch){void connection.reply({requestId:request.requestId,bridgeEpoch:request.bridgeEpoch,clientSessionId:request.clientSessionId,type:"failure",error:{code:"STALE_EPOCH",message:"Renderer epoch is no longer current"}}).catch(log);return;}
    if(requests.has(request.requestId))return;
    if(requests.size>=64){void connection.reply({requestId:request.requestId,bridgeEpoch:request.bridgeEpoch,clientSessionId:request.clientSessionId,type:"failure",error:{code:"LIMIT_EXCEEDED",message:"Renderer request queue is full"}}).catch(log);return;}
    const controller=new AbortController();
    const timer=setTimeout(()=>{controller.abort();void api.sessionEnded(request.clientSessionId).catch(log);},Math.max(0,request.deadline-Date.now()));
    requests.set(request.requestId,{controller,request,timer});clients.set(request.clientSessionId,request.clientInfo);updateClients();
    void (async()=>{
      try{
        const result=await api.executeTool({clientSessionId:request.clientSessionId,clientInfo:request.clientInfo,bridgeEpoch,deadline:request.deadline,signal:createAgentSignal(controller),name:request.name,arguments:request.arguments});
        if(disposed||controller.signal.aborted)return;
        await connection.reply({requestId:request.requestId,bridgeEpoch,clientSessionId:request.clientSessionId,type:"result",result});
      }catch(error){
        if(!disposed&&!controller.signal.aborted)await connection.reply({requestId:request.requestId,bridgeEpoch,clientSessionId:request.clientSessionId,type:"failure",error:{code:"INTERNAL_ERROR",message:"Editor could not complete this request"}}).catch(log);
        log(error);
      }finally{clearTimeout(timer);if(requests.get(request.requestId)?.controller===controller)requests.delete(request.requestId);}
    })();
  });
  const offControl=connection.onControl(control=>{
    if(disposed||control.bridgeEpoch!==bridgeEpoch)return;
    if(control.type==="sessionStarted"){clients.set(control.clientSessionId,control.clientInfo);updateClients();}
    else if(control.type==="statusRequest")void publish(control.requestId);
    else if(control.type==="cancel"){
      const entry=requests.get(control.requestId);if(entry?.request.clientSessionId===control.clientSessionId)entry.controller.abort();
    }else if(control.type==="sessionEnded"){
      clients.delete(control.clientSessionId);for(const entry of requests.values())if(entry.request.clientSessionId===control.clientSessionId)entry.controller.abort();
      void api.sessionEnded(control.clientSessionId).then(updateClients).catch(log);
    }
  });
  let previousPhase=api.getState().phase;
  const offState=api.subscribe(state=>{
    if(state.phase!==previousPhase && (state.phase==="stopped" || state.phase==="cancelling")){
      const owner=state.transaction?.owner.clientSessionId;
      for(const [id,entry] of requests)if(entry.request.clientSessionId===owner && entry.request.name!=="cancel_edit"){
        entry.controller.abort();clearTimeout(entry.timer);requests.delete(id);
        void connection.reply({requestId:entry.request.requestId,bridgeEpoch,clientSessionId:entry.request.clientSessionId,type:"failure",error:{code:"CANCELLED",message:"The user stopped or discarded this edit"}}).catch(log);
      }
    }
    previousPhase=state.phase;updateClients();void publish();
  });
  let offUi=()=>{};
  const offFlush=registerAgentWorldFlush(()=>live?.tags.flush()??Promise.resolve());
  const offCancellation=registerPendingCancellation(()=>api.userAction("discard"));
  const offUnsaved=registerUnsavedGuard({dirty:()=>editGate.blocked,settle:async()=>{await cancelPendingEdit();return true;}});
  const offStatus=connection.subscribeStatus(status=>{if(["disabled","failed","portInUse"].includes(status.state))void cancelPendingEdit().catch(log);});
  const offFile=getPlatform().onFileChanged(change=>{if(change.path==="ai-tags.json")void live?.tags.externalChange().catch(log);});
  let observedWorld=getLevelWorkspace(),observedFolder=getProjectFolder();
  const offWorld=useEditorStore.subscribe(()=>{
    const world=getLevelWorkspace(),folder=getProjectFolder();
    if(world!==observedWorld){observedWorld=world;observedFolder=folder;void live?.tags.reload().catch(log);}
    else if(folder!==observedFolder){observedFolder=folder;void live?.tags.folderChanged().catch(log);}
  });
  if(live)void live.tags.reload().catch(log);
  const runtime:AgentRuntime={host,api,connection,bridgeEpoch,async dispose(){
    if(disposed)return;
    for(const entry of requests.values()){entry.controller.abort();clearTimeout(entry.timer);}
    await api.userAction("discard");
    await live?.tags.flush();
    disposed=true;requests.clear();offFlush();offRequest();offControl();offState();offUi();offCancellation();offUnsaved();offStatus();offFile();offWorld();live?.tags.dispose();
    if(installed===runtime)installed=null;
  }};
  installed=runtime;
  offUi=bindAgentUiState(api,connection);
  try{await connection.ready(bridgeEpoch);await publish();}catch(error){await runtime.dispose();throw error;}
  return runtime;
}
