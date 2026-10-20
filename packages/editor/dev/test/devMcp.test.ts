import { afterEach, expect, test } from "vitest";
import { startDevMcp } from "../devMcp";
import { request } from "node:http";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function setup() {
  const host = await startDevMcp({ port: 0, token: "private-token" });
  cleanup.push(() => host.close());
  const post = async (body: unknown, session?: string, pair?: string, headers: Record<string, string> = {}) => fetch(host.url + (pair ? `?pair=${pair}` : ""), {
    method: "POST", headers: { Authorization: "Bearer private-token", "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(session ? { "Mcp-Session-Id": session, "MCP-Protocol-Version": "2025-11-25" } : {}), ...headers }, body: JSON.stringify(body),
  });
  const init = async (pair?: string) => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, undefined, pair);
    expect(response.status).toBe(200);
    const id = response.headers.get("Mcp-Session-Id")!;
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, id, pair)).status).toBe(202);
    return id;
  };
  return { host, post, init };
}

test("auth, origin, Host, method, protocol, and initialization checks precede dispatch", async () => {
  const { host, post, init } = await setup();
  expect((await post({}, undefined, undefined, { Authorization: "" })).status).toBe(401);
  expect((await post({}, undefined, undefined, { Origin: "http://localhost:58210" })).status).toBe(403);
  const badHost = await new Promise<number | undefined>((resolve) => {
    const req = request(host.url, { method: "POST", headers: { Host: "localhost:1234", Authorization: "Bearer private-token" } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.end();
  });
  expect(badHost).toBe(403);
  expect((await fetch(host.url, { headers: { Authorization: "Bearer private-token" } })).status).toBe(405);
  expect((await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(400);
  const id = await init();
  expect((await post({ jsonrpc: "2.0", id: 2, method: "ping" }, id, undefined, { "MCP-Protocol-Version": "wrong" })).status).toBe(400);
  const catalogue = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, id)).json();
  expect(catalogue.result.tools).toHaveLength(26);
});

test("pairing pins a session to exactly one page; disconnect fails pending calls", async () => {
  const { host, post, init } = await setup();
  const seen: string[] = [];
  for (const pair of ["a", "b"]) host.attach(pair, `epoch-${pair}`, (message) => {
    if (message.type === "tools/call") {
      seen.push(pair);
      if (message.name === "pending") return;
      host.reply(pair, { type: "result", requestId: message.requestId, bridgeEpoch: message.bridgeEpoch, clientSessionId: message.clientSessionId, result: { content: [{ type: "text", text: pair }], structuredContent: { pair } } });
    }
  });
  const a = await init("a"), b = await init("b");
  const call = (id: string, name = "get_session", pair?: string) => post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: {} } }, id, pair);
  expect((await (await call(a)).json()).result.structuredContent).toEqual({ pair: "a" });
  expect((await (await call(b)).json()).result.structuredContent).toEqual({ pair: "b" });
  expect((await call(a, "get_session", "b")).status).toBe(400);
  const pending = call(a, "pending");
  await expect.poll(() => seen.length).toBe(3);
  host.detach("a");
  expect((await (await pending).json()).result).toMatchObject({ isError: true, structuredContent: { code: "EDITOR_UNAVAILABLE" } });
  expect((await (await call(b)).json()).result.structuredContent).toEqual({ pair: "b" });
});

