import { describe, expect, it } from "vitest";
import { connectionSnippet, validAgentPort } from "./connectionSnippet";

describe("AI connection snippets (O7)", () => {
  it("copies Claude Code's HTTP registration with the effective port and token", () => {
    expect(connectionSnippet("claude", 48781, "secret-token")).toBe('claude mcp add --transport http harita http://127.0.0.1:48781/mcp --header "Authorization: Bearer secret-token"');
  });
  it("copies Codex TOML and separate PowerShell session and persistent environment commands", () => {
    expect(connectionSnippet("codex", 48765, "secret-token")).toBe('[mcp_servers.harita]\nurl = "http://127.0.0.1:48765/mcp"\nbearer_token_env_var = "HARITA_MCP_TOKEN"\n\n$env:HARITA_MCP_TOKEN="secret-token"\nsetx HARITA_MCP_TOKEN "secret-token"');
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

it("Codex connection settings paste as real separate TOML and PowerShell lines", () => {
  const lines = connectionSnippet("codex", 48765, "secret").split("\n");
  expect(lines).toHaveLength(6);
  expect(lines.slice(0,3)).toEqual(["[mcp_servers.harita]", 'url = "http://127.0.0.1:48765/mcp"', 'bearer_token_env_var = "HARITA_MCP_TOKEN"']);
});
