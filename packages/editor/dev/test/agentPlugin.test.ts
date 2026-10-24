import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import type { ViteDevServer, WebSocketClient } from "vite";
import { createServer as createViteServer } from "vite";
import { agentPlugin } from "../agentPlugin";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function setup() {
  const mcpPort = await freePort();
  vi.stubEnv("HARITA_DEV_MCP", "1"); vi.stubEnv("HARITA_DEV_MCP_PORT", String(mcpPort)); vi.stubEnv("HARITA_MCP_TOKEN", "test-secret");
  let middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  const http = createServer((req, res) => { void middleware(req, res); });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => { http.closeAllConnections(); http.close(() => resolve()); }));
  const port = (http.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  const ws = new EventEmitter();
  const vite = { config: { root: fileURLToPath(new URL("../../", import.meta.url)), server: { host: "127.0.0.1", port } }, httpServer: http, ws,
    middlewares: { use(_path: string, handler: typeof middleware) { middleware = handler; } },
  } as unknown as ViteDevServer;
  await (agentPlugin().configureServer as (server: ViteDevServer) => Promise<void>)(vite);
  const page = (pageOrigin = origin) => {
    const socket = new EventEmitter();
    const received: Record<string, unknown>[] = [];
    const client = { socket, send(_event: string, value: Record<string, unknown>) { received.push(value); } } as unknown as WebSocketClient;
    ws.emit("connection", socket, { rawHeaders: ["Origin", pageOrigin], headers: { origin: pageOrigin, host: new URL(origin).host } });
    return { received, socket, send(value: unknown) { ws.emit("harita:agent", value, client); } };
  };
  const nonce = async (pair: string, requestOrigin = origin) => fetch(`${origin}/__harita/nonce?pair=${pair}`, { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" } });
  return { origin, mcp: `http://127.0.0.1:${mcpPort}/mcp`, page, nonce };
}

test("private channel requires exact Vite Origin and a pairing-bound one-use nonce", async () => {
  const { nonce, page, origin } = await setup();
  expect((await nonce("a", `${origin}0`)).status).toBe(403);
  const { nonce: value } = await (await nonce("a")).json();
  const remote = page("http://attacker.invalid");
  remote.send({ type: "attach", pair: "a", nonce: value, epoch: "remote" });
  expect(remote.received).toEqual([]);
  const first = page();
  first.send({ type: "attach", pair: "a", nonce: value, epoch: "first" });
  expect(first.received).toContainEqual(expect.objectContaining({ type: "attached" }));
  const replay = page(); replay.send({ type: "attach", pair: "a", nonce: value, epoch: "replay" });
  expect(replay.received).toContainEqual({ type: "rejected" });
  const { nonce: second } = await (await nonce("b")).json();
  replay.send({ type: "attach", pair: "c", nonce: second, epoch: "replay" });
  expect(replay.received.filter((item) => item.type === "rejected")).toHaveLength(2);
});

test("HTTP calls reach only the authenticated target socket and closed pages cannot reply", async () => {
  const { nonce, page, mcp } = await setup();
  const a = page(), b = page();
  for (const [pair, target] of [["a", a], ["b", b]] as const) target.send({ type: "attach", pair, epoch: pair, nonce: (await (await nonce(pair)).json()).nonce });
  const headers = { Authorization: "Bearer test-secret", "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const init = await fetch(`${mcp}?pair=a`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) });
  const sessionHeaders = { ...headers, "Mcp-Session-Id": init.headers.get("Mcp-Session-Id")! };
  await fetch(mcp, { method: "POST", headers: sessionHeaders, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const call = fetch(mcp, { method: "POST", headers: sessionHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_session", arguments: {} } }) });
  await expect.poll(() => a.received.some((message) => message.type === "tools/call")).toBe(true);
  expect(b.received).toHaveLength(1); // Its attach acknowledgement is its only message.
  const request = a.received.find((message) => message.type === "tools/call")!;
  b.send({ ...request, type: "result", result: { content: [{ type: "text", text: "wrong-page" }], structuredContent: { wrong: true } } });
  a.socket.emit("close");
  expect((await (await call).json()).result.structuredContent.code).toBe("EDITOR_UNAVAILABLE");
});

test("Vite restart awaits MCP shutdown and rebinds the same port", async () => {
  const mcpPort = await freePort();
  vi.stubEnv("HARITA_DEV_MCP", "1"); vi.stubEnv("HARITA_DEV_MCP_PORT", String(mcpPort)); vi.stubEnv("HARITA_MCP_TOKEN", "restart-token");
  const vite = await createViteServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../", import.meta.url)), server: { host: "127.0.0.1", port: 0 }, plugins: [agentPlugin()] });
  cleanup.push(() => vite.close());
  await vite.listen();
  const url = `http://127.0.0.1:${mcpPort}/mcp`;
  expect((await fetch(url, { headers: { Authorization: "Bearer restart-token" } })).status).toBe(400);
  await vite.restart();
  expect((await fetch(url, { headers: { Authorization: "Bearer restart-token" } })).status).toBe(400);
});
