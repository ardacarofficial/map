/** Lane 2 binds its runtime here; UI imports no transport or agent implementation. */
import type { AgentActivityPort, AgentApi, AgentState, TagRecord, TagTarget, TagWrite, ToolData, Unsubscribe } from "@smap/agent";
import { create } from "zustand";

export interface AiTagsAccess {
  read(target: TagTarget): Promise<TagRecord>;
  write(entry: TagWrite): Promise<void>;
  list(query: { kind: "tiles" | "stamps"; status: "all" | "missing" | "stale"; cursor?: string }): Promise<ToolData["get_tags"]>;
  subscribe(listener: () => void): Unsubscribe;
}
export interface AgentUiSource {
  api: Pick<AgentApi, "getState" | "subscribe" | "userAction">;
  activity: Pick<AgentActivityPort, "entries" | "subscribe">;
  /** False while a bounded apply is finishing. Defaults to safe (approval disabled). */
  canApprove?(): boolean;
  tags?: AiTagsAccess;
}
const empty: AgentState = { phase: "disabled", instanceId: "", worldSessionId: null, revision: 0, committedRevision: 0, transaction: null };
export const useAgentUi = create(() => ({
  state: empty,
  applying: false,
  entries: [] as ReturnType<AgentActivityPort["entries"]>,
  source: null as AgentUiSource | null,
  tagsRevision: 0,
}));
/** One small integration call from agentUiState/runtime. Disposing a world removes subscriptions. */
export function installAgentUiAdapter(source: AgentUiSource): Unsubscribe {
  const refresh = () => useAgentUi.setState({ state: source.api.getState(), applying: !(source.canApprove?.() ?? false), entries: source.activity.entries().slice(-500), source });
  refresh();
  const subscriptions = [source.api.subscribe(refresh), source.activity.subscribe(refresh)];
  if (source.tags) subscriptions.push(source.tags.subscribe(() => useAgentUi.setState(s => ({ tagsRevision: s.tagsRevision + 1 }))));
  return () => {
    subscriptions.forEach(dispose => dispose());
    if (useAgentUi.getState().source === source) useAgentUi.setState({ state: empty, applying: false, entries: [], source: null });
  };
}
export async function agentUiAction(action: "stop" | "approve" | "discard"): Promise<void> {
  await useAgentUi.getState().source?.api.userAction(action);
}
