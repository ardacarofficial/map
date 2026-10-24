#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema, ErrorCode, GetPromptRequestSchema, ListPromptsRequestSchema,
  ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema,
  McpError, ReadResourceRequestSchema, type CallToolResult, type Tool,
} from "@modelcontextprotocol/sdk/types.js";

/** Why the editor cannot be used; each has one sentence the agent can act on. */
type Unavailable = "unreachable" | "unauthorized";
const NEXT_ACTION: Record<Unavailable, string> = {
  unreachable: "Ask the user to open Harita (desktop app, or the dev server page) with Settings > AI enabled, then retry the same call.",
  unauthorized: "Ask the user to copy fresh connection settings from Harita: Settings > AI (the token was regenerated), then restart this MCP server.",
};
class EditorUnavailable extends Error {
  constructor(readonly reason: Unavailable) { super(`EDITOR_UNAVAILABLE: ${reason === "unauthorized" ? "Harita rejected the access token." : "the Harita editor is not reachable."} ${NEXT_ACTION[reason]}`); }
}
/** The request never reached a live session, so repeating it once is safe. */
const sessionLost = (error: unknown) => error instanceof StreamableHTTPError && (error.code === 404 || error.code === 401);
const unauthorized = (error: unknown) => error instanceof StreamableHTTPError && error.code === 401;

