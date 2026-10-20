import { describe, expect, it } from "vitest";
import fixtures from "../../agent/test/fixtures/transport-examples.json";
import { createAgentConnection, type AgentTransport } from "./agentBridge";

function harness() {
  const handlers = new Map<string, (value: unknown) => void>();
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const transport: AgentTransport = {
    async listen(event, handler) { handlers.set(event, handler); return () => { handlers.delete(event); }; },
    async invoke<T>(command: string, args: Record<string, unknown> = {}) {
      calls.push({ command, args });
      if (command === "ai_get_status") return { snapshot: { revision: 0, settings: { enabled: false, port: 48765 } }, status: { state: "disabled", port: 48765, clients: [] } } as T;
      return undefined as T;
    },
    async copy(text) { calls.push({ command: "clipboard", args: { text } }); },
  };
  return { connection: createAgentConnection(transport), handlers, calls };
}

describe("desktop agent connection", () => {
  it("installs all listeners before announcing readiness and delivers only current valid envelopes", async () => {
    const { connection, handlers, calls } = harness();
    const requests: unknown[] = [];
    const controls: unknown[] = [];
    connection.onRequest((request) => requests.push(request));
    connection.onControl((control) => controls.push(control));
    await connection.ready("renderer-1");
    expect([...handlers.keys()]).toEqual(["smap://agent-request", "smap://agent-control", "smap://agent-status"]);
    expect(calls.at(-1)).toEqual({ command: "agent_ready", args: { epoch: "renderer-1" } });
    for (const value of fixtures.valid) {
      if (value.type === "tools/call") handlers.get("smap://agent-request")?.(value);
      if (["sessionStarted", "sessionEnded", "statusRequest", "cancel"].includes(value.type)) handlers.get("smap://agent-control")?.(value);
    }
    expect(requests).toHaveLength(1);
    expect(controls).toHaveLength(4);
    for (const value of fixtures.invalid) {
      handlers.get("smap://agent-request")?.(value);
      handlers.get("smap://agent-control")?.(value);
    }
    handlers.get("smap://agent-request")?.({ ...fixtures.valid[0], bridgeEpoch: "old" });
    expect(requests).toHaveLength(1);
    expect(controls).toHaveLength(4);
  });

  it("unsubscribes handlers, checks reply epochs and preserves image envelopes", async () => {
    const { connection, handlers, calls } = harness();
    await connection.ready("renderer-1");
    const requests: unknown[] = [];
    const off = connection.onRequest((r) => requests.push(r));
    off();
    handlers.get("smap://agent-request")?.(fixtures.valid[0]);
    expect(requests).toEqual([]);
    const reply = fixtures.valid.find((v) => v.type === "result" && "result" in v && v.result.content.length === 2)!;
    await connection.reply(reply as Parameters<typeof connection.reply>[0]);
    expect(calls.at(-1)).toEqual({ command: "agent_reply", args: { reply } });
    await connection.ready("renderer-2");
    await expect(connection.reply(reply as Parameters<typeof connection.reply>[0])).rejects.toThrow();
  });

  it("publishes status updates and sends settings revisions to native CAS", async () => {
    const { connection, handlers, calls } = harness();
    await connection.ready("epoch");
    const statuses: unknown[] = [];
    connection.subscribeStatus((s) => statuses.push(s));
    const status = { state: "connected", port: 48765, clients: [{ name: "test", version: "1" }] };
    handlers.get("smap://agent-status")?.(status);
    expect(connection.status).toEqual(status);
    expect(statuses.at(-1)).toEqual(status);
    await connection.setSettings({ enabled: true, port: 48765 }, 7);
    expect(calls.at(-1)).toEqual({ command: "ai_set_config", args: { settings: { enabled: true, port: 48765 }, expectedRevision: 7 } });
  });
});
