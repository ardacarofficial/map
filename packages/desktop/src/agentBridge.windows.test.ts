import { expect, it, vi } from "vitest";
import type { EventTarget } from "@tauri-apps/api/event";

const native = vi.hoisted(() => ({
  label: "main",
  listeners: [] as { event: string; target: EventTarget; receive(event: { payload: unknown }): void }[],
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: native.label }) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, receive: (event: { payload: unknown }) => void, options: { target: EventTarget }) => {
    native.listeners.push({ event, target: options.target, receive });
    return () => undefined;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => command === "ai_get_status"
    ? { snapshot: { revision: 0, settings: { enabled: false, port: 48765 } }, status: { state: "disabled", port: 48765, clients: [] } }
    : undefined,
}));

import { createAgentConnection } from "./agentBridge";

it("binds every native AI event to its caller window, including status without an epoch", async () => {
  const first = createAgentConnection();
  await first.ready("shared-epoch");
  native.label = "world-1";
  const second = createAgentConnection();
  await second.ready("shared-epoch");
  const requestsA: unknown[] = [];
  const requestsB: unknown[] = [];
  first.onRequest(value => requestsA.push(value));
  second.onRequest(value => requestsB.push(value));
  expect(native.listeners.map(listener => listener.target)).toEqual([
    ...Array.from({ length: 3 }, () => ({ kind: "WebviewWindow", label: "main" })),
    ...Array.from({ length: 3 }, () => ({ kind: "WebviewWindow", label: "world-1" })),
  ]);
  const emitTo = (label: string, event: string, payload: unknown) => {
    for (const listener of native.listeners) {
      if (listener.event === event && "label" in listener.target && listener.target.label === label) listener.receive({ payload });
    }
  };
  emitTo("world-1", "smap://agent-request", {
    type: "tools/call", requestId: "request-b", bridgeEpoch: "shared-epoch", clientSessionId: "client-b",
    name: "get_session", arguments: {}, clientInfo: { name: "client", version: "1" }, deadline: 100,
  });
  emitTo("world-1", "smap://agent-status", { state: "connected", port: 48766, clients: [{ name: "client-b", version: "1" }] });
  expect(requestsA).toEqual([]);
  expect(requestsB).toHaveLength(1);
  expect(first.status).toEqual({ state: "disabled", port: 48765, clients: [] });
  expect(second.status.port).toBe(48766);
  expect(second.status.clients[0]?.name).toBe("client-b");
});