function configuration() {
  const args = process.argv.slice(2), values = new Map<string, string>();
  if (args.includes("--help")) {
    process.stderr.write("Usage: harita-mcp --url http://127.0.0.1:PORT/mcp [--token-env HARITA_MCP_TOKEN] [--token-file path]\n"
      + "Starts even when the editor is closed and connects on the first request.\n");
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

/** Used only while the editor is unreachable, so the client still learns the tools. */
function bundled<T>(path: string, parse: (text: string) => T): T | undefined {
  try { return parse(readFileSync(new URL(path, import.meta.url), "utf8")); } catch { return undefined; }
}

async function main() {
  const config = configuration();
  if (!config) return;
  // The token file is re-read on reconnect, so a regenerated token can be picked up.
  const readToken = async () => {
    const token = (config.file ? await readFile(config.file, "utf8") : process.env[config.env])?.trim();
    if (!token || /\s/.test(token)) throw new Error("MCP bearer token is missing or invalid");
    return token;
  };
  await readToken();
  const localFetch: typeof fetch = async (url, init) => fetch(url, { ...init, redirect: "error" });
  let upstream: Client | undefined, http: StreamableHTTPClientTransport | undefined;
  let clientInfo: { name: string; version: string } | undefined;
  let connecting: Promise<Client> | undefined, ping: ReturnType<typeof setInterval> | undefined;
  let lastWarning: string | undefined;
  const warn = (text: string) => { if (text !== lastWarning) { lastWarning = text; process.stderr.write(`harita-mcp: ${text}\n`); } };
  const server = new Server({ name: "harita-mcp", version: "2.0.0" }, { capabilities: {
    tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false },
  } });
  const stdio = new StdioServerTransport();

  async function disconnect() {
    const client = upstream;
    upstream = undefined; http = undefined;
    if (ping) { clearInterval(ping); ping = undefined; }
    try { await client?.close(); } catch { /* Already gone. */ }
  }
  async function connect(): Promise<Client> {
    if (!clientInfo) throw new EditorUnavailable("unreachable");
    let token: string;
    try { token = await readToken(); } catch { throw new EditorUnavailable("unauthorized"); }
    const client = new Client(clientInfo);
    const transport = new StreamableHTTPClientTransport(config!.url, { requestInit: { headers: { Authorization: `Bearer ${token}` } }, fetch: localFetch });
    try {
      // SDK's required sessionId getter returns undefined before initialization;
      // the shared Transport declares it optional (exactOptionalPropertyTypes mismatch).
      await client.connect(transport as Transport, { timeout: 5000 });
    } catch (error) {
      try { await client.close(); } catch { /* Nothing to close. */ }
      const cause: Unavailable = unauthorized(error) ? "unauthorized" : "unreachable";
      warn(cause === "unauthorized"
        ? "Harita rejected the token; copy fresh connection settings from Settings > AI."
        : `editor not reachable at ${config!.url.origin}${config!.url.pathname}; open Harita and enable Settings > AI. Retrying on the next request.`);
      throw new EditorUnavailable(cause);
    }
    upstream = client; http = transport; lastWarning = undefined;
    // A failed ping drops the session; the next request reconnects instead of exiting.
    ping = setInterval(() => { void client.ping().catch(() => { if (upstream === client) { warn("lost the editor connection; reconnecting on the next request."); void disconnect(); } }); }, 30000);
    ping.unref();
    return client;
  }
  function ensure(): Promise<Client> {
    if (upstream) return Promise.resolve(upstream);
    return connecting ??= connect().finally(() => { connecting = undefined; });
  }
  async function withUpstream<T>(request: (client: Client) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const client = await ensure();
      try { return await request(client); }
      catch (error) {
        if (sessionLost(error) && attempt === 0) {
          // Expired session (404) or rotated credentials (401): re-initialize once.
          if (upstream === client) await disconnect();
          continue;
        }
        // Preserve upstream protocol diagnostics; redact network/HTTP failure details.
        if (error instanceof McpError && error.code !== ErrorCode.ConnectionClosed) throw error;
        if (upstream === client) await disconnect();
        throw new EditorUnavailable(unauthorized(error) ? "unauthorized" : "unreachable");
      }
    }
  }
  const asProtocolError = (error: unknown) => error instanceof EditorUnavailable ? new McpError(ErrorCode.ConnectionClosed, error.message) : error;
  async function forward<T>(request: (client: Client) => Promise<T>, offline?: () => NoInfer<T>): Promise<T> {
    try { return await withUpstream(request); }
    catch (error) {
      if (error instanceof EditorUnavailable && offline) return offline();
      throw asProtocolError(error);
    }
  }

  // The SDK proxy owns its initialize response, so copy the upstream guide onto
  // that one response after the authenticated upstream handshake has completed.
  let initializeId: string | number | undefined;
  const send = stdio.send.bind(stdio);
  stdio.send = (message) => {
    if ("id" in message && message.id === initializeId && "result" in message) {
      initializeId = undefined;
      if (!upstream) {
        // Editor closed at launch: describe Harita's own surface and connect lazily.
        const workflow = bundled("../../agent/schema/workflow.txt", (text) => text.trim());
        const note = "The Harita editor is not reachable yet. Tools connect on first use; if a call reports EDITOR_UNAVAILABLE, ask the user to open Harita with Settings > AI enabled.";
        return send({ ...message, result: { ...message.result, instructions: workflow ? `${workflow}\n\n${note}` : note } });
      }
      const instructions = upstream.getInstructions();
      const available = upstream.getServerCapabilities();
      // Advertise only methods this proxy implements and the upstream offers.
      // The JSON transport does not forward subscriptions or list notifications.
      const capabilities = {
        ...(available?.tools ? { tools: { listChanged: false } } : {}),
        ...(available?.resources ? { resources: { subscribe: false, listChanged: false } } : {}),
        ...(available?.prompts ? { prompts: { listChanged: false } } : {}),
      };
      return send({ ...message, result: { ...message.result, capabilities, ...(instructions ? { instructions } : {}) } });
    }
    return send(message);
  };
  let closing: Promise<void> | undefined;
  const shutdown = () => closing ??= (async () => {
    try { await connecting; } catch { /* Reported when it happened. */ }
    if (ping) clearInterval(ping);
    try { await http?.terminateSession(); } catch { process.stderr.write("harita-mcp: could not end the editor session (it ends by itself shortly)\n"); }
    await upstream?.close();
    await server.close();
  })();
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
  process.stdin.once("end", () => { void shutdown(); });

  server.setRequestHandler(ListToolsRequestSchema, (request) => forward((client) => client.listTools(request.params), () => {
    const tools = bundled("../../agent/schema/tools.json", (text) => (JSON.parse(text) as { tools: Tool[] }).tools);
    if (!tools) throw new McpError(ErrorCode.ConnectionClosed, new EditorUnavailable("unreachable").message);
    return { tools };
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try { return await withUpstream((client) => client.callTool(request.params, undefined, { signal: extra.signal })); }
    catch (error) {
      if (!(error instanceof EditorUnavailable)) throw error;
      // A tool result (not a protocol error) so the agent reads the reason and next step.
      const result = { ok: false, code: "EDITOR_UNAVAILABLE", message: error.message, worldSessionId: null, revision: 0, retryable: true, details: { cause: error.reason === "unauthorized" ? "tokenRejected" : "editorUnreachable", nextAction: NEXT_ACTION[error.reason] } };
      return { isError: true, content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } satisfies CallToolResult;
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, (request, extra) => forward((client) => client.listResources(request.params, { signal: extra.signal }), () => ({ resources: [] })));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, (request, extra) => forward((client) => client.listResourceTemplates(request.params, { signal: extra.signal }), () => ({ resourceTemplates: [] })));
  server.setRequestHandler(ReadResourceRequestSchema, (request, extra) => forward((client) => client.readResource(request.params, { signal: extra.signal })));
  server.setRequestHandler(ListPromptsRequestSchema, (request, extra) => forward((client) => client.listPrompts(request.params, { signal: extra.signal }), () => ({ prompts: [] })));
  server.setRequestHandler(GetPromptRequestSchema, (request, extra) => forward((client) => client.getPrompt(request.params, { signal: extra.signal })));

  await server.connect(stdio);
  const receive = stdio.onmessage!;
  stdio.onmessage = (message) => {
    if ("method" in message && message.method === "initialize" && "id" in message) {
      if (closing || initializeId !== undefined) return;
      const info = (message.params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined)?.clientInfo;
      if (typeof info?.name !== "string" || typeof info.version !== "string") { receive(message); return; }
      initializeId = message.id;
      // Keep the downstream client's identity for every upstream (re)connection.
      clientInfo = { name: info.name, version: info.version };
      void ensure().catch(() => undefined).finally(() => receive(message));
    } else receive(message);
  };
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "MCP proxy failed"}\n`);
  process.exitCode = 1;
});
