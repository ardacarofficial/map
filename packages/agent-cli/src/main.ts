#!/usr/bin/env node
export type { AgentToolResult } from "@smap/agent";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// Keep the official server import in the scaffold's typecheck/build until lane 4 implements proxying.
const server: McpServer = new McpServer({ name: "harita-mcp", version: "0.1.0" });
void server;
process.stdout.write("Usage: harita-mcp --url http://127.0.0.1:PORT/mcp [--token-env HARITA_MCP_TOKEN]\n");
