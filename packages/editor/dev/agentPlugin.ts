import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import type { Plugin, WebSocketClient } from "vite";
import type { BridgeReply } from "@smap/agent";
import { object, secret, startDevMcp } from "./devMcp.ts";

/** An authenticated, targeted channel over Vite's existing WebSocket. Never broadcast. */
export function agentPlugin(): Plugin {
  let stop: (() => Promise<void>) | undefined;
  return {
    name: "harita-dev-mcp", apply: "serve",
    async closeBundle() { await stop?.(); },
    async configureServer(vite) {
      if (process.env.HARITA_DEV_MCP !== "1") return;
      const port = Number(process.env.HARITA_DEV_MCP_PORT ?? 48766);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid HARITA_DEV_MCP_PORT");
      const hostname = vite.config.server.host === "127.0.0.1" ? "127.0.0.1" : "localhost";
      const origin = vite.config.server.origin ?? `${vite.config.server.https ? "https" : "http"}://${hostname}:${vite.config.server.port ?? 5173}`;
      const tokenPath = resolve(vite.config.root, "../../node_modules/.harita-mcp/token");
      async function persistToken(value: string) {
        await mkdir(resolve(tokenPath, ".."), { recursive: true, mode: 0o700 });
        const temporary = `${tokenPath}.${secret()}.tmp`;
        try { await writeFile(temporary, value + "\n", { mode: 0o600 }); await rename(temporary, tokenPath); }
        finally { await rm(temporary, { force: true }); }
      }
      let token = process.env.HARITA_MCP_TOKEN ?? secret(), revision = 0, rotating = false;
      if (!process.env.HARITA_MCP_TOKEN) {
        await persistToken(token);
        process.stderr.write(`Harita dev MCP token (${tokenPath}): ${token}\n`);
      }
      const host = await startDevMcp({ port, token });
      stop = host.close;
      const nonces = new Map<string, { pair: string; expires: number }>();
      const authorizedSockets = new WeakSet<WebSocketClient["socket"]>();
      const attached = new Map<WebSocketClient, { pair: string; epoch: string }>();
      const settings = () => ({ revision, settings: { enabled: true, port } });
      const status = () => ({ state: "connected", port, clients: [] });
      const reply = (client: WebSocketClient, id: unknown, value: unknown, error?: string) => client.send("harita:agent", { type: "rpc", id, value, ...(error ? { error } : {}) });
      vite.middlewares.use("/__harita/nonce", async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        const url = new URL(req.url ?? "/", origin);
        const pair = url.searchParams.get("pair");
        const originHeaders = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i]!.toLowerCase() === "origin");
        if (req.method !== "POST" || originHeaders.length !== 1 || req.headers.origin !== origin || req.headers.host !== new URL(origin).host || req.headers["content-type"] !== "application/json") { res.statusCode = 403; res.end(); return; }
        if (!pair || pair.length > 128 || !/^[\w-]+$/.test(pair)) { res.statusCode = 400; res.end(); return; }
        for (const [key, value] of nonces) if (value.expires <= Date.now()) nonces.delete(key);
        if (nonces.size >= 64) { res.statusCode = 429; res.end(); return; }
        const nonce = secret(); nonces.set(nonce, { pair, expires: Date.now() + 30000 });
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ nonce, port }));
      });
      vite.ws.on("connection", (socket, request) => {
        const origins = request.rawHeaders.filter((_, i) => i % 2 === 0 && request.rawHeaders[i]!.toLowerCase() === "origin");
        if (origins.length === 1 && request.headers.origin === origin && request.headers.host === new URL(origin).host) authorizedSockets.add(socket);
      });
      const listener = async (data: unknown, client: WebSocketClient) => {
        if (!object(data) || !authorizedSockets.has(client.socket)) return;
        if (data.type === "attach") {
          const nonce = typeof data.nonce === "string" ? nonces.get(data.nonce) : undefined;
          if (typeof data.nonce === "string") nonces.delete(data.nonce);
          if (!nonce || nonce.expires <= Date.now() || nonce.pair !== data.pair || typeof data.epoch !== "string" || !data.epoch || data.epoch.length > 128 || attached.has(client)) { client.send("harita:agent", { type: "rejected" }); return; }
          try {
            const pair = nonce.pair;
            host.attach(pair, data.epoch, (message) => client.send("harita:agent", message));
            attached.set(client, { pair, epoch: data.epoch });
            client.socket.once("close", () => { host.detach(pair); attached.delete(client); });
            client.send("harita:agent", { type: "attached", snapshot: settings(), status: status() });
          } catch { client.send("harita:agent", { type: "rejected" }); }
          return;
        }
        const page = attached.get(client);
        if (!page) return;
        if ((data.type === "result" || data.type === "failure") && data.bridgeEpoch === page.epoch) {
          try { host.reply(page.pair, data as unknown as BridgeReply); } catch { /* Malformed renderer replies cannot terminate Vite. */ }
          return;
        }
        if (data.type === "rpc" && typeof data.id === "string") {
          if (data.method === "getSettings") reply(client, data.id, settings());
          else if (data.method === "revealToken") reply(client, data.id, token);
          else if (data.method === "setSettings") {
            const same = object(data.settings) && data.settings.enabled === true && data.settings.port === port;
            reply(client, data.id, data.revision !== revision ? { ok: false, code: "CONFLICT", snapshot: settings(), status: status() } : same ? { ok: true, snapshot: settings(), status: status() } : { ok: false, code: "INVALID_ARGUMENT", snapshot: settings(), status: status() });
          } else if (data.method === "readReferenceImage") {
            // Read-only: one agent-named local picture for reference_add; never written or copied.
            const path = typeof data.path === "string" ? data.path : "";
            try {
              if (!path || path.length > 4096 || !isAbsolute(path)) throw new Error("path must be absolute");
              if (![".png", ".jpg", ".jpeg", ".webp"].includes(extname(path).toLowerCase())) throw new Error("unsupported type");
              const info = await stat(path);
              if (!info.isFile()) throw new Error("not found");
              if (info.size > 16 * 1024 * 1024) throw new Error("file too large");
              reply(client, data.id, (await readFile(path)).toString("base64"));
            } catch (error) { reply(client, data.id, undefined, error instanceof Error && "code" in error && error.code === "ENOENT" ? "not found" : error instanceof Error ? error.message : "read failed"); }
          } else if (data.method === "readTiledFile") {
            // Read-only: an agent-named Tiled map and the tilesets/PNGs it references (import_tiled).
            const path = typeof data.path === "string" ? data.path : "";
            try {
              if (!path || path.length > 4096 || !isAbsolute(path)) throw new Error("path must be absolute");
              if (![".tmx", ".tmj", ".json", ".tsx", ".tsj", ".png"].includes(extname(path).toLowerCase())) throw new Error("unsupported type: use .tmx, .tmj, .json, .tsx, .tsj or .png");
              const info = await stat(path);
              if (!info.isFile()) throw new Error("not found");
              if (info.size > 32 * 1024 * 1024) throw new Error("file too large (32 MB limit)");
              reply(client, data.id, (await readFile(path)).toString("base64"));
            } catch (error) { reply(client, data.id, undefined, error instanceof Error && "code" in error && error.code === "ENOENT" ? "not found" : error instanceof Error ? error.message : "read failed"); }
          } else if (data.method === "regenerateToken") {
            if (rotating || data.revision !== revision) { reply(client, data.id, undefined, "CONFLICT"); return; }
            rotating = true;
            const next = secret();
            try { await persistToken(next); token = next; revision++; host.setToken(next); reply(client, data.id, settings()); }
            catch { reply(client, data.id, undefined, "IO"); }
            finally { rotating = false; }
          }
        }
      };
      vite.ws.on("harita:agent", listener);
      const close = host.close;
      stop = async () => { vite.ws.off("harita:agent", listener); await close(); };
      vite.httpServer?.once("close", () => { void stop?.(); });
    },
  };
}
