import type { AgentConnection, AgentConnectionStatus, AgentSettingsSnapshot, BridgeControl, BridgeRequest, SettingsWriteResult } from "@smap/agent";

let connection: Promise<AgentConnection | undefined> | undefined;
/** Lane 2 lazily calls this only in DEV; a page without ?agent never attaches. */
export function connectDevAgent(_pairingId?: string): Promise<AgentConnection | undefined> {
  if (!import.meta.env.DEV) return Promise.resolve(undefined);
  return connection ??= openConnection();
}
// Both names refer to the same per-page connection, for host bootstrap convenience.
export const createDevConnection = connectDevAgent;
export const createDevAgentConnection = connectDevAgent;

async function openConnection(): Promise<AgentConnection | undefined> {
  const pair = new URL(location.href).searchParams.get("agent");
  const hot = import.meta.hot;
  if (!pair || !hot) return undefined;
  const response = await fetch(`/__harita/nonce?pair=${encodeURIComponent(pair)}`, { method: "POST", headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error("Dev MCP pairing unavailable");
  const { nonce, port } = await response.json() as { nonce: string; port: number };
  let status: AgentConnectionStatus = { state: "starting", port, clients: [] };
  let epoch: string | undefined;
  const requests = new Set<(request: BridgeRequest) => void>(), controls = new Set<(control: BridgeControl) => void>();
  const subscribers = new Set<(status: AgentConnectionStatus) => void>();
  const clients = new Map<string, { name: string; version: string }>();
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  let readyResolve: (() => void) | undefined, readyReject: ((error: Error) => void) | undefined;
  let readiness: Promise<void> | undefined;
  function publish(next: AgentConnectionStatus) { status = next; for (const listener of subscribers) listener(next); }
  function disconnected() {
    if (epoch) for (const clientSessionId of clients.keys()) {
      const control: BridgeControl = { type: "sessionEnded", bridgeEpoch: epoch, clientSessionId, reason: "disconnect" };
      for (const handler of controls) handler(control);
    }
    clients.clear();
    publish({ state: "failed", port, clients: [], detail: "EDITOR_UNAVAILABLE" });
    readyReject?.(new Error("EDITOR_UNAVAILABLE"));
    for (const call of pending.values()) call.reject(new Error("EDITOR_UNAVAILABLE"));
    pending.clear();
  }
  const receive = (data: Record<string, unknown>) => {
    if (data.type === "attached") { publish(data.status as unknown as AgentConnectionStatus); readyResolve?.(); return; }
    if (data.type === "rejected") { disconnected(); return; }
    if (data.type === "rpc" && typeof data.id === "string") {
      const call = pending.get(data.id); pending.delete(data.id);
      if (data.error) call?.reject(new Error(String(data.error))); else call?.resolve(data.value);
      return;
    }
    if (data.bridgeEpoch !== epoch) return;
    if (data.type === "tools/call") for (const handler of requests) handler(data as unknown as BridgeRequest);
    else if (["sessionStarted", "sessionEnded", "cancel", "statusRequest"].includes(String(data.type))) {
      if (data.type === "sessionStarted") clients.set(String(data.clientSessionId), data.clientInfo as { name: string; version: string });
      if (data.type === "sessionEnded") clients.delete(String(data.clientSessionId));
      publish({ ...status, clients: [...clients.values()] });
      for (const handler of controls) handler(data as unknown as BridgeControl);
    }
  };
  hot.on("harita:agent", receive);
  hot.on("vite:ws:disconnect", disconnected);
  hot.dispose(() => { hot.off("harita:agent", receive); hot.off("vite:ws:disconnect", disconnected); disconnected(); });
  function rpc<T>(method: string, fields: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Dev MCP settings timeout")); }, 10000);
      pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value as T); }, reject(error) { clearTimeout(timer); reject(error); } });
      hot!.send("harita:agent", { type: "rpc", id, method, ...fields });
    });
  }
  return {
    onRequest(handler) { requests.add(handler); return () => { requests.delete(handler); }; },
    async reply(reply) { hot.send("harita:agent", reply); },
    onControl(handler) { controls.add(handler); return () => { controls.delete(handler); }; },
    async publishStatus(published) { hot.send("harita:agent", { type: "status", ...published }); },
    ready(bridgeEpoch) {
      if (epoch && epoch !== bridgeEpoch) return Promise.reject(new Error("Dev MCP epoch changed"));
      return readiness ??= new Promise<void>((resolve, reject) => {
        epoch = bridgeEpoch;
        const timer = setTimeout(() => { reject(new Error("Dev MCP pairing timeout")); }, 10000);
        readyResolve = () => { clearTimeout(timer); resolve(); };
        readyReject = (error) => { clearTimeout(timer); reject(error); };
        hot.send("harita:agent", { type: "attach", pair, nonce, epoch });
      });
    },
    getSettings: () => rpc<AgentSettingsSnapshot>("getSettings"),
    setSettings: (settings, expectedRevision) => rpc<SettingsWriteResult>("setSettings", { settings, revision: expectedRevision }),
    revealToken: () => rpc<string>("revealToken"),
    async copyToken() { await navigator.clipboard.writeText(await rpc<string>("revealToken")); },
    regenerateToken: (expectedRevision) => rpc<AgentSettingsSnapshot>("regenerateToken", { revision: expectedRevision }),
    get status() { return status; },
    subscribeStatus(listener) { subscribers.add(listener); return () => { subscribers.delete(listener); }; },
    async readLocalImage(path) {
      const base64 = await rpc<string>("readReferenceImage", { path });
      return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    },
  };
}
