import type { Plugin } from "vite";
/** Serve-only extension point. The HTTP/private-WebSocket transport is implemented by lane 4. */
export function agentPlugin(): Plugin {
  return { name: "harita-dev-mcp", apply: "serve" };
}
