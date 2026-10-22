/** Native transport only. The editor installs and owns the Agent API handlers. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AGENT_LIMITS } from "../../agent/src/contracts";
import type {
  AgentConnection, AgentConnectionStatus, AgentSettingsSnapshot, BridgeControl, BridgeReply, BridgeRequest,
} from "../../agent/src/contracts";

export interface AgentTransport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen(event: string, handler: (value: unknown) => void): Promise<() => void>;
  copy(text: string): Promise<void>;
}
const nativeTransport: AgentTransport = {
  invoke,
  listen: async (event, handler) => listen(event, ({ payload }) => handler(payload), {
    // EventTarget::Any (the default) also hears emit_to for other windows.
    target: { kind: "WebviewWindow", label: getCurrentWebviewWindow().label },
  }),
  copy: (text) => navigator.clipboard.writeText(text),
};
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function id(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128; }
function client(value: unknown): boolean { return object(value) && typeof value.name === "string" && typeof value.version === "string"; }
function request(value: unknown): value is BridgeRequest {
  return object(value) && value.type === "tools/call" && id(value.requestId) && id(value.bridgeEpoch) && id(value.clientSessionId)
    && id(value.name) && client(value.clientInfo) && Number.isSafeInteger(value.deadline) && (value.deadline as number) >= 0 && object(value.arguments);
}
function control(value: unknown): value is BridgeControl {
  if (!object(value) || !id(value.bridgeEpoch)) return false;
  if (value.type === "statusRequest") return id(value.requestId);
  if (!id(value.clientSessionId)) return false;
  switch (value.type) {
    case "sessionStarted": return client(value.clientInfo);
    case "sessionEnded": return ["delete", "expired", "disabled", "tokenRegenerated", "disconnect", "shutdown"].includes(String(value.reason));
    case "cancel": return id(value.requestId) && ["timeout", "clientCancelled"].includes(String(value.reason));
    default: return false;
  }
}
function connectionStatus(value: unknown): value is AgentConnectionStatus {
  return object(value) && ["disabled", "starting", "listening", "connected", "portInUse", "failed"].includes(String(value.state))
    && Number.isInteger(value.port) && (value.port as number) >= 1024 && (value.port as number) <= 65535 && Array.isArray(value.clients) && value.clients.length <= AGENT_LIMITS.clients && value.clients.every(client);
}

export function createAgentConnection(transport: AgentTransport = nativeTransport): AgentConnection {
  let epoch: string | null = null;
  let status: AgentConnectionStatus = { state: "disabled", port: 48765, clients: [] };
  const requests = new Set<(r: BridgeRequest) => void>();
  const controls = new Set<(c: BridgeControl) => void>();
  const statuses = new Set<(s: AgentConnectionStatus) => void>();
  const updateStatus = (value: unknown) => {
    if (!connectionStatus(value)) return;
    status = value;
    for (const handler of statuses) handler(status);
  };
  // Register before ready; promises retain listener errors for the ready caller.
  const installed = Promise.all([
    transport.listen("smap://agent-request", (value) => {
      if (request(value) && value.bridgeEpoch === epoch) for (const handler of requests) handler(value);
    }),
    transport.listen("smap://agent-control", (value) => {
      if (control(value) && value.bridgeEpoch === epoch) for (const handler of controls) handler(value);
    }),
    transport.listen("smap://agent-status", updateStatus),
  ]).then(async () => {
    const initial = await transport.invoke<{ snapshot: AgentSettingsSnapshot; status: AgentConnectionStatus }>("ai_get_status");
    updateStatus(initial?.status);
  });
  void installed.catch(() => updateStatus({ state: "failed", port: status.port, clients: [] }));
  return {
    onRequest(handler) { requests.add(handler); return () => { requests.delete(handler); }; },
    onControl(handler) { controls.add(handler); return () => { controls.delete(handler); }; },
    async ready(bridgeEpoch) {
      if (!id(bridgeEpoch)) throw new Error("Invalid bridge epoch");
      await installed;
      epoch = bridgeEpoch;
      await transport.invoke("agent_ready", { epoch: bridgeEpoch });
    },
    async reply(reply: BridgeReply) {
      if (reply.bridgeEpoch !== epoch || !id(reply.requestId) || !id(reply.clientSessionId)) throw new Error("Stale bridge reply");
      if (new TextEncoder().encode(JSON.stringify(reply)).byteLength > 8 * 1024 * 1024) throw new Error("Bridge reply exceeds limit");
      await transport.invoke("agent_reply", { reply });
    },
    async publishStatus(published) {
      if (published.bridgeEpoch !== epoch) throw new Error("Stale bridge status");
      await transport.invoke("agent_publish_status", { status: published });
    },
    async getSettings() {
      const result = await transport.invoke<{ snapshot: AgentSettingsSnapshot; status: AgentConnectionStatus }>("ai_get_status");
      updateStatus(result.status); return result.snapshot;
    },
    async setSettings(settings, expectedRevision) {
      const result = await transport.invoke<Awaited<ReturnType<AgentConnection["setSettings"]>>>("ai_set_config", { settings, expectedRevision });
      if (result) updateStatus(result.status); return result;
    },
    revealToken: () => transport.invoke<string>("ai_reveal_token"),
    async copyToken() { await transport.copy(await transport.invoke<string>("ai_reveal_token")); },
    regenerateToken: (expectedRevision) => transport.invoke<AgentSettingsSnapshot>("ai_regenerate_token", { expectedRevision }),
    get status() { return status; },
    subscribeStatus(handler) { statuses.add(handler); return () => { statuses.delete(handler); }; },
  };
}
