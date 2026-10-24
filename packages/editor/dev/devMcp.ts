import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AgentToolResult, BridgeControl, BridgeReply, BridgeRequest, ClientInfo } from "@smap/agent";
import { guideResponse } from "./guideProtocol.ts";

const catalogue: unknown = JSON.parse(readFileSync(new URL("../../agent/schema/tools.json", import.meta.url), "utf8"));
// Draft writes and whole-map checks get the long budget too, so a big paint is not cut off at 10 s.
const LONG_TOOLS = new Set<string>([
  "begin_edit", "render_preview", "prepare_smart_source", "get_tile_catalog", "list_stamps", "visual_ingest_reference", "visual_match_reference",
  "validate_map", "validate_goals", "read_region",
  ...((catalogue as { tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[] }).tools ?? []).filter((tool) => tool.annotations?.readOnlyHint === false).map((tool) => tool.name),
]);
const instructions = readFileSync(new URL("../../agent/schema/workflow.txt", import.meta.url), "utf8").trim();
const VERSIONS = ["2025-11-25", "2025-06-18"];
const BODY_LIMIT = 1024 * 1024, RESPONSE_LIMIT = 8 * BODY_LIMIT;
// Correlation fields wrap an already budgeted AgentToolResult.
const BRIDGE_OVERHEAD_LIMIT = 1024;
const MAX_CLIENTS = 16;
type Message = BridgeRequest | BridgeControl;
interface Page { epoch: string; send(message: Message): void }
interface Session { id: string; pair: string | undefined; page: Page | undefined; version: string; info: ClientInfo; initialized: boolean; lastSeen: number; ids: Set<string | number>; streams: Set<ServerResponse>; streamClosed: number | undefined }
interface Pending { session: Session; page: Page; request: BridgeRequest; finish(result: AgentToolResult): void }
export interface DevMcpOptions { port: number; token: string; now?: () => number; callTimeoutMs?: number; imageTimeoutMs?: number; sessionIdleMs?: number; streamKeepaliveMs?: number; streamGraceMs?: number }
export function secret(): string { return randomBytes(32).toString("hex"); }
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function failure(code: string, message: string): AgentToolResult {
  const result = { ok: false, code, message, worldSessionId: null, revision: 0, retryable: true, details: {} };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } as AgentToolResult;
}
function depth(value: unknown, level = 0): boolean {
  return level <= 32 && (value === null || typeof value !== "object" || Object.values(value).every((item) => depth(item, level + 1)));
}
function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function headerCount(req: IncomingMessage, name: string): number {
  return req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i]!.toLowerCase() === name).length;
}
function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
/** HTTP-level failures carry a JSON-RPC body whose message says what to do; clients show it. */
function fail(res: ServerResponse, status: number, message: string, code = -32000): void {
  send(res, status, { jsonrpc: "2.0", id: null, error: { code, message } });
}
const HINT_TOKEN = "Unauthorized: Harita rejected the access token. Copy the connection settings again from Harita: Settings > AI (regenerating the token disconnects old settings).";
const HINT_SESSION = "Session not found or expired: send initialize again to start a new MCP session. A pending Harita edit is kept; resume it with resume_edit.";
const SESSION_METHODS = ["ping", "tools/list", "tools/call", "resources/list", "resources/read", "resources/templates/list", "prompts/list", "prompts/get", "logging/setLevel"];
/** Case-insensitive `Bearer <token>` (RFC 6750). */
function bearer(value: string | undefined): string | undefined {
  const match = /^\s*bearer[ \t]+(\S+)\s*$/i.exec(value ?? "");
  return match?.[1];
}
/** Loopback names clients use for this listener. */
function localAuthority(value: string | undefined, port: number): boolean {
  const lower = value?.toLowerCase();
  return ["127.0.0.1", "localhost", "[::1]"].some((host) => lower === `${host}:${port}`);
}

/** JSON-response Streamable HTTP. GET opens an optional keepalive-only event
 * stream whose closing tells the server the client is gone. */
