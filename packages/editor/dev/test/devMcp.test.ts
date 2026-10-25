import { afterEach, expect, test } from "vitest";
import { startDevMcp } from "../devMcp";
import { request } from "node:http";
import { readFileSync } from "node:fs";

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
  expect((await fetch(host.url, { headers: { Authorization: "Bearer private-token" } })).status).toBe(400);
  const put = await fetch(host.url, { method: "PUT", headers: { Authorization: "Bearer private-token" } });
  expect(put.status).toBe(405); expect(put.headers.get("Allow")).toBe("GET, POST, DELETE");
  expect((await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(400);
  const id = await init();
  expect((await post({ jsonrpc: "2.0", id: 2, method: "ping" }, id, undefined, { "MCP-Protocol-Version": "wrong" })).status).toBe(400);
  const catalogue = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, id)).json();
  expect(catalogue.result.tools).toHaveLength(47);
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
  expect((await post({ jsonrpc: "2.0", id: 2, method: "ping" }, id, undefined, { Accept: "text/html" })).status).toBe(406);
  expect((await post({ jsonrpc: "2.0", id: 2, method: "ping" }, id, undefined, { Accept: "application/json" })).status).toBe(200);
});

const initBody = (name = "client") => ({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name, version: "1" } } });
function rawPost(url: string, headers: Record<string, string>, body: unknown) {
  return new Promise<{ status: number | undefined; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers } }, (res) => {
      let text = ""; res.on("data", (chunk) => { text += String(chunk); }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on("error", reject); req.end(JSON.stringify(body));
  });
}

test("access failures explain themselves; lowercase bearer and local Host aliases work", async () => {
  const { host, post, init } = await setup();
  const denied = await post({}, undefined, undefined, { Authorization: "Bearer nope" });
  expect(denied.status).toBe(401);
  expect(denied.headers.get("WWW-Authenticate")).toBe('Bearer error="invalid_token"');
  expect((await denied.json()).error.message).toContain("Settings > AI");
  for (const [scheme, name] of [["bearer", "localhost"], ["BEARER", "[::1]"], ["Bearer", "LocalHost"]] as const) {
    const authority = `${name}:${host.port}`;
    const res = await rawPost(host.url, { Authorization: `${scheme}  private-token`, Host: authority, Origin: `http://${authority}` }, initBody());
    expect(res.status, authority).toBe(200);
    expect(res.headers["mcp-session-id"]).toBeTruthy();
  }
  const foreign = await rawPost(host.url, { Authorization: "Bearer private-token", Host: `example.com:${host.port}` }, {});
  expect(foreign.status).toBe(403); expect(JSON.parse(foreign.body).error.message).toContain("127.0.0.1");
  const unknown = await post({ jsonrpc: "2.0", id: 2, method: "ping" }, "missing-session");
  expect(unknown.status).toBe(404); expect((await unknown.json()).error.message).toContain("initialize");
  const discover = await post({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} });
  expect(discover.status).toBe(200); expect((await discover.json()).error.code).toBe(-32601);
  const noSession = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  expect(noSession.status).toBe(400); expect((await noSession.json()).error.message).toContain("Mcp-Session-Id");
  const id = await init();
  const ping = await post({ jsonrpc: "2.0", id: 4, method: "ping" }, undefined, undefined, { "Mcp-Session-Id": id });
  expect((await ping.json()).result).toEqual({});
});

