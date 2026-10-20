import { randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures";
import { connect } from "../support/agentClient";
import type { AgentConnection } from "../../packages/agent/src/contracts";
import type { WebSocketRoute } from "@playwright/test";

test("SDK initialize, catalogue and get_session traverse the paired dev transport", async ({ page }) => {
  const pair = `protocol-${randomUUID()}`;
  const ended: string[] = [];
  await page.exposeFunction("__haritaProtocolEnded", (reason: string) => { ended.push(reason); });
  let bridge: WebSocketRoute | undefined, upstreamBridge: WebSocketRoute | undefined;
  await page.routeWebSocket(/.*/, (route) => { bridge = route; upstreamBridge = route.connectToServer(); });
  await page.goto(`/?agent=${pair}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/agent/devConnection.ts";
    const module = await import(/* @vite-ignore */ path) as { connectDevAgent(): Promise<AgentConnection | undefined> };
    const connection = await module.connectDevAgent();
    if (!connection) throw new Error("Dev connection not available");
    // Before lane 2 is merged, install a transport-only responder using the frozen port.
    // Once the live runtime has registered readiness, the same test uses its get_session.
    if (connection.status.state === "starting") {
      const unsubscribe = connection.onRequest((request) => {
        const result = { ok: false as const, code: "NO_WORLD" as never, message: "No world is open", worldSessionId: null, revision: 0, retryable: false, details: {} };
        void connection.reply({ type: "result", requestId: request.requestId, bridgeEpoch: request.bridgeEpoch, clientSessionId: request.clientSessionId, result: { isError: true, content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } });
      });
      try { await connection.ready(crypto.randomUUID()); }
      catch (error) { unsubscribe(); if (!String(error).includes("epoch changed")) throw error; }
    }
  });
  const agent = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
  try {
    expect((await agent.listTools()).tools.map((tool) => tool.name)).toContain("get_session");
    expect((await agent.listTools()).tools).toHaveLength(26);
    const result = await agent.getSession();
    expect(result.structuredContent).toHaveProperty("ok");
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    if (result.isError) expect(result.structuredContent.code).not.toBe("EDITOR_UNAVAILABLE");
    await page.evaluate(async () => {
      const path = "/src/agent/devConnection.ts";
      const module = await import(/* @vite-ignore */ path) as { connectDevAgent(): Promise<AgentConnection> };
      (await module.connectDevAgent()).onControl((control) => {
        if (control.type === "sessionEnded") void (globalThis as unknown as { __haritaProtocolEnded(reason: string): Promise<void> }).__haritaProtocolEnded(control.reason);
      });
    });
    // The live browser must signal session loss even when no server control can arrive.
    expect(bridge).toBeDefined();
    await bridge!.close({ code: 1000 });
    await upstreamBridge!.close({ code: 1000 });
    await expect.poll(() => ended).toContain("disconnect");
  } finally { await agent.close(); }
});
