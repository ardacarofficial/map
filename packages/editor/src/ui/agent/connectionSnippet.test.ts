import { describe, expect, it } from "vitest";
import { CLAUDE_PERMISSION_RULE, connectionSnippet, validAgentPort } from "./connectionSnippet";

describe("AI connection snippets", () => {
  it("copies a re-runnable user-scope Claude Code registration with the effective port and token", () => {
    expect(connectionSnippet("claude", 48781, "secret-token")).toBe('claude mcp remove harita -s user\nclaude mcp add -s user --transport http harita http://127.0.0.1:48781/mcp --header "Authorization: Bearer secret-token"');
  });
  it("copies one pure Codex TOML block with the token header and no approval prompts", () => {
    expect(connectionSnippet("codex", 48765, "secret-token")).toBe('[mcp_servers.harita]\nurl = "http://127.0.0.1:48765/mcp"\nhttp_headers = { Authorization = "Bearer secret-token" }\ndefault_tools_approval_mode = "approve"\ntool_timeout_sec = 120');
  });
  it("names every harita tool in the Claude Code permission rule", () => {
    expect(CLAUDE_PERMISSION_RULE).toBe("mcp__harita");
  });
  it.each([0, 80, 1023, 65536, 1.5, NaN, Infinity])("refuses invalid port %s", port => {
    expect(validAgentPort(port)).toBe(false);
    expect(() => connectionSnippet("claude", port, "secret")).toThrow();
  });
  it("accepts integer TCP ports, without whitespace or exponent syntax in the field", () => {
    expect(validAgentPort(1024)).toBe(true); expect(validAgentPort("65535")).toBe(true);
    for (const value of ["", "1e3", " 80", "80.0", "-1"]) expect(validAgentPort(value)).toBe(false);
  });
});

it.each(['bad"token', 'bad`token', 'bad$token', 'bad\ntoken'])("rejects unsafe secret interpolation before any clipboard write", token => {
  expect(() => connectionSnippet("claude", 48765, token)).toThrow();
  expect(() => connectionSnippet("codex", 48765, token)).toThrow();
});

it("Codex settings are valid TOML lines only (no shell commands mixed in)", () => {
  const lines = connectionSnippet("codex", 48765, "secret").split("\n");
  expect(lines).toHaveLength(5);
  for (const line of lines.slice(1)) expect(line).toMatch(/^[a-z_]+ = /);
});