test("DELETE and idle expiry deliver sessionEnded only to the selected page", async () => {
  let now = 0;
  const host = await startDevMcp({ port: 0, token: "private-token", now: () => now });
  cleanup.push(() => host.close());
  const controls: unknown[] = [];
  host.attach("a", "epoch", (message) => { controls.push(message); });
  const response = await fetch(`${host.url}?pair=a`, { method: "POST", headers: { Authorization: "Bearer private-token", "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) });
  expect((await response.json()).result.protocolVersion).toBe("2025-06-18");
  now = 300001;
  host.expire();
  expect(host.sessionCount).toBe(0);
  expect(controls).toContainEqual(expect.objectContaining({ type: "sessionEnded", reason: "expired", clientSessionId: response.headers.get("Mcp-Session-Id") }));
});

test("single-page fallback, explicit DELETE, and cancellation preserve session ownership", async () => {
  const { host, post, init } = await setup();
  const messages: Record<string, unknown>[] = [];
  host.attach("only", "epoch", (message) => { messages.push({ ...message }); });
  const id = await init();
  const call = post({ jsonrpc: "2.0", id: "call", method: "tools/call", params: { name: "get_session" } }, id);
  await expect.poll(() => messages.some((item) => item.type === "tools/call")).toBe(true);
  const request = messages.find((item) => item.type === "tools/call")!;
  const other = await init("absent");
  await post({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "call" } }, other);
  expect(messages.some((item) => item.type === "cancel")).toBe(false);
  await post({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "call" } }, id);
  expect((await (await call).json()).result.structuredContent.code).toBe("CANCELLED");
  expect(messages).toContainEqual(expect.objectContaining({ type: "cancel", requestId: request.requestId, reason: "clientCancelled" }));
  expect((await fetch(host.url, { method: "DELETE", headers: { Authorization: "Bearer private-token", "Mcp-Session-Id": id } })).status).toBe(200);
  expect(messages).toContainEqual(expect.objectContaining({ type: "sessionEnded", clientSessionId: id, reason: "delete" }));
  expect((await post({ jsonrpc: "2.0", id: 3, method: "ping" }, id)).status).toBe(404);
});

test("stale/foreign/duplicate replies cannot resolve a live call", async () => {
  const { host, post, init } = await setup();
  let request: Record<string, unknown> | undefined;
  host.attach("a", "epoch", (message) => { if (message.type === "tools/call") request = { ...message }; });
  host.attach("b", "epoch-b", () => {});
  const id = await init("a");
  const call = post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_session" } }, id);
  await expect.poll(() => request).toBeDefined();
  const good = { type: "result", ...request, result: { content: [{ type: "text", text: "correct" }], structuredContent: { correct: true } } };
  good.type = "result";
  expect(host.reply("b", good as never)).toBe(false);
  expect(host.reply("a", { ...good, bridgeEpoch: "stale" } as never)).toBe(false);
  expect(host.reply("a", { ...good, clientSessionId: "foreign" } as never)).toBe(false);
  expect(host.reply("a", good as never)).toBe(true);
  expect(host.reply("a", good as never)).toBe(false);
  expect((await (await call).json()).result.structuredContent).toEqual({ correct: true });
});

test("protocol envelopes, bounded ingress, exact endpoint Origin and session capacity", async () => {
  const { host, post, init } = await setup();
  const id = await init();
  expect((await post({ jsonrpc: "2.0", id: 2, method: "ping" }, id, undefined, { Origin: new URL(host.url).origin })).status).toBe(200);
  expect((await post({ jsonrpc: "2.0", id: 2, method: "ping" }, id, undefined, { Origin: "null" })).status).toBe(403);
  expect((await post([{ jsonrpc: "2.0", id: 2, method: "ping" }], id)).status).toBe(400);
  expect((await post({ jsonrpc: "2.0", id: null, method: "ping" }, id)).status).toBe(400);
  expect((await post({ jsonrpc: "2.0", id: 2, method: "ping", params: { large: "x".repeat(1024 * 1024) } }, id)).status).toBe(413);
  expect((await post({ jsonrpc: "2.0", id: 2, method: "ping" }, id, undefined, { "Content-Type": "text/plain" })).status).toBe(415);
  expect((await post({ jsonrpc: "2.0", id: 2, method: "ping" }, id, undefined, { Accept: "application/json" })).status).toBe(406);
  await init(); await init(); await init();
  expect((await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fifth", version: "1" } } })).status).toBe(429);
});

test("an occupied MCP port reports failure instead of selecting a different port", async () => {
  const { host } = await setup();
  await expect(startDevMcp({ port: host.port, token: "another-token" })).rejects.toMatchObject({ code: "EADDRINUSE" });
});
