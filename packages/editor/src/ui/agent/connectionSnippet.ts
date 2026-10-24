export type AgentClientFormat = "claude" | "codex";
export function validAgentPort(value: number | string): boolean {
  if (typeof value === "string" && !/^\d+$/.test(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}
export function agentEndpoint(port: number): string { return `http://127.0.0.1:${port}/mcp`; }
/** Claude Code permission rule allowing every Harita tool without a prompt. */
export const CLAUDE_PERMISSION_RULE = "mcp__harita";
/** Tokens are generated secrets, never arbitrary shell/TOML input.
 * Claude Code: re-runnable user-scope registration (remove, then add).
 * Codex: one pure TOML block; drafts are reviewed in Harita, so tools run without Codex prompts. */
export function connectionSnippet(client: AgentClientFormat, port: number, token: string): string {
  if (!validAgentPort(port) || !/^[A-Za-z0-9_\-/+=]+$/.test(token)) throw new Error("Invalid connection configuration");
  const url = agentEndpoint(port);
  return client === "claude"
    ? `claude mcp remove harita -s user\nclaude mcp add -s user --transport http harita ${url} --header "Authorization: Bearer ${token}"`
    : `[mcp_servers.harita]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }\ndefault_tools_approval_mode = "approve"\ntool_timeout_sec = 120`;
}
