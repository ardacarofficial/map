import { create } from "zustand";
import type { AgentApi, AgentConnection, AgentConnectionStatus, AgentPhase, AgentState, TransactionSummary } from "@smap/agent";

export interface AgentUiState {
  state: AgentState | null;
  phase: AgentPhase;
  transaction: TransactionSummary | null;
  connection: AgentConnection | null;
  connectionStatus: AgentConnectionStatus;
  actionPending: boolean;
  stop(): Promise<void>;
  approve(): Promise<void>;
  discard(): Promise<void>;
}
let api: AgentApi | null = null;
export const getAgentApi = () => api;
export const getAgentConnection = () => useAgentUiState.getState().connection;
async function action(value: "stop" | "approve" | "discard") {
  if(!api||useAgentUiState.getState().actionPending)return;
  useAgentUiState.setState({actionPending:true});
  try{await api.userAction(value);}finally{useAgentUiState.setState({actionPending:false});}
}
export const useAgentUiState=create<AgentUiState>(()=>({
  state:null,phase:"disabled",transaction:null,connection:null,
  connectionStatus:{state:"disabled",port:48765,clients:[]},actionPending:false,
  stop:()=>action("stop"),approve:()=>action("approve"),discard:()=>action("discard"),
}));
export function bindAgentUiState(value:AgentApi,connection:AgentConnection):()=>void {
  api=value;
  const update=(state:AgentState)=>useAgentUiState.setState({state,phase:state.phase,transaction:state.transaction});
  update(value.getState());useAgentUiState.setState({connection,connectionStatus:connection.status});
  const offApi=value.subscribe(update),offStatus=connection.subscribeStatus(connectionStatus=>useAgentUiState.setState({connectionStatus}));
  return()=>{offApi();offStatus();if(api===value){api=null;useAgentUiState.setState({state:null,phase:"disabled",transaction:null,connection:null,connectionStatus:{state:"disabled",port:48765,clients:[]}});}};
}
