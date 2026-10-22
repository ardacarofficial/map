#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";

async function upstreamRequest<T>(request: () => Promise<T>): Promise<T> {
  try { return await request(); }
  catch (error) {
    // Preserve upstream protocol diagnostics; redact network/HTTP failure details.
    if (error instanceof McpError && error.code !== ErrorCode.ConnectionClosed) throw error;
    throw new McpError(ErrorCode.ConnectionClosed, "EDITOR_UNAVAILABLE: the configured editor is no longer reachable");
  }
}

function configuration() {
  const args = process.argv.slice(2), values = new Map<string, string>();
  if (args.includes("--help")) {
    process.stderr.write("Usage: harita-mcp --url http://127.0.0.1:PORT/mcp [--token-env HARITA_MCP_TOKEN] [--token-file path]\n");
    return undefined;
  }
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!, value = args[i + 1];
    if (!["--url", "--token-env", "--token-file"].includes(flag) || !value || value.startsWith("--") || values.has(flag)) throw new Error("Invalid arguments; use --help");
    values.set(flag, value);
  }
  const raw = values.get("--url");
  if (!raw) throw new Error("--url is required");
  const url = new URL(raw);
  if (!/^http:\/\/127\.0\.0\.1(?::[0-9]+)?\/mcp(?:\?|$)/.test(raw) || url.hostname !== "127.0.0.1" || url.username || url.password || url.hash || url.pathname !== "/mcp" || [...url.searchParams.keys()].some((key) => key !== "pair")) throw new Error("MCP URL must use literal 127.0.0.1 over HTTP at /mcp");
  return { url, env: values.get("--token-env") ?? "HARITA_MCP_TOKEN", file: values.get("--token-file") };
}

async function main() {
  const config = configuration();
  if (!config) return;
  const token = (config.file ? await readFile(config.file, "utf8") : process.env[config.env])?.trim();
  if (!token || /\s/.test(token)) throw new Error("MCP bearer token is missing or invalid");
  const localFetch: typeof fetch = async (url, init) => fetch(url, { ...init, redirect: "error" });
  let upstream: Client | undefined, http: StreamableHTTPClientTransport | undefined;
  let ping: ReturnType<typeof setInterval> | undefined, connecting: Promise<void> | undefined;
  const server = new Server({ name: "harita-mcp", version: "2.0.0" }, { capabilities: { tools: { listChanged: false } } });
  const stdio = new StdioServerTransport();
  // The SDK proxy owns its initialize response, so copy the upstream guide onto
  // that one response after the authenticated upstream handshake has completed.
  let initializeId: string | number | undefined;
  const send = stdio.send.bind(stdio);
  stdio.send = (message) => {
    if ("id" in message && message.id === initializeId && "result" in message) {
      initializeId = undefined;
      const instructions = upstream?.getInstructions();
      if (instructions) return send({ ...message, result: { ...message.result, instructions } });
    }
    return send(message);
  };
  let closing: Promise<void> | undefined;
  const shutdown = () => closing ??= (async () => {
    if (ping) clearInterval(ping);
    try { await connecting; } catch { /* Redacted startup diagnostic is reported below. */ }
    try { await http?.terminateSession(); } catch { process.stderr.write("EDITOR_UNAVAILABLE: could not end upstream session\n"); }
    await upstream?.close();
    await server.close();
  })();
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
  process.stdin.once("end", () => { void shutdown(); });
  server.setRequestHandler(ListToolsRequestSchema, (request) => {
    if (!upstream) throw new Error("EDITOR_UNAVAILABLE");
    return upstreamRequest(() => upstream!.listTools(request.params));
  });
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    if (!upstream) throw new Error("EDITOR_UNAVAILABLE");
    return upstreamRequest(() => upstream!.callTool(request.params, undefined, { signal: extra.signal }));
  });
  // Probe on launch without creating a session under a false proxy identity.
  try {
    const probe = await localFetch(config.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    await probe.body?.cancel();
    // A general SDK upstream may require a session for GET (400), or only route POST
    // (404). Its initialize response remains authoritative; our own hosts return 405.
    if (probe.status === 401 || probe.status === 403 || probe.status >= 500) throw new Error("Invalid upstream endpoint");
  } catch { throw new Error("EDITOR_UNAVAILABLE: cannot reach the configured editor MCP endpoint"); }
  if (closing) { await closing; return; }
  await server.connect(stdio);
  const receive = stdio.onmessage!;
  stdio.onmessage = (message) => {
    if ("method" in message && message.method === "initialize" && "id" in message) {
      if (connecting || closing) return;
      initializeId = message.id;
      connecting = (async () => {
        const params = message.params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined;
        const info = params?.clientInfo;
        if (typeof info?.name !== "string" || typeof info.version !== "string") { receive(message); return; }
        upstream = new Client({ name: info.name, version: info.version });
        http = new StreamableHTTPClientTransport(config.url, { requestInit: { headers: { Authorization: `Bearer ${token}` } }, fetch: localFetch });
        // SDK's required sessionId getter returns undefined before initialization;
        // the shared Transport declares it optional (exactOptionalPropertyTypes mismatch).
        await upstream.connect(http as Transport, { timeout: 5000 });
        ping = setInterval(() => { void upstream!.ping().catch(() => { process.stderr.write("EDITOR_UNAVAILABLE: upstream ping failed\n"); process.exitCode = 1; void shutdown(); }); }, 30000);
        ping.unref();
        receive(message);
      })();
      void connecting.catch(() => { process.stderr.write("EDITOR_UNAVAILABLE: upstream initialization failed\n"); process.exitCode = 1; void shutdown(); });
    } else receive(message);
  };
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "MCP proxy failed"}\n`);
  process.exitCode = 1;
});
