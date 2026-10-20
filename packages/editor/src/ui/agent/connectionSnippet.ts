export type AgentClientFormat = "claude" | "codex";
export function validAgentPort(value: number | string): boolean {
  if (typeof value === "string" && !/^\d+$/.test(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
export function agentEndpoint(port: number): string { return `http://127.0.0.1:${port}/mcp`; }
/** Tokens are generated secrets, never arbitrary shell/TOML input. */
export function connectionSnippet(client: AgentClientFormat, port: number, token: string): string {
  if (!validAgentPort(port) || !/^[A-Za-z0-9_\-/+=]+$/.test(token)) throw new Error("Invalid connection configuration");
  const url = agentEndpoint(port);
  return client === "claude"
    ? `claude mcp add --transport http harita ${url} --header "Authorization: Bearer ${token}"`
    : `[mcp_servers.harita]\nurl = "${url}"\nbearer_token_env_var = "HARITA_MCP_TOKEN"\n\n$env:HARITA_MCP_TOKEN="${token}"\nsetx HARITA_MCP_TOKEN "${token}"`;
}
