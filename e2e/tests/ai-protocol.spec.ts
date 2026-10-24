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
  const agent = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
  try {
    const tools = (await agent.listTools()).tools;
    expect(tools).toHaveLength(50);
    expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      "get_session", "get_editor_state", "configure_editor", "configure_layout",
      "configure_application", "list_editor_commands", "run_editor_command",
      "get_export_settings", "configure_export", "get_world_settings",
      "configure_world", "edit_map", "edit_stamp", "join_edit",
    ]));
    const resources = (await agent.client.listResources()).resources;
    expect(resources).toHaveLength(9);
    expect(resources.map(resource => resource.uri)).toContain("harita://guide/collaboration");
    const overview = await agent.client.readResource({ uri: "harita://guide/overview" });
    expect(overview.contents[0]).toMatchObject({ uri: "harita://guide/overview", mimeType: "text/markdown" });
    expect(overview.contents[0]).toHaveProperty("text", expect.stringContaining("get_editor_context"));
    const prompt = await agent.client.getPrompt({ name: "harita-map-task", arguments: { task: "Build an editable village", topic: "collaboration" } });
    expect(prompt.messages[0]?.content).toMatchObject({ type: "text", text: expect.stringContaining("harita://guide/collaboration") });
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