async function openStream(url: string, session: string) {
  const controller = new AbortController();
  const res = await fetch(url, { headers: { Authorization: "Bearer private-token", Accept: "text/event-stream", "Mcp-Session-Id": session }, signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  const reader = res.body!.getReader();
  return { read: async () => new TextDecoder().decode((await reader.read()).value), close: () => { controller.abort(); } };
}

test("an open stream keeps a quiet session; after it closes the session ends once the grace passes", async () => {
  let now = 0;
  const host = await startDevMcp({ port: 0, token: "private-token", now: () => now, streamKeepaliveMs: 20, streamGraceMs: 15000 });
  cleanup.push(() => host.close());
  const controls: { type: string; reason?: string; clientSessionId?: string }[] = [];
  host.attach("a", "epoch", (message) => { controls.push(message as never); });
  const res = await rawPost(`${host.url}?pair=a`, { Authorization: "Bearer private-token" }, initBody());
  const session = String(res.headers["mcp-session-id"]);
  const stream = await openStream(host.url, session);
  expect(await stream.read()).toBe(": harita\n\n");
  expect(await stream.read()).toBe(": keepalive\n\n");
  now = 600000; host.expire();
  expect(host.sessionCount).toBe(1);
  stream.close();
  // Let the server observe the closed stream before advancing the clock.
  await expect.poll(() => host.streamCount).toBe(0);
  now += 14000; host.expire();
  expect(host.sessionCount).toBe(1);
  now += 2000; host.expire();
  expect(host.sessionCount).toBe(0);
  expect(controls).toContainEqual(expect.objectContaining({ type: "sessionEnded", reason: "disconnect", clientSessionId: session }));
});

test("the client cap evicts the oldest quiet session but answers 429 when every client streams", async () => {
  let now = 0;
  const host = await startDevMcp({ port: 0, token: "private-token", now: () => now });
  cleanup.push(() => host.close());
  const controls: { type: string; reason?: string; clientSessionId?: string }[] = [];
  host.attach("a", "epoch", (message) => { controls.push(message as never); });
  const ids: string[] = [];
  for (let index = 0; index < 16; index++) { now++; ids.push(String((await rawPost(`${host.url}?pair=a`, { Authorization: "Bearer private-token" }, initBody())).headers["mcp-session-id"])); }
  const streams = [await openStream(host.url, ids[0]!)];
  const res = await rawPost(`${host.url}?pair=a`, { Authorization: "Bearer private-token" }, initBody("17th"));
  expect(res.status).toBe(200);
  expect(controls).toContainEqual(expect.objectContaining({ type: "sessionEnded", reason: "expired", clientSessionId: ids[1] }));
  for (const id of [...ids.slice(2), String(res.headers["mcp-session-id"])]) streams.push(await openStream(host.url, id));
  const full = await rawPost(`${host.url}?pair=a`, { Authorization: "Bearer private-token" }, initBody("18th"));
  expect(full.status).toBe(429);
  expect(JSON.parse(full.body).error.message).toContain("Close an unused AI client");
  for (const stream of streams) stream.close();
});

test("an occupied MCP port reports failure instead of selecting a different port", async () => {
  const { host } = await setup();
  await expect(startDevMcp({ port: host.port, token: "another-token" })).rejects.toMatchObject({ code: "EADDRINUSE" });
});

test("guide resources and prompts require authenticated initialized sessions and advertise static capabilities", async () => {
  const { host, post, init } = await setup();
  const unauthenticated = await post({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "harita://guide/skill" } }, undefined, undefined, { Authorization: "" });
  expect(unauthenticated.status).toBe(401);
  expect((await post({ jsonrpc: "2.0", id: 1, method: "resources/list" })).status).toBe(400);
  const initial = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "guide-client", version: "1" } } });
  const session = initial.headers.get("Mcp-Session-Id")!;
  const setupResult = await initial.json();
  expect(setupResult.result.capabilities).toMatchObject({ resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } });
  expect(setupResult.result.instructions).toBe(readFileSync(new URL("../../../agent/schema/workflow.txt", import.meta.url), "utf8").trim());
  expect((await (await post({ jsonrpc: "2.0", id: 2, method: "resources/list" }, session)).json()).error).toBeDefined();
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
  const list = await (await post({ jsonrpc: "2.0", id: 3, method: "resources/list" }, session)).json();
  expect(list.result.resources).toHaveLength(10);
  const read = await (await post({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "harita://guide/skill" } }, session)).json();
  expect(read.result.contents[0].text).toContain("harita://guide/overview");
  const unknown = await (await post({ jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "file:///etc/passwd" } }, session)).json();
  expect(unknown.error.code).toBe(-32002);
  const prompt = await (await post({ jsonrpc: "2.0", id: 6, method: "prompts/get", params: { name: "harita-map-task", arguments: { task: "Design a village", topic: "collaboration" } } }, session)).json();
  expect(prompt.result.messages[0].content.text).toContain("harita://guide/collaboration");
  const prompts = await (await post({ jsonrpc: "2.0", id: 7, method: "prompts/list" }, session)).json();
  expect(prompts.result.prompts[0].name).toBe("harita-map-task");
  const templates = await (await post({ jsonrpc: "2.0", id: 8, method: "resources/templates/list" }, session)).json();
  expect(templates.result).toEqual({ resourceTemplates: [] });
  // Guide reads need no paired renderer and cannot dispatch an editor request.
  expect(host.sessionCount).toBe(1);
  const paired = await init("absent");
  expect((await (await post({ jsonrpc: "2.0", id: 9, method: "resources/list" }, paired)).json()).result.resources).toHaveLength(10);
});

