import { useSyncExternalStore } from "react";
import { AgentError, AgentErrorCode, type TagRecord, type TagTarget, type TagWrite, type ToolArguments, type ToolData, type ToolName } from "@smap/agent";
import { useAgentUiState } from "./agentUiState";
import { getAgentRuntime, createAgentSignal } from "./runtime";

async function execute<N extends ToolName>(name: N, args: ToolArguments[N]): Promise<ToolData[N]> {
  const runtime = getAgentRuntime();
  if (!runtime) throw new Error("Agent runtime unavailable");
  const result = await runtime.api.executeTool({ name, arguments: args, clientSessionId: "editor-tags", clientInfo: { name: "Harita", version: "2.0" }, bridgeEpoch: runtime.bridgeEpoch, deadline: Date.now() + 30000, signal: createAgentSignal(new AbortController()) });
  if (!result.structuredContent.ok) throw new AgentError(result.structuredContent.code, result.structuredContent.message);
  return result.structuredContent.data as ToolData[N];
}
const context = () => {
  const worldSessionId = getAgentRuntime()?.api.getState().worldSessionId;
  if (!worldSessionId) throw new AgentError(AgentErrorCode.NO_WORLD, "No open world");
  return { worldSessionId };
};
/** Inspector uses the live tag sidecar; writes share MCP validation and fingerprint checks. */
export const agentTags = {
  async read(target: TagTarget): Promise<TagRecord> {
    const host = getAgentRuntime()?.host;
    if (!host) throw new Error("Agent runtime unavailable");
    const state = host.tags.availability();
    if (state.state !== "ready") throw new Error("Tags unavailable");
    const stored = target.kind === "tile" ? state.sidecar.tiles.find(r => r.tilesetId === target.tilesetId && r.tileId === target.tileId) : state.sidecar.stamps.find(r => r.stampId === target.stampId);
    const signal = createAgentSignal(new AbortController());
    const currentFingerprint = await (target.kind === "tile" ? host.images.tileFingerprint(target.tilesetId, target.tileId, signal) : host.images.stampFingerprint(target.stampId, signal));
    return { target, tags: stored?.tags ?? [], note: stored?.note ?? "", currentFingerprint, ...(stored ? { storedFingerprint: stored.fingerprint } : {}), status: !stored ? "missing" : stored.fingerprint === currentFingerprint ? "current" : "stale" };
  },
  async write(entry: TagWrite): Promise<void> {
    await execute("set_tags", { context: { ...context(), idempotencyKey: crypto.randomUUID() }, entries: [entry] });
  },
  list(query: { kind: "tiles" | "stamps"; status: "all" | "missing" | "stale"; cursor?: string }) {
    return execute("get_tags", { context: context(), ...query });
  },
};
export type AiTagsAccess = typeof agentTags;
export function useAgentTags() {
  const connection = useAgentUiState(s => s.connection);
  const tags = connection ? getAgentRuntime()?.host.tags : undefined;
  const revision = useSyncExternalStore(cb => tags?.subscribe(cb) ?? (() => {}), () => tags?.availability() ?? null);
  return { tags: tags ? agentTags : null, revision };
}
