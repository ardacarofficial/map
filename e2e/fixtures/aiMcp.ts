/** Real HTTP MCP fixture until lane 4's SDK helper is merged; no in-page agent writes. */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { confirmTilesetCard, dropFile, expect, sampleBytes } from "../support/fixtures";

export const aiRuntimeAvailable = existsSync(fileURLToPath(new URL("../../packages/editor/src/agent/agentUiState.ts", import.meta.url)));
export interface AiToolReply { worldSessionId: string; revision: number; ok: boolean; data: Record<string, unknown> }
export class AiMcpClient {
  private session = "";
  private sequence = 0;
  private constructor(private request: APIRequestContext, private endpoint: string, private token: string) {}
  static async connect(page: Page, request: APIRequestContext): Promise<AiMcpClient> {
    const pair = randomUUID();
    await page.goto(`/?agent=${pair}`);
    await dropFile(page, "body", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
    await confirmTilesetCard(page);
    await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
    const tokenPaths = ["../../packages/editor/node_modules/.harita-mcp/token", "../../node_modules/.harita-mcp/token"].map(path => fileURLToPath(new URL(path, import.meta.url)));
    const tokenPath = tokenPaths.find(path => existsSync(path));
    const token = process.env.HARITA_MCP_TOKEN ?? (tokenPath ? readFileSync(tokenPath, "utf8").trim() : "");
    if (!token) throw Error("Dev MCP token unavailable; start the merged dev host with HARITA_DEV_MCP=1");
    const client = new AiMcpClient(request, `http://127.0.0.1:${process.env.E2E_MCP_PORT ?? "48781"}/mcp?pair=${pair}`, token);
    await client.rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "AI UX e2e", version: "1" } });
    await client.rpc("notifications/initialized");
    return client;
  }
  async call(name: string, args: object = {}): Promise<AiToolReply> {
    const result = await this.rpc("tools/call", { name, arguments: args }) as { structuredContent?: AiToolReply; content?: { type: string; text?: string }[] };
    const envelope = result.structuredContent ?? JSON.parse(result.content?.find(block => block.type === "text")?.text ?? "null") as AiToolReply;
    if (!envelope?.ok) throw Error(`MCP tool failed: ${name}`);
    return envelope;
  }
  async close() { await this.request.delete(this.endpoint, { headers: this.headers() }); }
  private headers() {
    return { Authorization: `Bearer ${this.token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25", ...(this.session ? { "Mcp-Session-Id": this.session } : {}) };
  }
  private async rpc(method: string, params?: object): Promise<unknown> {
    const notification = method.startsWith("notifications/");
    const response = await this.request.post(this.endpoint, { headers: this.headers(), data: { jsonrpc: "2.0", ...(notification ? {} : { id: ++this.sequence }), method, ...(params ? { params } : {}) } });
    if (!response.ok()) throw Error(`MCP ${method} HTTP ${response.status()}`);
    this.session = response.headers()["mcp-session-id"] ?? this.session;
    if (notification) return null;
    const body = await response.text();
    const json = JSON.parse(body.startsWith("data:") || body.startsWith("event:") ? body.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n") : body) as { result?: unknown; error?: unknown };
    if (json.error) throw Error(`MCP ${method} failed`);
    return json.result;
  }
}