test("token rotation rejects an initialize whose authenticated body is still arriving (#4)", async () => {
  const {host}=await setup();
  const body=JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"delayed",version:"1"}}});
  let finish!:()=>void;
  const response=new Promise<number|undefined>((resolve,reject)=>{
    const req=request(host.url,{method:"POST",headers:{Authorization:"Bearer private-token","Content-Type":"application/json",Accept:"application/json, text/event-stream","Content-Length":Buffer.byteLength(body)}},res=>{res.resume();resolve(res.statusCode);});
    req.on("error",reject);req.write(body.slice(0,1));finish=()=>req.end(body.slice(1));
  });
  // Round trip another connection while the first request waits for its body.
  await fetch(host.url,{headers:{Authorization:"Bearer private-token"}});
  host.setToken("replacement-token");finish();
  expect(await response).toBe(401);expect(host.sessionCount).toBe(0);
  const fresh=await fetch(host.url,{method:"POST",headers:{Authorization:"Bearer replacement-token","Content-Type":"application/json",Accept:"application/json, text/event-stream"},body});
  expect(fresh.status).toBe(200);expect(host.sessionCount).toBe(1);
});

test("a session deleted while a tool body arrives cannot dispatch or rejoin the editor", async () => {
  const { host, post, init } = await setup();
  const dispatched: unknown[] = [];
  host.attach("a", "epoch", message => {
    if (message.type !== "tools/call") return;
    dispatched.push(message);
    host.reply("a", { type: "result", requestId: message.requestId, bridgeEpoch: message.bridgeEpoch, clientSessionId: message.clientSessionId, result: { content: [{ type: "text", text: "{}" }], structuredContent: {} } });
  });
  const session = await init("a");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_session" } });
  let finish!: () => void;
  const response = new Promise<number | undefined>((resolve, reject) => {
    const req = request(host.url, { method: "POST", headers: { Authorization: "Bearer private-token", "Mcp-Session-Id": session, "MCP-Protocol-Version": "2025-11-25", "Content-Type": "application/json", Accept: "application/json, text/event-stream", "Content-Length": Buffer.byteLength(body) } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject); req.write(body.slice(0, 1)); finish = () => req.end(body.slice(1));
  });
  await post({ jsonrpc: "2.0", id: 3, method: "ping" }, session);
  expect((await fetch(host.url, { method: "DELETE", headers: { Authorization: "Bearer private-token", "Mcp-Session-Id": session } })).status).toBe(200);
  finish();
  expect(await response).toBe(404);
  expect(dispatched).toEqual([]);
  expect(host.sessionCount).toBe(0);
});

test("the complete API result budget remains deliverable through the bridge envelope", async () => {
  const { host, post, init } = await setup();
  const result = { content: [{ type: "text", text: "" }], structuredContent: {} };
  result.content[0]!.text = "x".repeat(8 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(result)));
  expect(Buffer.byteLength(JSON.stringify(result))).toBe(8 * 1024 * 1024);
  let delivered: boolean | undefined;
  host.attach("a", "epoch", message => {
    if (message.type === "tools/call") {
      const reply = { type: "result" as const, requestId: message.requestId, bridgeEpoch: message.bridgeEpoch, clientSessionId: message.clientSessionId, result };
      expect(host.reply("a", { ...reply, result: { ...result, structuredContent: { tooLarge: true } } })).toBe(false);
      delivered = host.reply("a", reply);
    }
  });
  const session = await init("a");
  const call = post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_session" } }, session);
  await expect.poll(() => delivered).toBeDefined();
  expect(delivered).toBe(true);
  expect((await (await call).json()).result).toEqual(result);
});