export async function startDevMcp(options: DevMcpOptions) {
  let token = options.token, tokenGeneration = 0;
  if (!token || /\s/.test(token)) throw new Error("Invalid MCP token");
  const now = options.now ?? Date.now;
  const pages = new Map<string, Page>(), sessions = new Map<string, Session>(), pending = new Map<string, Pending>();
  let port = options.port;
  const sessionIdle = options.sessionIdleMs ?? 300000, streamGrace = options.streamGraceMs ?? 15000;
  function control(session: Session, reason: Extract<BridgeControl, { type: "sessionEnded" }>["reason"]) {
    if (!sessions.has(session.id)) return;
    sessions.delete(session.id);
    if (session.page) session.page.send({ type: "sessionEnded", bridgeEpoch: session.page.epoch, clientSessionId: session.id, reason });
    for (const call of [...pending.values()]) if (call.session === session) call.finish(failure("EDITOR_UNAVAILABLE", "Editor session ended"));
    for (const stream of session.streams) stream.end();
  }
  const busy = (session: Session) => session.streams.size > 0 || [...pending.values()].some((call) => call.session === session);
  /** Session end never rolls back (the editor keeps the draft). A live stream or
   * call means alive; a closed stream plus a quiet grace means gone. */
  function expire() {
    for (const session of [...sessions.values()]) {
      if (busy(session)) continue;
      const quiet = now() - session.lastSeen;
      if (session.streamClosed !== undefined && now() - session.streamClosed >= streamGrace && quiet >= streamGrace) control(session, "disconnect");
      else if (quiet >= sessionIdle) control(session, "expired");
    }
  }
  function forward(session: Session, name: string, args: Record<string, unknown>, rpcId: string | number): Promise<AgentToolResult> {
    const page = session.page;
    if (!page || pages.get(session.pair!) !== page) return Promise.resolve(failure("EDITOR_UNAVAILABLE", "No paired editor is available"));
    if (pending.size >= 64 || [...pending.values()].filter((call) => call.session === session).length >= 32) return Promise.resolve(failure("LIMIT_EXCEEDED", "Too many pending requests"));
    const timeout = LONG_TOOLS.has(name) ? options.imageTimeoutMs ?? 30000 : options.callTimeoutMs ?? 10000;
    const request: BridgeRequest = { type: "tools/call", bridgeEpoch: page.epoch, clientSessionId: session.id, clientInfo: session.info, requestId: secret(), name, arguments: args as BridgeRequest["arguments"], deadline: now() + timeout };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.get(request.requestId)?.finish(failure("TIMEOUT", "Editor request timed out"));
        page.send({ type: "cancel", bridgeEpoch: page.epoch, clientSessionId: session.id, requestId: request.requestId, reason: "timeout" });
      }, timeout);
      const call: Pending & { rpcId: string | number } = { session, page, request, rpcId, finish(result) { clearTimeout(timer); pending.delete(request.requestId); resolve(result); } };
      pending.set(request.requestId, call);
      try { page.send(request); } catch { call.finish(failure("EDITOR_UNAVAILABLE", "Editor disconnected")); }
    });
  }
  function openStream(req: IncomingMessage, res: ServerResponse, session: Session | undefined) {
    const accept = (req.headers.accept ?? "").split(",").map((type) => type.split(";")[0]!.trim().toLowerCase());
    if (!accept.includes("text/event-stream") && !accept.includes("*/*")) return fail(res, 406, "Not acceptable: GET opens an event stream; accept text/event-stream.");
    if (!session) return fail(res, 400, "Missing Mcp-Session-Id header: send initialize first.", -32600);
    if (session.streams.size >= 2) return fail(res, 409, "This session already has an open event stream.");
    session.streams.add(res); session.streamClosed = undefined; session.lastSeen = now();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    res.write(": harita\n\n");
    const keepalive = setInterval(() => { res.write(": keepalive\n\n"); }, options.streamKeepaliveMs ?? 5000);
    keepalive.unref();
    res.once("close", () => {
      clearInterval(keepalive);
      // The stream proved liveness until now.
      if (session.streams.delete(res)) { session.lastSeen = now(); if (session.streams.size === 0) session.streamClosed = now(); }
    });
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const authenticatedGeneration = tokenGeneration;
    // Check credentials before reading any body, including oversized unauthorized traffic.
    const authorization = headerCount(req, "authorization") === 1 ? bearer(req.headers.authorization) : undefined;
    if (authorization === undefined || !sameSecret(authorization, token)) { res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"'); return fail(res, 401, HINT_TOKEN, -32001); }
    if (headerCount(req, "host") !== 1 || !localAuthority(req.headers.host, port)) return fail(res, 403, `Forbidden: Harita accepts only local MCP clients. Use http://127.0.0.1:${port}/mcp.`);
    const origin = req.headers.origin;
    if (headerCount(req, "origin") > 1 || (origin !== undefined && !(/^http:\/\//i.test(origin) && localAuthority(origin.slice(7), port)))) return fail(res, 403, "Forbidden: browser pages cannot use Harita's MCP server. Connect from an MCP client such as Claude Code or Codex.");
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== "/mcp") return fail(res, 404, "Not found: Harita's MCP endpoint is /mcp.");
    if ([...url.searchParams.keys()].some((key) => key !== "pair") || url.searchParams.getAll("pair").length > 1) return fail(res, 400, "Invalid query: only ?pair=<id> is accepted.", -32600);
    if (req.method !== "POST" && req.method !== "DELETE" && req.method !== "GET") { res.setHeader("Allow", "GET, POST, DELETE"); return fail(res, 405, "Method not allowed: use POST (GET opens an optional event stream, DELETE ends a session)."); }
    expire();
    const sessionId = req.headers["mcp-session-id"];
    const version = req.headers["mcp-protocol-version"];
    if (headerCount(req, "mcp-session-id") > 1 || headerCount(req, "mcp-protocol-version") > 1 || (version !== undefined && (typeof version !== "string" || !VERSIONS.includes(version)))) return fail(res, 400, `Invalid MCP headers: MCP-Protocol-Version must be one of ${VERSIONS.join(", ")}.`, -32600);
    const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (sessionId !== undefined && !session) return fail(res, 404, HINT_SESSION, -32001);
    const pair = url.searchParams.get("pair") ?? undefined;
    // An omitted MCP-Protocol-Version after initialize means the negotiated one.
    if (session && ((pair !== undefined && pair !== session.pair) || (version !== undefined && version !== session.version))) return fail(res, 400, `Session target/version mismatch: this session negotiated ${session.version}.`, -32600);
    if (req.method === "GET") return openStream(req, res, session);
    if (req.method === "DELETE") {
      if (!session) return fail(res, 400, "Missing Mcp-Session-Id header: DELETE ends one session.", -32600);
      control(session, "delete"); return send(res, 200, {});
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) return fail(res, 415, "Unsupported media type: send JSON-RPC as Content-Type: application/json.");
    const accept = (req.headers.accept ?? "").split(",").map((type) => type.split(";")[0]!.trim().toLowerCase());
    if (req.headers.accept !== undefined && !accept.includes("application/json") && !accept.includes("*/*")) return fail(res, 406, "Not acceptable: accept application/json responses.");
    if (Number(req.headers["content-length"]) > BODY_LIMIT) return fail(res, 413, "Request too large: keep one JSON-RPC message under 1 MiB.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) return fail(res, 413, "Request too large: keep one JSON-RPC message under 1 MiB."); chunks.push(Buffer.from(chunk)); }
    if (authenticatedGeneration !== tokenGeneration) { res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"'); return fail(res, 401, HINT_TOKEN, -32001); }
    if (session && sessions.get(session.id) !== session) return fail(res, 404, HINT_SESSION, -32001);
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    if (!depth(body)) return fail(res, 413, "Request too deeply nested.");
    if (!object(body) || body.jsonrpc !== "2.0" || (body.id !== undefined && typeof body.id !== "string" && !(typeof body.id === "number" && Number.isSafeInteger(body.id))) || (body.params !== undefined && !object(body.params)) || (typeof body.method !== "string" && !(body.method === undefined && body.id !== undefined && (("result" in body) !== ("error" in body))))) return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    const id = body.id as string | number | undefined;
    const error = (code: number, message: string) => send(res, 200, { jsonrpc: "2.0", id: id ?? null, error: { code, message } });
    const result = (value: unknown) => send(res, 200, { jsonrpc: "2.0", id, result: value });
    const params = object(body.params) ? body.params : {};
    if (body.method === "initialize") {
      if (session || sessionId !== undefined) return fail(res, 400, "Already initialized: initialize without an Mcp-Session-Id header.", -32600);
      if (id === undefined || !object(params.clientInfo) || typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string" || typeof params.protocolVersion !== "string" || !object(params.capabilities)) return error(-32602, "Invalid initialize parameters");
      if (sessions.size >= MAX_CLIENTS) {
        // The least recently used quiet session without a stream makes room; its draft stays.
        const victim = [...sessions.values()].filter((item) => !busy(item)).sort((a, b) => a.lastSeen - b.lastSeen)[0];
        if (!victim) return fail(res, 429, `Too many active MCP clients (${MAX_CLIENTS}) are connected to Harita. Close an unused AI client and retry.`);
        control(victim, "expired");
      }
      const selected = pair ?? (pages.size === 1 ? pages.keys().next().value : undefined);
      const target = selected === undefined ? undefined : pages.get(selected);
      const fresh: Session = { id: secret(), pair: selected, page: target, version: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0]!, info: { name: params.clientInfo.name.replace(/[^\x20-\x7e]/g, "").slice(0, 80), version: params.clientInfo.version.slice(0, 80) }, initialized: false, lastSeen: now(), ids: new Set(), streams: new Set(), streamClosed: undefined };
      sessions.set(fresh.id, fresh);
      if (target) target.send({ type: "sessionStarted", bridgeEpoch: target.epoch, clientSessionId: fresh.id, clientInfo: fresh.info });
      res.setHeader("Mcp-Session-Id", fresh.id);
      return result({ protocolVersion: fresh.version, capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } }, serverInfo: { name: "harita", version: "2.0.0" }, instructions });
    }
    if (!session) {
      // Probes for newer protocol revisions (e.g. server/discover) get a JSON-RPC answer so the client falls back to initialize.
      if (id !== undefined && typeof body.method === "string" && !SESSION_METHODS.includes(body.method) && !body.method.startsWith("notifications/")) return error(-32601, `Method not found. Harita supports MCP ${VERSIONS.join(" and ")}: send initialize.`);
      return fail(res, 400, "Missing Mcp-Session-Id header: send initialize first, then repeat the request with the returned session ID.", -32600);
    }
    session.lastSeen = now();
    if (body.method === undefined && id !== undefined && ("result" in body || "error" in body)) return send(res, 202);
    if (body.method === "notifications/initialized" && id === undefined) { session.initialized = true; return send(res, 202); }
    if (!session.initialized) return error(-32600, "Initialization incomplete");
    if (id === undefined) {
      if (body.method === "notifications/cancelled") for (const call of [...pending.values()]) {
        if (call.session === session && (call as Pending & { rpcId: unknown }).rpcId === params.requestId) {
          call.page.send({ type: "cancel", bridgeEpoch: call.page.epoch, clientSessionId: session.id, requestId: call.request.requestId, reason: "clientCancelled" });
          call.finish(failure("CANCELLED", "Client cancelled request"));
        }
      }
      return send(res, 202);
    }
    if (session.ids.has(id)) return error(-32600, "Duplicate pending request ID");
    if (body.method === "ping") return result({});
    if (body.method === "tools/list") return result(catalogue);
    const guide = guideResponse(body.method as string, params);
    if (guide) return "error" in guide ? error(guide.error.code, guide.error.message) : result(guide.result);
    if (body.method !== "tools/call") return error(-32601, "Method not found");
    if (typeof params.name !== "string" || (params.arguments !== undefined && !object(params.arguments))) return error(-32602, "Invalid tool parameters");
    session.ids.add(id);
    try { result(await forward(session, params.name, (params.arguments ?? {}) as Record<string, unknown>, id)); }
    finally { session.ids.delete(id); }
  }
  const server = createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, { error: "Internal transport error" }); else res.end(); }); });
  server.requestTimeout = 15000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  port = (server.address() as { port: number }).port;
  const timer = setInterval(expire, 1000); timer.unref();
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${port}/mcp`, port,
    get sessionCount() { return sessions.size; },
    get streamCount() { return [...sessions.values()].reduce((total, session) => total + session.streams.size, 0); },
    expire,
    attach(pair: string, epoch: string, sendMessage: (message: Message) => void) {
      if (!pair || !epoch || pages.has(pair)) throw new Error("Pair already attached or invalid");
      const page = { epoch, send: sendMessage }; pages.set(pair, page);
      for (const session of sessions.values()) if (!session.page && session.pair === pair) { session.page = page; page.send({ type: "sessionStarted", bridgeEpoch: epoch, clientSessionId: session.id, clientInfo: session.info }); }
    },
    detach(pair: string) {
      const page = pages.get(pair);
      for (const session of [...sessions.values()]) if (session.page === page && page) control(session, "disconnect");
      pages.delete(pair);
    },
    reply(pair: string, reply: BridgeReply) {
      const call = pending.get(reply.requestId);
      if (!call || pages.get(pair) !== call.page || call.request.bridgeEpoch !== reply.bridgeEpoch || call.session.id !== reply.clientSessionId || Buffer.byteLength(JSON.stringify(reply)) > RESPONSE_LIMIT + BRIDGE_OVERHEAD_LIMIT) return false;
      if (reply.type === "result") {
        if (!object(reply.result) || !Array.isArray(reply.result.content) || !object(reply.result.structuredContent) || Buffer.byteLength(JSON.stringify(reply.result)) > RESPONSE_LIMIT) return false;
        call.finish(reply.result);
      } else call.finish(failure(reply.error.code, reply.error.message));
      return true;
    },
    setToken(next: string) { tokenGeneration++; for (const session of [...sessions.values()]) control(session, "tokenRegenerated"); token = next; },
    close() {
      return closing ??= (async () => {
        clearInterval(timer);
        for (const session of [...sessions.values()]) control(session, "shutdown");
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      })();
    },
  };
}
export type DevMcp = Awaited<ReturnType<typeof startDevMcp>>;
