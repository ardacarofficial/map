import { afterEach, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDevMcp } from "../../editor/dev/devMcp";
import { readFileSync } from "node:fs";

const cwd = fileURLToPath(new URL("../../../", import.meta.url));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

test("stdio mirrors the HTTP catalogue and preserves structured results and image bytes", async () => {
  const host = await startDevMcp({ port: 0, token: "test-token" });
  cleanup.push(() => host.close());
  host.attach("test", "epoch", (message) => {
    if (message.type === "tools/call") host.reply("test", {
      type: "result", requestId: message.requestId, bridgeEpoch: message.bridgeEpoch,
      clientSessionId: message.clientSessionId,
      result: { content: [{ type: "text", text: '{"ok":true}' }, { type: "image", mimeType: "image/png", data: "AAECA/8=" }], structuredContent: { ok: true } },
    });
  });
  const transport = new StdioClientTransport({ cwd, command: process.execPath, args: ["packages/agent-cli/dist/main.js", "--url", `${host.url}?pair=test`], env: { HARITA_MCP_TOKEN: "test-token" }, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (data) => { stderr += String(data); });
  const client = new Client({ name: "real-stdio-client", version: "1" });
  cleanup.push(() => client.close());
  await client.connect(transport);
  expect(client.getInstructions()).toBe(readFileSync(new URL("../../agent/schema/workflow.txt",import.meta.url),"utf8").trim());
  expect((await client.listTools()).tools).toHaveLength(45);
  expect(await client.callTool({ name: "get_session", arguments: {} })).toMatchObject({ structuredContent: { ok: true }, content: [{ type: "text", text: '{"ok":true}' }, { type: "image", data: "AAECA/8=" }] });
  await client.close();
  await expect.poll(() => host.sessionCount).toBe(0);
  expect(stderr).not.toContain("test-token");
});

test("proxy mirrors an independent SDK server verbatim, preserves client identity and cancellation", async () => {
  const sdk = new Server({ name: "fake-upstream", version: "1" }, { capabilities: { tools: {} }, instructions:"An independent upstream workflow." });
  const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
  const tools = [{ name: "image", description: "An upstream-specific tool", inputSchema: { type: "object" as const, properties: {} } }, { name: "slow", inputSchema: { type: "object" as const } }];
  const result = { content: [{ type: "text" as const, text: '{"answer":42}' }, { type: "image" as const, mimeType: "image/png", data: "AAECA/8=" }], structuredContent: { answer: 42 } };
  let cancelled = false, slowStarted = false;
  sdk.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  sdk.setRequestHandler(CallToolRequestSchema, (request, extra) => request.params.name === "slow" ? new Promise((resolve) => {
    slowStarted = true;
    extra.signal.addEventListener("abort", () => { cancelled = true; resolve({ content: [] }); }, { once: true });
  }) : result);
  await sdk.connect(httpTransport as Transport);
  const http = createServer((req, res) => {
    void httpTransport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { await sdk.close(); http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); });
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`;
  const transport = new StdioClientTransport({ cwd, command: process.execPath, args: ["packages/agent-cli/dist/main.js", "--url", url], env: { HARITA_MCP_TOKEN: "private" }, stderr: "pipe" });
  const client = new Client({ name: "original-client", version: "7" });
  cleanup.push(() => client.close());
  await client.connect(transport);
  expect(client.getInstructions()).toBe("An independent upstream workflow.");
  expect((await client.listTools()).tools).toEqual(tools);
  expect(await client.callTool({ name: "image", arguments: {} })).toEqual(result);
  expect(sdk.getClientVersion()).toEqual({ name: "original-client", version: "7" });
  const abort = new AbortController();
  const call = client.callTool({ name: "slow", arguments: {} }, undefined, { signal: abort.signal });
  // Wait until the upstream request is registered, then cancel across both transports.
  await expect.poll(() => slowStarted).toBe(true);
  abort.abort();
  await expect(call).rejects.toThrow();
  await expect.poll(() => cancelled).toBe(true);
});

test("stdin EOF and SIGTERM delete upstream sessions", async () => {
  const host = await startDevMcp({ port: 0, token: "test-token" });
  cleanup.push(() => host.close());
  for (const kind of ["eof", "sigterm"]) {
    const child = spawn(process.execPath, ["packages/agent-cli/dist/main.js", "--url", host.url], { cwd, env: { ...process.env, HARITA_MCP_TOKEN: "test-token" }, stdio: "pipe" });
    cleanup.push(async () => { if (child.exitCode === null) child.kill(); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "shutdown", version: "1" } } }) + "\n");
    await expect.poll(() => host.sessionCount).toBe(1);
    const exited = once(child, "exit");
    if (kind === "eof") child.stdin.end(); else child.kill("SIGTERM");
    await exited;
    expect(host.sessionCount).toBe(0);
  }
});

test("a lost editor reports EDITOR_UNAVAILABLE to an already connected stdio client", async () => {
  const host = await startDevMcp({ port: 0, token: "test-token" });
  cleanup.push(() => host.close());
  const transport = new StdioClientTransport({ cwd, command: process.execPath, args: ["packages/agent-cli/dist/main.js", "--url", host.url], env: { HARITA_MCP_TOKEN: "test-token" }, stderr: "pipe" });
  const client = new Client({ name: "disconnect-test", version: "1" });
  cleanup.push(() => client.close());
  await client.connect(transport);
  await host.close();
  await expect(client.callTool({ name: "get_session", arguments: {} })).rejects.toThrow("EDITOR_UNAVAILABLE");
});

test.each([
  ["http://127.0.0.1:1/mcp", "test-token", "EDITOR_UNAVAILABLE"],
  ["http://example.com/mcp", "test-token", "literal 127.0.0.1"],
  ["http://127.0.0.1:1/mcp", "", "token"],
])("startup failure is clear and never contaminates stdout (%s)", async (url, token, diagnostic) => {
  const child = spawn(process.execPath, ["packages/agent-cli/dist/main.js", "--url", url], { cwd, env: { ...process.env, HARITA_MCP_TOKEN: token } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (data) => { stdout += String(data); });
  child.stderr.on("data", (data) => { stderr += String(data); });
  child.stdin.end();
  const [code] = await once(child, "exit");
  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toContain(diagnostic);
});

test("redirects never carry credentials to a second endpoint", async () => {
  let leaked = false;
  const upstream = createServer((req, res) => {
    if (req.url === "/mcp") { res.writeHead(307, { Location: "/credentials-target" }); res.end(); }
    else { leaked = true; res.end(); }
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => { upstream.closeAllConnections(); upstream.close(() => resolve()); }));
  const child = spawn(process.execPath, ["packages/agent-cli/dist/main.js", "--url", `http://127.0.0.1:${(upstream.address() as { port: number }).port}/mcp`], { cwd, env: { ...process.env, HARITA_MCP_TOKEN: "private" } });
  const [code] = await once(child, "exit");
  expect(code).toBe(1);
  expect(leaked).toBe(false);
});

test.each(["env", "file"])("credentials can come from a custom %s source", async (source) => {
  const host = await startDevMcp({ port: 0, token: "selected-token" });
  cleanup.push(() => host.close());
  const directory = await mkdtemp(join(tmpdir(), "harita-proxy-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const tokenPath = join(directory, "token");
  await writeFile(tokenPath, "selected-token\n");
  const args = ["packages/agent-cli/dist/main.js", "--url", host.url, ...(source === "env" ? ["--token-env", "CUSTOM_MCP_TOKEN"] : ["--token-file", tokenPath])];
  const transport = new StdioClientTransport({ cwd, command: process.execPath, args, env: { HARITA_MCP_TOKEN: "wrong", CUSTOM_MCP_TOKEN: "selected-token" }, stderr: "pipe" });
  const client = new Client({ name: "credential-test", version: "1" });
  cleanup.push(() => client.close());
  await client.connect(transport);
  expect((await client.listTools()).tools).toHaveLength(45);
});
