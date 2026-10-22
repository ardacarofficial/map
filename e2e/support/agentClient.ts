import { Client, StreamableHTTPClientTransport, type Transport } from "../../packages/agent-cli/src/client";
import type { AgentToolResult, ClientInfo, ToolArguments, ToolName } from "../../packages/agent/src/contracts";

/** SDK client for the real transport. A distinct pairing id isolates every test/page. */
export async function connect(pairingId: string, token: string, endpoint = `http://127.0.0.1:${process.env.E2E_MCP_PORT ?? 48766}/mcp`, clientInfo: ClientInfo = { name: "harita-playwright", version: "1.0.0" }) {
  const url = new URL(endpoint);
  if (pairingId) url.searchParams.set("pair", pairingId);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
  });
  const client = new Client(clientInfo);
  try {
    // SDK 1.32.1 declares an optional Transport.sessionId as a required getter returning
    // undefined on its HTTP class; this assertion bridges that exactOptionalPropertyTypes mismatch.
    await client.connect(transport as Transport);
  } catch (error) { await transport.close(); throw error; }
  function callTool<N extends ToolName>(name: N, args: ToolArguments[N], signal?: AbortSignal): Promise<AgentToolResult<N>> {
    return client.callTool({ name, arguments: args as unknown as Record<string, unknown> }, undefined, signal ? { signal } : {}) as Promise<AgentToolResult<N>>;
  }
  return {
    client, callTool,
    listTools: () => client.listTools(),
    getSession: (args: ToolArguments["get_session"] = {}) => callTool("get_session", args),
    async close() {
      try { await transport.terminateSession(); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === 404)) throw error; }
      finally { await client.close(); }
    },
  };
}
export type AgentClient = Awaited<ReturnType<typeof connect>>;
